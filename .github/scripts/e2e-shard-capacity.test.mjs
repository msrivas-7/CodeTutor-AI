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
  assert.deepEqual(deriveRebenchmarkBounds(420, 10), {
    atOrBelowTests: 378,
    atOrAboveTests: 462,
  });
});

test("tracked decision preserves the clean same-commit benchmark evidence", () => {
  assert.equal(record.benchmark.runId, 33295206692);
  assert.equal(record.benchmark.headSha, "f4dceeefa292e378eab4a18d5b14c60ddf1d5f97");
  assert.deepEqual(
    record.benchmark.topologies.map(({ shards, topologyReadySeconds, reliable }) => ({
      shards,
      topologyReadySeconds,
      reliable,
    })),
    [
      { shards: 6, topologyReadySeconds: 504, reliable: true },
      { shards: 8, topologyReadySeconds: 367, reliable: true },
      { shards: 10, topologyReadySeconds: 325, reliable: true },
    ],
  );
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
  assert.equal(evaluateShardCapacity({ record, totalTests: 420, activeShards: 10 }).eligible, true);
  assert.equal(evaluateShardCapacity({ record, totalTests: 461, activeShards: 10 }).eligible, true);
  assert.equal(evaluateShardCapacity({ record, totalTests: 379, activeShards: 10 }).eligible, true);
});

test("requires a new benchmark at either capacity boundary", () => {
  const upper = evaluateShardCapacity({ record, totalTests: 462, activeShards: 10 });
  const lower = evaluateShardCapacity({ record, totalTests: 378, activeShards: 10 });
  assert.deepEqual({ eligible: upper.eligible, direction: upper.direction }, { eligible: false, direction: "upper" });
  assert.deepEqual({ eligible: lower.eligible, direction: lower.direction }, { eligible: false, direction: "lower" });
});

test("fails closed when workflow topology drifts from the measured record", () => {
  assert.throws(
    () => evaluateShardCapacity({ record, totalTests: 420, activeShards: 8 }),
    /active workflow has 8 shards/,
  );
});

test("fails closed when recorded boundaries are stale or hand-edited", () => {
  assert.throws(
    () => evaluateShardCapacity({
      record: { ...record, rebenchmark: { atOrBelowTests: 1, atOrAboveTests: 999 } },
      totalTests: 420,
      activeShards: 10,
    }),
    /capacity record bounds must be 378\/462/,
  );
});
