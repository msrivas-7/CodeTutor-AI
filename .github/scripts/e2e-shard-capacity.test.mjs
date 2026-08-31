import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  deriveRebenchmarkBounds,
  evaluateShardCapacity,
} from "./e2e-shard-capacity.mjs";

const record = JSON.parse(readFileSync(new URL("../e2e-shard-capacity.json", import.meta.url), "utf8"));
const workflow = readFileSync(new URL("../workflows/e2e.yml", import.meta.url), "utf8");

test("derives a one-shard-workload rebenchmark band", () => {
  assert.deepEqual(deriveRebenchmarkBounds(439, 16), {
    atOrBelowTests: 411,
    atOrAboveTests: 467,
  });
});

test("tracked decision preserves the clean controlled benchmark evidence", () => {
  assert.deepEqual(
    record.benchmark.runs.map(({ runId, headSha, topologies }) => ({ runId, headSha, topologies })),
    [
      {
        runId: 33385421742,
        headSha: "ced40c1b465cfeddba37c6299e4668a38d235139",
        topologies: [16, 20],
      },
    ],
  );
  assert.deepEqual(
    record.benchmark.topologies.map(({ shards, modeledTestCriticalPathSeconds, topologyReadySeconds, reliable }) => ({
      shards,
      modeledTestCriticalPathSeconds,
      topologyReadySeconds,
      reliable,
    })),
    [
      { shards: 16, modeledTestCriticalPathSeconds: 160, topologyReadySeconds: 379, reliable: true },
      { shards: 20, modeledTestCriticalPathSeconds: 198, topologyReadySeconds: 416, reliable: true },
    ],
  );
  assert.equal(record.benchmark.selectedModeledTestCriticalPathSeconds, 160);
  assert.deepEqual(record.runtimeOptimization.imageReuse, {
    localBuildEndToEndSeconds: 369,
    prebuiltEndToEndSecondsIncludingPreparation: 338,
    preparationSeconds: 24,
    absoluteGainSeconds: 31,
    relativeGain: 0.084,
    selected: true,
  });
  assert.deepEqual(
    record.runtimeOptimization.workerCandidates.map(
      ({ workers, reliable, selected }) => ({ workers, reliable, selected }),
    ),
    [
      { workers: 2, reliable: true, selected: true },
      { workers: 3, reliable: false, selected: false },
      { workers: 4, reliable: false, selected: false },
    ],
  );
  assert.equal(record.runtimeOptimization.maximumChromiumShards, 20);
});

test("blocking workflow uses the selected matrix and derives its denominator", () => {
  const exhaustiveJob = workflow.match(/\n  e2e:\n([\s\S]+?)\n  cross-browser-core:/)?.[1] ?? "";
  const shardMatrix = exhaustiveJob.match(/matrix:\n\s+shard: \[([^\]]+)]/)?.[1]
    .split(",")
    .map((value) => Number(value.trim()));
  assert.deepEqual(shardMatrix, Array.from({ length: record.selectedShards }, (_, index) => index + 1));
  assert.match(exhaustiveJob, /--active-shards "\$\{\{ strategy\.job-total }}/);
  assert.match(workflow, /--output e2e\/duration-plan\/full[\s\S]+--shards 16/);
  assert.match(exhaustiveJob, /--test-list=duration-plan-artifact\/full\/shard-\$\{\{ matrix\.shard }}\.txt/);
  assert.match(exhaustiveJob, /name: Upload test-duration evidence/);
});

test("advisory critical coverage is split across two isolated duration-balanced jobs", () => {
  assert.match(workflow, /--output e2e\/duration-plan\/critical[\s\S]+--shards 2[\s\S]+--tag lane:critical/);
  assert.match(workflow, /critical-shadow:[\s\S]+matrix:\n\s+shard: \[1, 2]/);
  assert.match(workflow, /critical-shadow-summary:[\s\S]+files\.length!==2/);
});

test("duration planning receives the authenticated fixture environment required for discovery", () => {
  const planningJob = workflow.match(/\n  duration-plan:\n([\s\S]+?)\n  prepare-backend:/)?.[1] ?? "";
  for (const variable of [
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "VITE_SUPABASE_URL",
    "VITE_SUPABASE_ANON_KEY",
    "DATABASE_URL",
    "BYOK_ENCRYPTION_KEY",
  ]) {
    assert.match(planningJob, new RegExp(`${variable}: \\$\\{\\{ secrets\\.${variable} }}`));
  }
});

test("accepts the measured inventory and normal growth", () => {
  assert.equal(evaluateShardCapacity({ record, totalTests: 439, activeShards: 16 }).eligible, true);
  assert.equal(evaluateShardCapacity({ record, totalTests: 466, activeShards: 16 }).eligible, true);
  assert.equal(evaluateShardCapacity({ record, totalTests: 412, activeShards: 16 }).eligible, true);
});

test("requires a new benchmark at either capacity boundary", () => {
  const upper = evaluateShardCapacity({ record, totalTests: 467, activeShards: 16 });
  const lower = evaluateShardCapacity({ record, totalTests: 411, activeShards: 16 });
  assert.deepEqual({ eligible: upper.eligible, direction: upper.direction }, { eligible: false, direction: "upper" });
  assert.deepEqual({ eligible: lower.eligible, direction: lower.direction }, { eligible: false, direction: "lower" });
});

test("fails closed when workflow topology drifts from the measured record", () => {
  assert.throws(
    () => evaluateShardCapacity({ record, totalTests: 437, activeShards: 10 }),
    /active workflow has 10 shards/,
  );
});

test("fails closed when recorded boundaries are stale or hand-edited", () => {
  assert.throws(
    () => evaluateShardCapacity({
      record: { ...record, rebenchmark: { atOrBelowTests: 1, atOrAboveTests: 999 } },
      totalTests: 439,
      activeShards: 16,
    }),
    /capacity record bounds must be 411\/467/,
  );
});
