#!/usr/bin/env node

import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { buildDurationPlan, inventoryTests } from "./e2e-duration-plan.mjs";
import { deriveDatabaseStackFanout } from "./e2e-shard-capacity.mjs";

const HISTORY_SCHEMA_VERSION = 2;
const FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1_000;
const MAXIMUM_TRUSTED_DURATION_MS = 120_000;
const TRUSTED_HISTORY_ALGORITHMS = new Set(["seed-clean-run", "ewma-0.7"]);

function requirePositiveInteger(value, name) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
}

function durationValue(value) {
  return typeof value === "number" ? value : value?.durationMs;
}

export function evaluateHistory({ history, tests, now, maxAgeDays, minimumCoverage }) {
  if (history?.schemaVersion !== HISTORY_SCHEMA_VERSION) {
    return { eligible: false, reason: "unsupported-history-schema", coverage: 0 };
  }
  if (!TRUSTED_HISTORY_ALGORITHMS.has(history.algorithm)
      || !Number.isInteger(history?.source?.runId)
      || !/^[a-f0-9]{40}$/.test(history?.source?.headSha ?? "")) {
    return { eligible: false, reason: "invalid-history-provenance", coverage: 0 };
  }
  const generatedAtMs = Date.parse(history.generatedAt);
  const nowMs = new Date(now).getTime();
  if (!Number.isFinite(generatedAtMs) || !Number.isFinite(nowMs)) {
    return { eligible: false, reason: "invalid-history-timestamp", coverage: 0 };
  }
  if (generatedAtMs > nowMs + FUTURE_CLOCK_SKEW_MS) {
    return { eligible: false, reason: "future-history", coverage: 0 };
  }
  const ageDays = (nowMs - generatedAtMs) / (24 * 60 * 60 * 1_000);
  if (ageDays > maxAgeDays) {
    return { eligible: false, reason: "stale-history", coverage: 0, ageDays };
  }
  const invalid = tests.filter((test) => {
    const raw = history?.tests?.[test.id];
    if (raw === undefined) return false;
    const duration = durationValue(raw);
    return !Number.isFinite(duration) || duration <= 0 || duration > MAXIMUM_TRUSTED_DURATION_MS;
  });
  if (invalid.length > 0) {
    return { eligible: false, reason: "invalid-history-duration", coverage: 0, ageDays };
  }
  const measured = tests.filter((test) => {
    const duration = durationValue(history?.tests?.[test.id]);
    return Number.isFinite(duration) && duration > 0 && duration <= MAXIMUM_TRUSTED_DURATION_MS;
  }).length;
  const coverage = measured / tests.length;
  if (coverage < minimumCoverage) {
    return { eligible: false, reason: "insufficient-history-coverage", coverage, ageDays };
  }
  return { eligible: true, reason: "trusted-history", coverage, ageDays };
}

function estimateWorkerCriticalPath(shard, workersPerShard) {
  const workers = Array.from({ length: workersPerShard }, () => 0);
  const tests = [...shard.tests].sort(
    (left, right) => right.durationMs - left.durationMs || left.id.localeCompare(right.id),
  );
  for (const test of tests) {
    let target = 0;
    for (let index = 1; index < workers.length; index += 1) {
      if (workers[index] < workers[target]) target = index;
    }
    workers[target] += test.durationMs;
  }
  return Math.max(...workers);
}

function candidatePrediction({ tests, history, shards, workersPerShard, fixedOverheadMs }) {
  const plan = buildDurationPlan({ tests, history, shardCount: shards });
  const predictedTestCriticalPathMs = Math.max(
    ...plan.shards.map((shard) => estimateWorkerCriticalPath(shard, workersPerShard)),
  );
  return {
    shards,
    predictedTestCriticalPathMs,
    predictedWorkflowReadyMs: fixedOverheadMs + predictedTestCriticalPathMs,
  };
}

export function selectShardTopology({
  tests,
  history,
  record,
  workflowSource,
  now = new Date().toISOString(),
}) {
  requirePositiveInteger(record?.selectedShards, "selectedShards");
  requirePositiveInteger(record?.workersPerShard, "workersPerShard");
  requirePositiveInteger(
    record?.operationalTopology?.maximumReliableConcurrentStacks,
    "operationalTopology.maximumReliableConcurrentStacks",
  );
  requirePositiveInteger(
    record?.runtimeOptimization?.maximumChromiumShards,
    "runtimeOptimization.maximumChromiumShards",
  );
  const policy = record?.automaticSelection;
  requirePositiveInteger(policy?.minimumShards, "automaticSelection.minimumShards");
  requirePositiveInteger(policy?.historyMaxAgeDays, "automaticSelection.historyMaxAgeDays");
  if (!(policy?.minimumHistoryCoverage > 0 && policy.minimumHistoryCoverage <= 1)) {
    throw new Error("automaticSelection.minimumHistoryCoverage must be in (0, 1]");
  }
  if (!Number.isFinite(policy?.fixedOverheadSeconds) || policy.fixedOverheadSeconds < 0) {
    throw new Error("automaticSelection.fixedOverheadSeconds must be non-negative");
  }
  if (!Number.isFinite(record?.selectionPolicy?.minimumAbsoluteGainSeconds)
      || record.selectionPolicy.minimumAbsoluteGainSeconds < 0) {
    throw new Error("selectionPolicy.minimumAbsoluteGainSeconds must be non-negative");
  }
  if (!(record?.selectionPolicy?.minimumRelativeGain >= 0
      && record.selectionPolicy.minimumRelativeGain < 1)) {
    throw new Error("selectionPolicy.minimumRelativeGain must be in [0, 1)");
  }
  if (record.selectionPolicy.preservesFullChromiumSuite !== true) {
    throw new Error("automatic selection requires preservesFullChromiumSuite=true");
  }

  const configuredFallbackShards = record.selectedShards;
  const fanoutAtFallback = deriveDatabaseStackFanout(workflowSource, {
    dynamicJobInstances: { e2e: configuredFallbackShards },
  });
  const supportStacks = fanoutAtFallback.totalConcurrentStacks - configuredFallbackShards;
  if (supportStacks < 0) throw new Error("derived support stack count cannot be negative");
  const databaseShardLimit =
    record.operationalTopology.maximumReliableConcurrentStacks - supportStacks;
  const infrastructureShardLimit = Math.min(
    databaseShardLimit,
    record.runtimeOptimization.maximumChromiumShards,
  );
  if (configuredFallbackShards > infrastructureShardLimit) {
    throw new Error(
      `fallback requests ${configuredFallbackShards} shards but the current safe limit is ${infrastructureShardLimit}`,
    );
  }
  const maximumSafeShards = Math.min(infrastructureShardLimit, tests.length);
  requirePositiveInteger(maximumSafeShards, "maximumSafeShards");
  const fallbackShards = Math.min(configuredFallbackShards, maximumSafeShards);

  const historyAssessment = evaluateHistory({
    history,
    tests,
    now,
    maxAgeDays: policy.historyMaxAgeDays,
    minimumCoverage: policy.minimumHistoryCoverage,
  });
  const common = {
    schemaVersion: 1,
    selectedShards: fallbackShards,
    shardMatrix: Array.from({ length: fallbackShards }, (_, index) => index + 1),
    workersPerShard: record.workersPerShard,
    maximumSafeShards,
    supportStacks,
    history: historyAssessment,
    fixedOverheadMs: Math.round(policy.fixedOverheadSeconds * 1_000),
    predictions: [],
  };
  if (!historyAssessment.eligible) {
    return { ...common, reason: `fallback-${historyAssessment.reason}` };
  }

  const minimumShards = Math.min(policy.minimumShards, maximumSafeShards);
  const predictions = [];
  for (let shards = minimumShards; shards <= maximumSafeShards; shards += 1) {
    predictions.push(candidatePrediction({
      tests,
      history,
      shards,
      workersPerShard: record.workersPerShard,
      fixedOverheadMs: common.fixedOverheadMs,
    }));
  }
  const fastest = predictions.reduce((best, candidate) =>
    candidate.predictedWorkflowReadyMs < best.predictedWorkflowReadyMs ? candidate : best,
  );
  const minimumAbsoluteGainMs = record.selectionPolicy.minimumAbsoluteGainSeconds * 1_000;
  const selected = predictions.find((candidate) => {
    const absoluteGainMs = candidate.predictedWorkflowReadyMs - fastest.predictedWorkflowReadyMs;
    const relativeGain = absoluteGainMs / candidate.predictedWorkflowReadyMs;
    return absoluteGainMs < minimumAbsoluteGainMs
      || relativeGain < record.selectionPolicy.minimumRelativeGain;
  }) ?? fastest;

  return {
    ...common,
    selectedShards: selected.shards,
    shardMatrix: Array.from({ length: selected.shards }, (_, index) => index + 1),
    reason: selected.shards === maximumSafeShards
      ? "optimized-at-safe-limit"
      : "optimized-within-noise-floor",
    predictions,
    fastestSafeShards: fastest.shards,
    selectedPrediction: selected,
    capacityRebenchmarkRecommended:
      selected.shards === maximumSafeShards
      && (tests.length <= record.rebenchmark.atOrBelowTests
        || tests.length >= record.rebenchmark.atOrAboveTests),
  };
}

function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error(`invalid argument: ${key ?? "<missing>"}`);
    }
    values[key.slice(2)] = value;
  }
  return values;
}

function main() {
  const args = parseArguments(process.argv.slice(2));
  for (const required of [
    "inventory",
    "history",
    "fallback-history",
    "effective-history",
    "record",
    "workflow",
    "output",
  ]) {
    if (!args[required]) throw new Error(`missing --${required}`);
  }
  const report = JSON.parse(readFileSync(args.inventory, "utf8"));
  let history = null;
  try {
    history = JSON.parse(readFileSync(args.history, "utf8"));
  } catch {
    history = null;
  }
  const fallbackHistory = JSON.parse(readFileSync(args["fallback-history"], "utf8"));
  if (!fallbackHistory?.tests || typeof fallbackHistory.tests !== "object") {
    throw new Error("fallback history must contain a tests object");
  }
  const result = selectShardTopology({
    tests: inventoryTests(report),
    history,
    record: JSON.parse(readFileSync(args.record, "utf8")),
    workflowSource: readFileSync(args.workflow, "utf8"),
    now: args.now,
  });
  writeFileSync(args.output, `${JSON.stringify(result, null, 2)}\n`);
  writeFileSync(
    args["effective-history"],
    `${JSON.stringify(result.history.eligible ? history : fallbackHistory, null, 2)}\n`,
  );
  if (args["github-output"]) {
    appendFileSync(
      args["github-output"],
      `shard-count=${result.selectedShards}\nshard-matrix=${JSON.stringify(result.shardMatrix)}\nselection-reason=${result.reason}\n`,
    );
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`e2e-shard-select: ${error.message}`);
    process.exitCode = 1;
  }
}
