import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  deriveDatabaseStackFanout,
  deriveRebenchmarkBounds,
  evaluateShardCapacity,
} from "./e2e-shard-capacity.mjs";

const record = JSON.parse(
  readFileSync(new URL("../e2e-shard-capacity.json", import.meta.url), "utf8"),
);
const workflow = readFileSync(
  new URL("../workflows/e2e.yml", import.meta.url),
  "utf8",
);

test("derives a one-shard-workload rebenchmark band", () => {
  assert.deepEqual(deriveRebenchmarkBounds(484, 12), {
    atOrBelowTests: 443,
    atOrAboveTests: 525,
  });
});

test("tracked decision preserves the clean controlled benchmark evidence", () => {
  assert.deepEqual(
    record.benchmark.runs.map(({ runId, headSha, topologies }) => ({
      runId,
      headSha,
      topologies,
    })),
    [
      {
        runId: 33385421742,
        headSha: "ced40c1b465cfeddba37c6299e4668a38d235139",
        topologies: [16, 20],
      },
      {
        runId: 34688798759,
        headSha: "144335888eb1129dfd8e4bc6f0fbc47644308af8",
        topologies: [16, 20],
      },
    ],
  );
  assert.deepEqual(
    record.benchmark.topologies.map(
      ({
        shards,
        modeledTestCriticalPathSeconds,
        topologyReadySeconds,
        reliable,
      }) => ({
        shards,
        modeledTestCriticalPathSeconds,
        topologyReadySeconds,
        reliable,
      }),
    ),
    [
      {
        shards: 16,
        modeledTestCriticalPathSeconds: 160,
        topologyReadySeconds: 289,
        reliable: true,
      },
      {
        shards: 20,
        modeledTestCriticalPathSeconds: 151,
        topologyReadySeconds: 287,
        reliable: false,
      },
    ],
  );
  assert.equal(record.benchmark.totalTests, 484);
  assert.equal(record.benchmark.bestReliableIsolatedModeledTestCriticalPathSeconds, 160);
  assert.equal(record.benchmark.selectedAverageTestsPerShard, 40.3);
  assert.deepEqual(record.operationalTopology, {
    maximumReliableConcurrentStacks: 16,
    evidenceRunId: 34690166145,
    url: "https://github.com/msrivas-7/CodeTutor-AI/actions/runs/34690166145",
    method: record.operationalTopology.method,
  });
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

test("blocking workflow uses the selected matrix and complete planned inventory", () => {
  const exhaustiveJob =
    workflow.match(/\n  e2e:\n([\s\S]+?)\n  cross-browser-core:/)?.[1] ?? "";
  const shardMatrix = exhaustiveJob
    .match(/matrix:\n\s+shard: \[([^\]]+)]/)?.[1]
    .split(",")
    .map((value) => Number(value.trim()));
  assert.deepEqual(
    shardMatrix,
    Array.from({ length: record.selectedShards }, (_, index) => index + 1),
  );
  assert.match(workflow, /--output e2e\/duration-plan\/full[\s\S]+--shards 12/);
  assert.match(
    exhaustiveJob,
    /--test-list=duration-plan-artifact\/full\/shard-\$\{\{ matrix\.shard }}\.txt/,
  );
  assert.match(exhaustiveJob, /name: Upload test-duration evidence/);
  assert.doesNotMatch(exhaustiveJob, /e2e-shard-capacity\.mjs/);
});

test("advisory critical coverage is split across two isolated duration-balanced jobs", () => {
  assert.match(
    workflow,
    /--output e2e\/duration-plan\/critical[\s\S]+--shards 2[\s\S]+--tag lane:critical/,
  );
  assert.match(workflow, /critical-shadow:[\s\S]+matrix:\n\s+shard: \[1, 2]/);
  assert.doesNotMatch(workflow, /critical-shadow-summary:/);
  assert.match(
    workflow,
    /shadow-evidence:[\s\S]+needs: \[duration-plan, critical-shadow, e2e, cross-browser-core][\s\S]+files\.length!==2/,
  );
});

test("derives every concurrent database stack from the workflow", () => {
  assert.deepEqual(deriveDatabaseStackFanout(workflow), {
    jobs: [
      { name: "critical-shadow", instances: 2 },
      { name: "e2e", instances: 12 },
      { name: "cross-browser-core", instances: 2 },
    ],
    totalConcurrentStacks: 16,
  });
});

test("capacity gate runs before any database-backed job can launch", () => {
  const planningJob =
    workflow.match(/\n  duration-plan:\n([\s\S]+?)\n  prepare-backend:/)?.[1] ??
    "";
  assert.match(planningJob, /name: Enforce measured database fan-out/);
  assert.match(planningJob, /--workflow \.github\/workflows\/e2e\.yml/);
  assert.match(planningJob, /--active-shards 12/);
  assert.match(
    planningJob,
    /Build coverage-complete duration plan[\s\S]+Enforce measured database fan-out[\s\S]+Upload duration plan/,
  );
  for (const job of ["critical-shadow", "e2e", "cross-browser-core"]) {
    assert.match(workflow, new RegExp(`\\n  ${job}:[\\s\\S]+?needs: \\[[^\\]]*duration-plan`));
  }
});

test("recognizes docker compose flags before the up command", () => {
  const workflowWithComposeFlags = workflow.replace(
    "docker compose up -d --no-build backend frontend",
    "docker compose --project-name isolated up -d --no-build backend frontend",
  );
  assert.deepEqual(
    deriveDatabaseStackFanout(workflowWithComposeFlags),
    deriveDatabaseStackFanout(workflow),
  );
});

test("fails closed when a database-backed matrix cannot be counted", () => {
  const dynamicMatrix = workflow.replace(
    "browser: [firefox, webkit]",
    "browser: ${{ fromJSON(needs.plan.outputs.browsers) }}",
  );
  assert.throws(
    () => deriveDatabaseStackFanout(dynamicMatrix),
    /cross-browser-core must use inline matrix lists/,
  );
});

test("duration planning receives the authenticated fixture environment required for discovery", () => {
  const planningJob =
    workflow.match(/\n  duration-plan:\n([\s\S]+?)\n  prepare-backend:/)?.[1] ??
    "";
  for (const variable of [
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "VITE_SUPABASE_URL",
    "VITE_SUPABASE_ANON_KEY",
    "DATABASE_URL",
    "BYOK_ENCRYPTION_KEY",
  ]) {
    assert.match(
      planningJob,
      new RegExp(`${variable}: \\$\\{\\{ secrets\\.${variable} }}`),
    );
  }
});

test("accepts the measured inventory and normal growth", () => {
  assert.equal(
    evaluateShardCapacity({ record, totalTests: 484, activeShards: 12, workflowSource: workflow })
      .eligible,
    true,
  );
  assert.equal(
    evaluateShardCapacity({ record, totalTests: 524, activeShards: 12, workflowSource: workflow })
      .eligible,
    true,
  );
  assert.equal(
    evaluateShardCapacity({ record, totalTests: 444, activeShards: 12, workflowSource: workflow })
      .eligible,
    true,
  );
});

test("requires a new benchmark at either capacity boundary", () => {
  const upper = evaluateShardCapacity({
    record,
    totalTests: 525,
    activeShards: 12,
    workflowSource: workflow,
  });
  const lower = evaluateShardCapacity({
    record,
    totalTests: 443,
    activeShards: 12,
    workflowSource: workflow,
  });
  assert.deepEqual(
    { eligible: upper.eligible, direction: upper.direction },
    { eligible: false, direction: "upper" },
  );
  assert.deepEqual(
    { eligible: lower.eligible, direction: lower.direction },
    { eligible: false, direction: "lower" },
  );
});

test("fails closed when workflow topology drifts from the measured record", () => {
  assert.throws(
    () => evaluateShardCapacity({
      record,
      totalTests: 437,
      activeShards: 10,
      workflowSource: workflow,
    }),
    /active workflow has 10 shards/,
  );
});

test("fails closed when the complete workflow exceeds measured database fan-out", () => {
  assert.throws(
    () => evaluateShardCapacity({
      record: { ...record, selectedShards: 16 },
      totalTests: 484,
      activeShards: 16,
      workflowSource: workflow.replace(
        "shard: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]",
        "shard: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]",
      ),
    }),
    /requests 20 concurrent stacks.*reliable limit is 16/,
  );
});

test("fails closed when recorded boundaries are stale or hand-edited", () => {
  assert.throws(
    () =>
      evaluateShardCapacity({
        record: {
          ...record,
          rebenchmark: { atOrBelowTests: 1, atOrAboveTests: 999 },
        },
        totalTests: 484,
        activeShards: 12,
        workflowSource: workflow,
      }),
    /capacity record bounds must be 443\/525/,
  );
});
