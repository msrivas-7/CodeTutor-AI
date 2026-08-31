#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TOPOLOGIES = [10, 12, 14, 16, 17, 20];
const STANDARD_RUNNER_CONCURRENCY = 20;
const RESERVED_NON_SHARD_JOBS = 3;
const MINIMUM_RELATIVE_GAIN = 0.05;
const MINIMUM_ABSOLUTE_GAIN_SECONDS = 20;
const TEST_STEP_NAME = "Run identical full suite without retries";

function secondsBetween(start, end) {
  if (!start || !end) return null;
  const value = (Date.parse(end) - Date.parse(start)) / 1000;
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function stepSeconds(job, stepName) {
  const step = job.steps?.find((candidate) => candidate.name === stepName);
  return step ? secondsBetween(step.started_at, step.completed_at) : null;
}

function modeledTestCriticalPath(testSeconds, parallelism) {
  if (testSeconds.length === 0 || parallelism < 1) return null;
  const lanes = Array.from({ length: Math.min(parallelism, testSeconds.length) }, () => 0);
  for (const duration of [...testSeconds].sort((left, right) => right - left)) {
    let lightest = 0;
    for (let index = 1; index < lanes.length; index += 1) {
      if (lanes[index] < lanes[lightest]) lightest = index;
    }
    lanes[lightest] += duration;
  }
  return Math.max(...lanes);
}

function summarizeTopology({ total, run, jobs, totalTests }) {
  const namePrefix = `Playwright benchmark ${total} shards`;
  // Reusable-workflow jobs are reported as
  // `benchmark-ten / Playwright benchmark 10 shards (1/10)`. Match the owned
  // segment instead of coupling the comparator to the caller job id.
  const selected = jobs.filter((job) => job.name.includes(namePrefix));
  const startedValues = selected.map((job) => Date.parse(job.started_at)).filter(Number.isFinite);
  const topologyStartedAt = startedValues.length === total
    ? new Date(Math.min(...startedValues)).toISOString()
    : null;
  const topologyReadyValues = selected
    .map((job) => secondsBetween(topologyStartedAt, job.completed_at))
    .filter((value) => value !== null);
  const executionValues = selected
    .map((job) => secondsBetween(job.started_at, job.completed_at))
    .filter((value) => value !== null);
  const testValues = selected
    .map((job) => stepSeconds(job, TEST_STEP_NAME))
    .filter((value) => value !== null);
  const aggregateExecutionSeconds = executionValues.length === total
    ? executionValues.reduce((sum, value) => sum + value, 0)
    : null;
  const aggregateTestSeconds = testValues.length === total
    ? testValues.reduce((sum, value) => sum + value, 0)
    : null;
  const slowestTestSeconds = testValues.length === total ? Math.max(...testValues) : null;
  const fastestTestSeconds = testValues.length === total ? Math.min(...testValues) : null;
  const testParallelism = Math.min(total, STANDARD_RUNNER_CONCURRENCY - RESERVED_NON_SHARD_JOBS);
  const modeledTestCriticalPathSeconds = testValues.length === total
    ? modeledTestCriticalPath(testValues, testParallelism)
    : null;

  return {
    shards: total,
    runId: run.id,
    expectedJobs: total,
    observedJobs: selected.length,
    reliable: selected.length === total && selected.every((job) => job.conclusion === "success"),
    totalTests,
    averageTestsPerShard: Number((totalTests / total).toFixed(1)),
    topologyStartedAt,
    topologyReadySeconds: topologyReadyValues.length === total ? Math.max(...topologyReadyValues) : null,
    slowestExecutionSeconds: executionValues.length === total ? Math.max(...executionValues) : null,
    aggregateExecutionSeconds,
    slowestTestSeconds,
    fastestTestSeconds,
    testParallelism,
    modeledTestCriticalPathSeconds,
    testImbalanceSeconds: slowestTestSeconds !== null && fastestTestSeconds !== null
      ? slowestTestSeconds - fastestTestSeconds
      : null,
    aggregateTestSeconds,
    nonTestOverheadSeconds: aggregateExecutionSeconds !== null && aggregateTestSeconds !== null
      ? aggregateExecutionSeconds - aggregateTestSeconds
      : null,
    jobs: selected.map((job) => ({
      name: job.name,
      conclusion: job.conclusion ?? "unknown",
      executionSeconds: secondsBetween(job.started_at, job.completed_at),
      testSeconds: stepSeconds(job, TEST_STEP_NAME),
      topologyRelativeSeconds: secondsBetween(topologyStartedAt, job.completed_at),
    })),
  };
}

function isMeaningfullyFaster(candidate, incumbent) {
  const absoluteGain = incumbent.modeledTestCriticalPathSeconds
    - candidate.modeledTestCriticalPathSeconds;
  const relativeGain = absoluteGain / incumbent.modeledTestCriticalPathSeconds;
  return absoluteGain >= MINIMUM_ABSOLUTE_GAIN_SECONDS && relativeGain >= MINIMUM_RELATIVE_GAIN;
}

function selectTopology(topologies) {
  const reliable = topologies
    .filter((item) => item.reliable && item.modeledTestCriticalPathSeconds !== null)
    .sort((left, right) => left.shards - right.shards);
  let selected = reliable[0] ?? null;
  for (const candidate of reliable.slice(1)) {
    if (isMeaningfullyFaster(candidate, selected)) selected = candidate;
  }
  return selected;
}

export function compareShardTopologies({ benchmarkRun, benchmarkJobs, totalTests }) {
  if (!Number.isSafeInteger(totalTests) || totalTests < 1) {
    throw new Error("totalTests must be a positive integer");
  }
  const jobs = benchmarkJobs.jobs ?? benchmarkJobs;
  const topologies = TOPOLOGIES.map((total) =>
    summarizeTopology({ total, run: benchmarkRun, jobs, totalTests }),
  );
  const selected = selectTopology(topologies);
  return {
    schemaVersion: 2,
    headSha: benchmarkRun.head_sha,
    policy: {
      workersPerShard: 2,
      retries: 0,
      candidates: TOPOLOGIES,
      standardRunnerConcurrency: STANDARD_RUNNER_CONCURRENCY,
      reservedNonShardJobs: RESERVED_NON_SHARD_JOBS,
      unconstrainedShardCeiling: STANDARD_RUNNER_CONCURRENCY - RESERVED_NON_SHARD_JOBS,
      selectionMetric: "reliable modeled Playwright critical path",
      minimumRelativeGain: MINIMUM_RELATIVE_GAIN,
      minimumAbsoluteGainSeconds: MINIMUM_ABSOLUTE_GAIN_SECONDS,
      status: "topologies run sequentially on the same commit; setup and queue-inclusive wall time are reported as operational context; selection models only the retry-free Playwright critical path, including the 20-shard queued test tail under the 17-job reserve",
    },
    topologies,
    provisionalSelection: selected?.shards ?? null,
    selectedAverageTestsPerShard: selected?.averageTestsPerShard ?? null,
  };
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function main() {
  const required = ["--benchmark-run", "--benchmark-jobs", "--total-tests", "--output"];
  for (const option of required) {
    if (!argument(option)) throw new Error(`Missing ${option}`);
  }
  const result = compareShardTopologies({
    benchmarkRun: JSON.parse(fs.readFileSync(argument("--benchmark-run"), "utf8")),
    benchmarkJobs: JSON.parse(fs.readFileSync(argument("--benchmark-jobs"), "utf8")),
    totalTests: Number(argument("--total-tests")),
  });
  const output = argument("--output");
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
  console.log(
    `Shard benchmark provisional selection: ${result.provisionalSelection ?? "none"}; ` +
      result.topologies.map((item) =>
        `${item.shards}=${item.reliable ? `${item.modeledTestCriticalPathSeconds}s modeled tests / ${item.topologyReadySeconds}s wall (${item.averageTestsPerShard} tests/shard)` : "unreliable"}`,
      ).join(", "),
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
