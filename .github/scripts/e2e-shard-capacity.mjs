#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

function requirePositiveInteger(value, name) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
}

export function deriveRebenchmarkBounds(totalTests, selectedShards) {
  requirePositiveInteger(totalTests, "benchmark.totalTests");
  requirePositiveInteger(selectedShards, "selectedShards");
  if (selectedShards < 2) {
    throw new Error("selectedShards must be at least 2 to derive a two-sided capacity band");
  }

  return {
    atOrBelowTests: Math.floor(totalTests * (selectedShards - 1) / selectedShards),
    atOrAboveTests: Math.ceil(totalTests * (selectedShards + 1) / selectedShards),
  };
}

export function evaluateShardCapacity({ record, totalTests, activeShards }) {
  if (record?.schemaVersion !== 1) {
    throw new Error("capacity record schemaVersion must be 1");
  }
  requirePositiveInteger(record.selectedShards, "selectedShards");
  requirePositiveInteger(record?.benchmark?.totalTests, "benchmark.totalTests");
  requirePositiveInteger(totalTests, "totalTests");
  requirePositiveInteger(activeShards, "activeShards");

  if (activeShards !== record.selectedShards) {
    throw new Error(
      `active workflow has ${activeShards} shards but the measured capacity record selects ${record.selectedShards}`,
    );
  }

  const expectedBounds = deriveRebenchmarkBounds(
    record.benchmark.totalTests,
    record.selectedShards,
  );
  const recordedBounds = record.rebenchmark ?? {};
  if (
    recordedBounds.atOrBelowTests !== expectedBounds.atOrBelowTests
    || recordedBounds.atOrAboveTests !== expectedBounds.atOrAboveTests
  ) {
    throw new Error(
      `capacity record bounds must be ${expectedBounds.atOrBelowTests}/${expectedBounds.atOrAboveTests} for the measured suite and topology`,
    );
  }

  const direction = totalTests <= expectedBounds.atOrBelowTests
    ? "lower"
    : totalTests >= expectedBounds.atOrAboveTests
      ? "upper"
      : null;

  return {
    eligible: direction === null,
    direction,
    totalTests,
    selectedShards: record.selectedShards,
    benchmarkTests: record.benchmark.totalTests,
    allowedMinimum: expectedBounds.atOrBelowTests + 1,
    allowedMaximum: expectedBounds.atOrAboveTests - 1,
    ...expectedBounds,
  };
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error("expected --record, --total-tests, and --active-shards arguments");
    }
    args[key.slice(2)] = value;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.record || !args["total-tests"] || !args["active-shards"]) {
    throw new Error("expected --record, --total-tests, and --active-shards arguments");
  }

  const record = JSON.parse(await readFile(args.record, "utf8"));
  const result = evaluateShardCapacity({
    record,
    totalTests: Number(args["total-tests"]),
    activeShards: Number(args["active-shards"]),
  });

  if (!result.eligible) {
    const boundary = result.direction === "upper" ? result.atOrAboveTests : result.atOrBelowTests;
    throw new Error(
      `Playwright rebenchmark required: ${result.totalTests} tests reached the ${result.direction} boundary (${boundary}) for the measured ${result.selectedShards}-shard topology. Run the label-triggered 6/8/10 benchmark on a stable commit and update the capacity record; do not remove tests from the blocking suite.`,
    );
  }

  console.log(
    `Playwright shard capacity is current: ${result.totalTests} tests, ${result.selectedShards} shards, rebenchmark outside ${result.allowedMinimum}-${result.allowedMaximum} tests.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`e2e-shard-capacity: ${error.message}`);
    process.exitCode = 1;
  });
}
