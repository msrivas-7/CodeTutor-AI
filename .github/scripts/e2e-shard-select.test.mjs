import assert from "node:assert/strict";
import test from "node:test";

import { evaluateHistory, selectShardTopology } from "./e2e-shard-select.mjs";

const now = "2026-09-12T12:00:00Z";
const tests = Array.from({ length: 24 }, (_, index) => ({
  id: `test-${index + 1}`,
  selector: `test-${index + 1}`,
}));
const history = {
  schemaVersion: 2,
  generatedAt: "2026-09-11T12:00:00Z",
  algorithm: "ewma-0.7",
  source: { runId: 123, headSha: "a".repeat(40) },
  tests: Object.fromEntries(tests.map((candidate) => [candidate.id, 20_000])),
};
const record = {
  selectedShards: 8,
  workersPerShard: 2,
  rebenchmark: { atOrBelowTests: 20, atOrAboveTests: 28 },
  operationalTopology: { maximumReliableConcurrentStacks: 12 },
  runtimeOptimization: { maximumChromiumShards: 10 },
  selectionPolicy: {
    minimumAbsoluteGainSeconds: 20,
    minimumRelativeGain: 0.05,
    preservesFullChromiumSuite: true,
  },
  automaticSelection: {
    minimumShards: 1,
    historyMaxAgeDays: 30,
    minimumHistoryCoverage: 0.8,
    fixedOverheadSeconds: 100,
  },
};
const workflow = `jobs:
  critical-shadow:
    strategy:
      matrix:
        shard: [1, 2]
    steps:
      - run: docker compose up -d backend
  e2e:
    strategy:
      matrix:
        shard: \${{ fromJSON(needs.duration-plan.outputs.shard-matrix) }}
    steps:
      - run: docker compose up -d backend
  cross-browser-core:
    strategy:
      matrix:
        browser: [firefox, webkit]
    steps:
      - run: docker compose up -d backend
`;

test("accepts only fresh, sufficiently complete versioned history", () => {
  assert.equal(evaluateHistory({
    history,
    tests,
    now,
    maxAgeDays: 30,
    minimumCoverage: 0.8,
  }).eligible, true);
  assert.equal(evaluateHistory({
    history: { ...history, schemaVersion: 1 },
    tests,
    now,
    maxAgeDays: 30,
    minimumCoverage: 0.8,
  }).reason, "unsupported-history-schema");
  assert.equal(evaluateHistory({
    history: { ...history, source: undefined },
    tests,
    now,
    maxAgeDays: 30,
    minimumCoverage: 0.8,
  }).reason, "invalid-history-provenance");
  assert.equal(evaluateHistory({
    history: { ...history, generatedAt: "2026-07-01T00:00:00Z" },
    tests,
    now,
    maxAgeDays: 30,
    minimumCoverage: 0.8,
  }).reason, "stale-history");
  assert.equal(evaluateHistory({
    history: { ...history, tests: { "test-1": 10_000 } },
    tests,
    now,
    maxAgeDays: 30,
    minimumCoverage: 0.8,
  }).reason, "insufficient-history-coverage");
  assert.equal(evaluateHistory({
    history: { ...history, tests: { ...history.tests, "test-1": 999_999 } },
    tests,
    now,
    maxAgeDays: 30,
    minimumCoverage: 0.8,
  }).reason, "invalid-history-duration");
});

test("selects the smallest safe topology within the measured noise floor", () => {
  const result = selectShardTopology({ tests, history, record, workflowSource: workflow, now });
  assert.equal(result.maximumSafeShards, 8);
  assert.equal(result.supportStacks, 4);
  assert.equal(result.fastestSafeShards, 6);
  assert.equal(result.selectedShards, 6);
  assert.deepEqual(result.shardMatrix, [1, 2, 3, 4, 5, 6]);
  assert.equal(result.reason, "optimized-within-noise-floor");
  assert.equal(result.predictions.length, 8);
});

test("falls back to the proven stable topology when history is unusable", () => {
  const result = selectShardTopology({
    tests,
    history: { ...history, generatedAt: "2026-01-01T00:00:00Z" },
    record,
    workflowSource: workflow,
    now,
  });
  assert.equal(result.selectedShards, 8);
  assert.deepEqual(result.shardMatrix, [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(result.reason, "fallback-stale-history");
  assert.deepEqual(result.predictions, []);
});

test("treats a missing or malformed parsed history value as fallback-only", () => {
  const result = selectShardTopology({
    tests,
    history: null,
    record,
    workflowSource: workflow,
    now,
  });
  assert.equal(result.selectedShards, 8);
  assert.equal(result.reason, "fallback-unsupported-history-schema");
});

test("shrinks the fallback instead of creating empty shards when the suite is tiny", () => {
  const tinyTests = tests.slice(0, 4);
  const result = selectShardTopology({
    tests: tinyTests,
    history: null,
    record,
    workflowSource: workflow,
    now,
  });
  assert.equal(result.maximumSafeShards, 4);
  assert.equal(result.selectedShards, 4);
  assert.deepEqual(result.shardMatrix, [1, 2, 3, 4]);
});

test("fails closed when the fallback exceeds database or GitHub capacity", () => {
  assert.throws(() => selectShardTopology({
    tests,
    history,
    record: {
      ...record,
      operationalTopology: { maximumReliableConcurrentStacks: 10 },
    },
    workflowSource: workflow,
    now,
  }), /fallback requests 8 shards.*safe limit is 6/);
});

test("never drops inventory coverage while comparing candidates", () => {
  const result = selectShardTopology({ tests, history, record, workflowSource: workflow, now });
  for (const candidate of result.predictions) {
    assert.ok(candidate.predictedTestCriticalPathMs > 0);
    assert.equal(candidate.predictedWorkflowReadyMs, 100_000 + candidate.predictedTestCriticalPathMs);
  }
});
