#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCHEMA_VERSION = 1;
const DEFAULT_DURATION_MS = 8_000;
const MINIMUM_DURATION_MS = 1_000;

function walkSuites(suites, ancestors = [], tests = []) {
  for (const suite of suites ?? []) {
    const nextAncestors = suite.title && suite.title !== suite.file
      ? [...ancestors, suite.title]
      : ancestors;
    for (const spec of suite.specs ?? []) {
      for (const project of spec.tests ?? []) {
        tests.push({
          id: spec.id,
          projectName: project.projectName,
          file: spec.file,
          line: spec.line,
          column: spec.column,
          path: nextAncestors.filter(Boolean),
          title: spec.title,
          tags: spec.tags ?? [],
        });
      }
    }
    walkSuites(suite.suites, nextAncestors, tests);
  }
  return tests;
}

export function inventoryTests(report, { project = "chromium", tag } = {}) {
  const tests = walkSuites(report?.suites).filter((test) =>
    test.projectName === project && (!tag || test.tags.includes(tag)),
  );
  const ids = new Set();
  const selectors = new Set();
  for (const test of tests) {
    if (!test.id || ids.has(test.id)) {
      throw new Error(`inventory contains a missing or duplicate test id: ${test.id ?? "<missing>"}`);
    }
    ids.add(test.id);
    test.selector = [
      `[${test.projectName}]`,
      `${test.file}:${test.line}:${test.column}`,
      ...test.path,
      test.title,
    ].join(" › ");
    if (selectors.has(test.selector)) {
      throw new Error(`inventory contains a duplicate selector: ${test.selector}`);
    }
    selectors.add(test.selector);
  }
  if (tests.length === 0) throw new Error("inventory did not contain any matching tests");
  return tests;
}

function durationFor(test, history) {
  const value = history?.tests?.[test.id];
  const duration = typeof value === "number" ? value : value?.durationMs;
  return Number.isFinite(duration) && duration > 0
    ? Math.max(MINIMUM_DURATION_MS, Math.round(duration))
    : DEFAULT_DURATION_MS;
}

export function buildDurationPlan({ tests, history, shardCount }) {
  if (!Number.isInteger(shardCount) || shardCount < 1) {
    throw new Error("shard count must be a positive integer");
  }
  const shards = Array.from({ length: shardCount }, (_, index) => ({
    shard: index + 1,
    predictedWorkMs: 0,
    tests: [],
  }));
  const weighted = tests
    .map((test) => ({ ...test, durationMs: durationFor(test, history) }))
    .sort((left, right) => right.durationMs - left.durationMs || left.id.localeCompare(right.id));

  for (const test of weighted) {
    shards.sort((left, right) =>
      left.predictedWorkMs - right.predictedWorkMs ||
      left.tests.length - right.tests.length ||
      left.shard - right.shard,
    );
    shards[0].tests.push(test);
    shards[0].predictedWorkMs += test.durationMs;
  }
  shards.sort((left, right) => left.shard - right.shard);

  const plannedIds = shards.flatMap((shard) => shard.tests.map((test) => test.id));
  if (plannedIds.length !== tests.length || new Set(plannedIds).size !== tests.length) {
    throw new Error("duration plan did not assign every inventory test exactly once");
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    algorithm: "longest-predicted-first",
    testCount: tests.length,
    shardCount,
    defaultDurationMs: DEFAULT_DURATION_MS,
    shards,
  };
}

export function writeDurationPlan(plan, outputDirectory) {
  mkdirSync(outputDirectory, { recursive: true });
  const manifest = {
    ...plan,
    shards: plan.shards.map((shard) => ({
      shard: shard.shard,
      predictedWorkMs: shard.predictedWorkMs,
      testCount: shard.tests.length,
      file: `shard-${shard.shard}.txt`,
    })),
  };
  for (const shard of plan.shards) {
    writeFileSync(
      resolve(outputDirectory, `shard-${shard.shard}.txt`),
      `${shard.tests.map((test) => test.selector).join("\n")}\n`,
    );
  }
  writeFileSync(resolve(outputDirectory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error(`invalid argument: ${key ?? "<missing>"}`);
    values[key.slice(2)] = value;
  }
  return values;
}

function main() {
  const args = parseArguments(process.argv.slice(2));
  if (!args.inventory || !args.history || !args.output || !args.shards) {
    throw new Error("usage: e2e-duration-plan.mjs --inventory <json> --history <json> --output <dir> --shards <count> [--tag <tag>]");
  }
  const inventory = JSON.parse(readFileSync(args.inventory, "utf8"));
  const history = JSON.parse(readFileSync(args.history, "utf8"));
  const tests = inventoryTests(inventory, { tag: args.tag });
  const plan = buildDurationPlan({ tests, history, shardCount: Number(args.shards) });
  const manifest = writeDurationPlan(plan, args.output);
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`e2e-duration-plan: ${error.message}`);
    process.exitCode = 1;
  }
}
