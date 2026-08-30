import assert from "node:assert/strict";
import test from "node:test";

import { compareShardTopologies } from "./e2e-shard-benchmark.mjs";

const benchmarkRun = { id: 2, head_sha: "abc" };

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

function topology(total, durationSeconds, conclusion = "success", offsetSeconds = 0) {
  return Array.from({ length: total }, (_, index) =>
    job(`Playwright benchmark ${total} shards (${index + 1}/${total})`, durationSeconds, conclusion, offsetSeconds),
  );
}

test("selects a larger topology only for a material gain", () => {
  const result = compareShardTopologies({
    benchmarkRun,
    benchmarkJobs: { jobs: [
      ...topology(6, 400),
      ...topology(8, 350, "success", 500),
      ...topology(10, 340, "success", 950),
    ] },
    totalTests: 420,
  });
  assert.equal(result.provisionalSelection, 8);
  assert.deepEqual(result.topologies.map((item) => item.averageTestsPerShard), [70, 52.5, 42]);
});

test("does not penalize a topology for waiting on the preceding experiment", () => {
  const result = compareShardTopologies({
    benchmarkRun,
    benchmarkJobs: { jobs: [
      ...topology(6, 410),
      ...topology(8, 360, "success", 1_000),
      ...topology(10, 300, "success", 2_000),
    ] },
    totalTests: 420,
  });
  assert.equal(result.topologies[1].topologyReadySeconds, 360);
  assert.equal(result.provisionalSelection, 10);
});

test("prefers fewer shards when the gain is below the noise floor", () => {
  const result = compareShardTopologies({
    benchmarkRun,
    benchmarkJobs: { jobs: [
      ...topology(6, 400),
      ...topology(8, 385, "success", 500),
      ...topology(10, 382, "success", 1_000),
    ] },
    totalTests: 420,
  });
  assert.equal(result.provisionalSelection, 6);
});

test("never selects an incomplete or failing topology", () => {
  const result = compareShardTopologies({
    benchmarkRun,
    benchmarkJobs: { jobs: [
      ...topology(6, 400),
      ...topology(8, 300, "failure", 500),
      ...topology(10, 250, "success", 900).slice(0, 9),
    ] },
    totalTests: 420,
  });
  assert.equal(result.provisionalSelection, 6);
  assert.equal(result.topologies[1].reliable, false);
  assert.equal(result.topologies[2].reliable, false);
});

test("reports aggregate setup overhead and test imbalance", () => {
  const jobs = [
    ...topology(6, 400),
    ...topology(8, 350, "success", 500),
    ...topology(10, 300, "success", 950),
  ];
  jobs[0] = job("Playwright benchmark 6 shards (1/6)", 430);
  const result = compareShardTopologies({ benchmarkRun, benchmarkJobs: { jobs }, totalTests: 420 });
  const six = result.topologies[0];
  assert.equal(six.slowestTestSeconds, 300);
  assert.equal(six.fastestTestSeconds, 270);
  assert.equal(six.testImbalanceSeconds, 30);
  assert.equal(six.nonTestOverheadSeconds, 780);
});

test("rejects an invalid test inventory", () => {
  assert.throws(
    () => compareShardTopologies({ benchmarkRun, benchmarkJobs: { jobs: [] }, totalTests: 0 }),
    /positive integer/,
  );
});
