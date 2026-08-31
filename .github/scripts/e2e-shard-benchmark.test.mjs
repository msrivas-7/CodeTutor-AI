import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { compareShardTopologies } from "./e2e-shard-benchmark.mjs";

const benchmarkRun = { id: 2, head_sha: "abc" };
const candidates = [16, 20];
const benchmarkWorkflow = readFileSync(new URL("../workflows/e2e-shard-benchmark.yml", import.meta.url), "utf8");
const topologyWorkflow = readFileSync(new URL("../workflows/e2e-shard-topology.yml", import.meta.url), "utf8");

function job(
  name,
  durationSeconds,
  conclusion = "success",
  offsetSeconds = 0,
  testDurationSeconds = Math.max(1, durationSeconds - 130),
) {
  const started = new Date(Date.parse("2026-07-30T10:00:00Z") + offsetSeconds * 1000);
  const testStarted = new Date(started.getTime() + 100_000);
  const testCompleted = new Date(testStarted.getTime() + testDurationSeconds * 1000);
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
    job(
      `${prefix}Playwright benchmark ${total} shards (${index + 1}/${total})`,
      durationSeconds,
      conclusion,
      offsetSeconds,
    ),
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
    benchmarkJobs: { jobs: allTopologies([330, 280]) },
    totalTests: 420,
  });
  assert.equal(result.provisionalSelection, 20);
  assert.deepEqual(
    result.topologies.map((item) => item.averageTestsPerShard),
    [26.3, 21],
  );
  assert.deepEqual(result.policy, {
    workersPerShard: 2,
    retries: 0,
    candidates,
    standardRunnerConcurrency: 40,
    reservedNonShardJobs: 3,
    unconstrainedShardCeiling: 37,
    selectionMetric: "reliable modeled Playwright critical path",
    minimumRelativeGain: 0.05,
    minimumAbsoluteGainSeconds: 20,
    status: "topologies run sequentially on the same commit; setup and queue-inclusive wall time are reported as operational context; selection uses the slowest retry-free test partition within the 37-job reserve and adds recorded runner-allocation delay above that reserve",
    selectionSuppressed: false,
  });
});

test("matches reusable-workflow job prefixes", () => {
  const result = compareShardTopologies({
    benchmarkRun,
    benchmarkJobs: { jobs: allTopologies(
      [330, 280],
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
  assert.match(benchmarkWorkflow, /total: 20\n\s+shards: '\[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20]'\n\s+max_parallel: 20/);
  assert.match(topologyWorkflow, /max-parallel: \$\{\{ inputs\.max_parallel }}/);
  assert.match(topologyWorkflow, /shard: \$\{\{ fromJSON\(inputs\.shards\) }}/);
  assert.match(topologyWorkflow, /--shard=\$\{\{ matrix\.shard }}\/\$\{\{ inputs\.total }}/);
});

test("does not treat preceding-experiment wait time as test work", () => {
  const result = compareShardTopologies({
    benchmarkRun,
    benchmarkJobs: { jobs: allTopologies([350, 300], { offsetStep: 1_000 }) },
    totalTests: 420,
  });
  assert.equal(result.topologies[1].topologyReadySeconds, 300);
  assert.equal(result.provisionalSelection, 20);
  assert.equal(result.topologies[0].modeledTestCriticalPathSeconds, 220);
  assert.equal(result.topologies[1].modeledTestCriticalPathSeconds, 170);
});

test("suppresses a focused topology's standalone selection", () => {
  const result = compareShardTopologies({
    benchmarkRun,
    benchmarkJobs: { jobs: topology(20, 300) },
    totalTests: 420,
    suppressSelection: true,
  });

  assert.equal(result.topologies[1].reliable, true);
  assert.equal(result.provisionalSelection, null);
  assert.equal(result.policy.selectionSuppressed, true);
});

test("reports but does not select on a one-run setup outlier", () => {
  const jobs = allTopologies([310, 305]);
  jobs[0] = job(
    "Playwright benchmark 16 shards (1/16)",
    900,
    "success",
    0,
    180,
  );
  const result = compareShardTopologies({ benchmarkRun, benchmarkJobs: { jobs }, totalTests: 420 });
  const sixteen = result.topologies[0];
  assert.equal(sixteen.topologyReadySeconds, 900);
  assert.equal(sixteen.modeledTestCriticalPathSeconds, 180);
  assert.equal(result.provisionalSelection, 16);
});

test("prefers fewer shards when every gain is below the noise floor", () => {
  const result = compareShardTopologies({
    benchmarkRun,
    benchmarkJobs: { jobs: allTopologies([330, 315]) },
    totalTests: 420,
  });
  assert.equal(result.provisionalSelection, 16);
});

test("never selects an incomplete or failing topology", () => {
  const jobs = allTopologies(
    [330, 280],
    { conclusion: { 20: "failure" } },
  );
  const result = compareShardTopologies({ benchmarkRun, benchmarkJobs: { jobs }, totalTests: 420 });
  assert.equal(result.provisionalSelection, 16);
  assert.equal(result.topologies[0].reliable, true);
  assert.equal(result.topologies[1].reliable, false);
});

test("reports aggregate setup overhead and test imbalance", () => {
  const jobs = allTopologies([400, 290]);
  jobs[0] = job("Playwright benchmark 16 shards (1/16)", 430);
  const result = compareShardTopologies({ benchmarkRun, benchmarkJobs: { jobs }, totalTests: 420 });
  const sixteen = result.topologies[0];
  assert.equal(sixteen.slowestTestSeconds, 300);
  assert.equal(sixteen.fastestTestSeconds, 270);
  assert.equal(sixteen.testImbalanceSeconds, 30);
  assert.equal(sixteen.nonTestOverheadSeconds, 2_080);
});

test("rejects an invalid test inventory", () => {
  assert.throws(
    () => compareShardTopologies({ benchmarkRun, benchmarkJobs: { jobs: [] }, totalTests: 0 }),
    /positive integer/,
  );
});
