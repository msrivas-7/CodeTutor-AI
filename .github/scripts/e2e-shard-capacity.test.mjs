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
});

test("blocking workflow uses the selected matrix and derives its denominator", () => {
  const shardMatrix = workflow.match(/matrix:\n\s+shard: \[([^\]]+)]/)?.[1]
    .split(",")
    .map((value) => Number(value.trim()));
  assert.deepEqual(shardMatrix, Array.from({ length: record.selectedShards }, (_, index) => index + 1));
  assert.match(workflow, /--active-shards "\$\{\{ strategy\.job-total }}/);
  assert.match(workflow, /--shard=\$\{\{ matrix\.shard }}\/\$\{\{ strategy\.job-total }}/);
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
