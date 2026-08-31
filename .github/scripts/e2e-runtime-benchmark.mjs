#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SHARDS = 16;
const MINIMUM_RELATIVE_GAIN = 0.05;
const MINIMUM_ABSOLUTE_GAIN_SECONDS = 20;
const BOOT_STEP_NAME = "Boot docker-compose stack";
const TEST_STEP_NAME = "Run identical full suite without retries";
const PREPARATION_JOBS = [
  "Build backend E2E image once",
  "Build runner E2E image once",
  "Build frontend E2E image once",
];
const EXPERIMENTS = [
  { id: "local-w2", imageMode: "local-build", workers: 2 },
  { id: "prebuilt-w2", imageMode: "prebuilt", workers: 2 },
  { id: "prebuilt-w3", imageMode: "prebuilt", workers: 3 },
  { id: "prebuilt-w4", imageMode: "prebuilt", workers: 4 },
];

function secondsBetween(start, end) {
  if (!start || !end) return null;
  const value = (Date.parse(end) - Date.parse(start)) / 1000;
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function stepSeconds(job, stepName) {
  const step = job.steps?.find((candidate) => candidate.name === stepName);
  return step ? secondsBetween(step.started_at, step.completed_at) : null;
}

function percentile(values, fraction) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(fraction * sorted.length) - 1];
}

function summarizeExperiment(experiment, run, jobs, totalTests) {
  const prefix = `Playwright runtime ${experiment.id} (`;
  const selected = jobs.filter((job) => job.name.includes(prefix));
  const starts = selected.map((job) => Date.parse(job.started_at)).filter(Number.isFinite);
  const topologyStartedAt = starts.length === SHARDS
    ? new Date(Math.min(...starts)).toISOString()
    : null;
  const execution = selected
    .map((job) => secondsBetween(job.started_at, job.completed_at))
    .filter((value) => value !== null);
  const relativeCompletion = selected
    .map((job) => secondsBetween(topologyStartedAt, job.completed_at))
    .filter((value) => value !== null);
  const boots = selected.map((job) => stepSeconds(job, BOOT_STEP_NAME)).filter((value) => value !== null);
  const tests = selected.map((job) => stepSeconds(job, TEST_STEP_NAME)).filter((value) => value !== null);
  const reliable = selected.length === SHARDS
    && selected.every((job) => job.conclusion === "success")
    && boots.length === SHARDS
    && tests.length === SHARDS;

  return {
    ...experiment,
    runId: run.id,
    shards: SHARDS,
    expectedJobs: SHARDS,
    observedJobs: selected.length,
    reliable,
    totalTests,
    topologyStartedAt,
    topologyReadySeconds: relativeCompletion.length === SHARDS
      ? Math.max(...relativeCompletion)
      : null,
    slowestExecutionSeconds: execution.length === SHARDS ? Math.max(...execution) : null,
    aggregateExecutionSeconds: execution.length === SHARDS
      ? execution.reduce((sum, value) => sum + value, 0)
      : null,
    bootSeconds: {
      median: boots.length === SHARDS ? percentile(boots, 0.5) : null,
      p90: boots.length === SHARDS ? percentile(boots, 0.9) : null,
      max: boots.length === SHARDS ? Math.max(...boots) : null,
    },
    testCriticalPathSeconds: tests.length === SHARDS ? Math.max(...tests) : null,
    aggregateTestSeconds: tests.length === SHARDS
      ? tests.reduce((sum, value) => sum + value, 0)
      : null,
    testImbalanceSeconds: tests.length === SHARDS
      ? Math.max(...tests) - Math.min(...tests)
      : null,
    jobs: selected.map((job) => ({
      name: job.name,
      conclusion: job.conclusion ?? "unknown",
      executionSeconds: secondsBetween(job.started_at, job.completed_at),
      bootSeconds: stepSeconds(job, BOOT_STEP_NAME),
      testSeconds: stepSeconds(job, TEST_STEP_NAME),
    })),
  };
}

function summarizePreparation(jobs) {
  const selected = jobs.filter((job) =>
    PREPARATION_JOBS.some((name) => job.name.includes(name)));
  const starts = selected.map((job) => Date.parse(job.started_at)).filter(Number.isFinite);
  const startedAt = starts.length === PREPARATION_JOBS.length
    ? new Date(Math.min(...starts)).toISOString()
    : null;
  const readyValues = selected
    .map((job) => secondsBetween(startedAt, job.completed_at))
    .filter((value) => value !== null);
  return {
    expectedJobs: PREPARATION_JOBS.length,
    observedJobs: selected.length,
    reliable: selected.length === PREPARATION_JOBS.length
      && selected.every((job) => job.conclusion === "success"),
    startedAt,
    readySeconds: readyValues.length === PREPARATION_JOBS.length
      ? Math.max(...readyValues)
      : null,
    jobs: selected.map((job) => ({
      name: job.name,
      conclusion: job.conclusion ?? "unknown",
      executionSeconds: secondsBetween(job.started_at, job.completed_at),
      preparationRelativeSeconds: secondsBetween(startedAt, job.completed_at),
    })),
  };
}

function isMeaningfullyFaster(candidateSeconds, incumbentSeconds) {
  if (candidateSeconds === null || incumbentSeconds === null) return false;
  const absoluteGain = incumbentSeconds - candidateSeconds;
  const relativeGain = absoluteGain / incumbentSeconds;
  return absoluteGain >= MINIMUM_ABSOLUTE_GAIN_SECONDS
    && relativeGain >= MINIMUM_RELATIVE_GAIN;
}

function selectWorkers(experiments) {
  const candidates = experiments.filter((item) => item.imageMode === "prebuilt" && item.reliable);
  let selected = candidates.find((item) => item.workers === 2) ?? null;
  if (!selected) return null;
  for (const candidate of candidates.filter((item) => item.workers > 2)) {
    if (isMeaningfullyFaster(candidate.testCriticalPathSeconds, selected.testCriticalPathSeconds)) {
      selected = candidate;
    }
  }
  return selected;
}

export function compareRuntimeExperiments({ benchmarkRun, benchmarkJobs, totalTests }) {
  if (!Number.isSafeInteger(totalTests) || totalTests < 1) {
    throw new Error("totalTests must be a positive integer");
  }
  const jobs = benchmarkJobs.jobs ?? benchmarkJobs;
  const experiments = EXPERIMENTS.map((experiment) =>
    summarizeExperiment(experiment, benchmarkRun, jobs, totalTests));
  const preparation = summarizePreparation(jobs);
  const local = experiments.find((item) => item.id === "local-w2");
  const prebuilt = experiments.find((item) => item.id === "prebuilt-w2");
  const localEndToEndSeconds = local?.topologyReadySeconds ?? null;
  const prebuiltEndToEndSeconds = preparation.readySeconds !== null
    && prebuilt?.topologyReadySeconds !== null
    ? preparation.readySeconds + prebuilt.topologyReadySeconds
    : null;
  const prebuiltImages = Boolean(
    preparation.reliable
      && local?.reliable
      && prebuilt?.reliable
      && isMeaningfullyFaster(prebuiltEndToEndSeconds, localEndToEndSeconds),
  );
  const selectedWorkers = prebuiltImages ? selectWorkers(experiments) : null;

  return {
    schemaVersion: 1,
    headSha: benchmarkRun.head_sha,
    policy: {
      shards: SHARDS,
      retries: 0,
      candidates: EXPERIMENTS,
      maximumChromiumShards: 20,
      minimumRelativeGain: MINIMUM_RELATIVE_GAIN,
      minimumAbsoluteGainSeconds: MINIMUM_ABSOLUTE_GAIN_SECONDS,
      cacheSelectionMetric: "reliable parallel image preparation plus topology completion versus local topology completion at identical 16x2 test parallelism",
      workerSelectionMetric: "reliable retry-free Playwright test critical path after image reuse",
      status: "same commit; sequential experiments; parallel image preparation is charged to the reuse candidate; image reuse and worker count are measured independently",
    },
    preparation,
    experiments,
    cacheComparison: {
      localEndToEndSeconds,
      prebuiltEndToEndSeconds,
    },
    provisionalSelection: {
      prebuiltImages,
      workersPerShard: selectedWorkers?.workers ?? null,
    },
  };
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function main() {
  for (const option of ["--benchmark-run", "--benchmark-jobs", "--total-tests", "--output"]) {
    if (!argument(option)) throw new Error(`Missing ${option}`);
  }
  const result = compareRuntimeExperiments({
    benchmarkRun: JSON.parse(fs.readFileSync(argument("--benchmark-run"), "utf8")),
    benchmarkJobs: JSON.parse(fs.readFileSync(argument("--benchmark-jobs"), "utf8")),
    totalTests: Number(argument("--total-tests")),
  });
  const output = argument("--output");
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
  console.log(
    `Runtime benchmark selection: prebuilt=${result.provisionalSelection.prebuiltImages}; `
      + `workers=${result.provisionalSelection.workersPerShard ?? "none"}`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
