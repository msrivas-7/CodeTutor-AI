import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { compareShardTopologies } from "./e2e-shard-benchmark.mjs";

const benchmarkRun = { id: 2, head_sha: "abc" };
const candidates = [10, 12, 14, 16, 17, 20];
const benchmarkWorkflow = readFileSync(new URL("../workflows/e2e-shard-benchmark.yml", import.meta.url), "utf8");
const topologyWorkflow = readFileSync(new URL("../workflows/e2e-shard-topology.yml", import.meta.url), "utf8");

function job(name, durationSeconds, conclusion = "success", offsetSeconds = 0) {
  const started = new Date(Date.parse("2026-07-30T10:00:00Z") + offsetSeconds * 1000);
  const testStarted = new Date(started.getTime() + 100_000);
  const testCompleted = new Date(testStarted.getTime() + Math.max(1, durationSeconds - 130) * 1000);
  const completed = new Date(started.getTime() + durationSeconds * 1000);
  return {
    name,
    conclusion,
    started_at: started.toISOString(),
    completed_at: completed.toISOString(),
    steps: [{
      name: "Run identical full suite without retries",
      started_at: testStarted.toISOString(),
      completed_at: testCompleted.toISOString(),
    }],
  };
}

function topology(total, durationSeconds, conclusion = "success", offsetSeconds = 0, prefix = "") {
  return Array.from({ length: total }, (_, index) =>
    job(`${prefix}Playwright benchmark ${total} shards (${index + 1}/${total})`, durationSeconds, conclusion, offsetSeconds),
  );
}

function allTopologies(durations, options = {}) {
  return candidates.flatMap((total, index) => topology(
    total,
    durations[index],
    options.conclusion?.[total] ?? "success",
    options.offsetStep ? index * options.offsetStep : 0,
    options.prefix ?? "",
  ));
}

test("selects a larger topology only for a material gain", () => {
  const result = compareShardTopologies({
    benchmarkRun,
    benchmarkJobs: { jobs: allTopologies([400, 350, 340, 330, 320, 315]) },
    totalTests: 420,
  });
  assert.equal(result.provisionalSelection, 16);
  assert.deepEqual(
    result.topologies.map((item) => item.averageTestsPerShard),
    [42, 35, 30, 26.3, 24.7, 21],
  );
  assert.deepEqual(result.policy, {
    workersPerShard: 2,
    retries: 0,
    candidates,
    standardRunnerConcurrency: 20,
    reservedNonShardJobs: 3,
    unconstrainedShardCeiling: 17,
    selectionMetric: "reliable topology-relative completion",
    minimumRelativeGain: 0.05,
    minimumAbsoluteGainSeconds: 20,
    status: "topologies run sequentially on the same commit; 20 shards is capped at 17 parallel jobs to model the normal workflow reserve; a larger topology wins only when it is reliable and materially faster",
  });
});

test("matches reusable-workflow job prefixes", () => {
  const result = compareShardTopologies({
    benchmarkRun,
    benchmarkJobs: { jobs: allTopologies(
      [400, 360, 340, 330, 325, 320],
      { prefix: "benchmark-call / " },
    ) },
    totalTests: 420,
  });
  assert.equal(result.topologies.every((item) => item.observedJobs === item.expectedJobs), true);
});

test("workflow benchmarks the complete measured range under the account ceiling", () => {
  const configuredTotals = [...benchmarkWorkflow.matchAll(/^\s{6}total: (\d+)$/gm)]
    .map((match) => Number(match[1]));
  assert.deepEqual(configuredTotals, candidates);
  assert.match(benchmarkWorkflow, /total: 20\n\s+shards: '\[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20]'\n\s+max_parallel: 17/);
  assert.match(topologyWorkflow, /max-parallel: \$\{\{ inputs\.max_parallel }}/);
  assert.match(topologyWorkflow, /shard: \$\{\{ fromJSON\(inputs\.shards\) }}/);
  assert.match(topologyWorkflow, /--shard=\$\{\{ matrix\.shard }}\/\$\{\{ inputs\.total }}/);
});

test("does not penalize a topology for waiting on the preceding experiment", () => {
  const result = compareShardTopologies({
    benchmarkRun,
    benchmarkJobs: { jobs: allTopologies([410, 390, 370, 350, 330, 300], { offsetStep: 1_000 }) },
    totalTests: 420,
  });
  assert.equal(result.topologies[1].topologyReadySeconds, 390);
  assert.equal(result.provisionalSelection, 20);
});

test("prefers fewer shards when every gain is below the noise floor", () => {
  const result = compareShardTopologies({
    benchmarkRun,
    benchmarkJobs: { jobs: allTopologies([400, 390, 389, 388, 387, 386]) },
    totalTests: 420,
  });
  assert.equal(result.provisionalSelection, 10);
});

test("never selects an incomplete or failing topology", () => {
  const jobs = allTopologies(
    [400, 360, 330, 300, 270, 240],
    { conclusion: { 12: "failure" } },
  ).filter((item) => !item.name.includes("Playwright benchmark 20 shards (20/20)"));
  const result = compareShardTopologies({ benchmarkRun, benchmarkJobs: { jobs }, totalTests: 420 });
  assert.equal(result.provisionalSelection, 17);
  assert.equal(result.topologies[1].reliable, false);
  assert.equal(result.topologies[5].reliable, false);
});

test("reports aggregate setup overhead and test imbalance", () => {
  const jobs = allTopologies([400, 350, 330, 310, 300, 290]);
  jobs[0] = job("Playwright benchmark 10 shards (1/10)", 430);
  const result = compareShardTopologies({ benchmarkRun, benchmarkJobs: { jobs }, totalTests: 420 });
  const ten = result.topologies[0];
  assert.equal(ten.slowestTestSeconds, 300);
  assert.equal(ten.fastestTestSeconds, 270);
  assert.equal(ten.testImbalanceSeconds, 30);
  assert.equal(ten.nonTestOverheadSeconds, 1_300);
});

test("rejects an invalid test inventory", () => {
  assert.throws(
    () => compareShardTopologies({ benchmarkRun, benchmarkJobs: { jobs: [] }, totalTests: 0 }),
    /positive integer/,
  );
});
