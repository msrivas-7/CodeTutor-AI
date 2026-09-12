#!/usr/bin/env node

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCHEMA_VERSION = 1;
const HISTORY_SCHEMA_VERSION = 2;
const PREVIOUS_WEIGHT = 0.7;

function timingFiles(root) {
  const files = [];
  for (const entry of readdirSync(root)) {
    const candidate = join(root, entry);
    if (statSync(candidate).isDirectory()) files.push(...timingFiles(candidate));
    else if (entry.endsWith(".json")) files.push(candidate);
  }
  return files.sort();
}
function normalizeBase(value) {
  if (typeof value === "number") return { durationMs: value, samples: 1 };
  return {
    durationMs: value?.durationMs,
    samples: Number.isInteger(value?.samples) ? value.samples : 1,
  };
}

export function mergeDurationHistory({ base, reports }) {
  const tests = Object.fromEntries(
    Object.entries(base?.tests ?? {}).map(([id, value]) => [id, normalizeBase(value)]),
  );
  const observed = new Set();
  for (const { name, report } of reports) {
    if (report?.schemaVersion !== SCHEMA_VERSION) throw new Error(`${name} has an unsupported schema`);
    if (report.status !== "passed") throw new Error(`${name} did not record a clean Playwright run`);
    for (const [id, timing] of Object.entries(report.tests ?? {})) {
      if (observed.has(id)) throw new Error(`duplicate timing for test ${id}`);
      observed.add(id);
      if (timing.status !== "passed" || !Number.isFinite(timing.durationMs) || timing.durationMs <= 0) continue;
      const previous = tests[id];
      tests[id] = previous && Number.isFinite(previous.durationMs)
        ? {
            durationMs: Math.round(previous.durationMs * PREVIOUS_WEIGHT + timing.durationMs * (1 - PREVIOUS_WEIGHT)),
            samples: Math.min(20, previous.samples + 1),
          }
        : { durationMs: Math.round(timing.durationMs), samples: 1 };
    }
  }
  if (observed.size === 0) throw new Error("no passing test timings were found");
  return {
    schemaVersion: HISTORY_SCHEMA_VERSION,
    algorithm: "ewma-0.7",
    tests: Object.fromEntries(Object.entries(tests).sort(([left], [right]) => left.localeCompare(right))),
  };
}

export function selectLatestCleanReports(reports, expectedShards) {
  if (!Number.isInteger(expectedShards) || expectedShards <= 0) {
    throw new Error("expected shard count must be a positive integer");
  }
  const selected = new Map();
  for (const candidate of reports) {
    const match = candidate.name.match(/^shard-(\d+)-attempt-(\d+)\.json$/);
    if (!match) throw new Error(`${candidate.name} does not contain shard and attempt provenance`);
    const shard = Number(match[1]);
    const attempt = Number(match[2]);
    if (shard < 1 || shard > expectedShards || attempt < 1) {
      throw new Error(`${candidate.name} has invalid shard or attempt provenance`);
    }
    if (candidate.report?.schemaVersion !== SCHEMA_VERSION) {
      throw new Error(`${candidate.name} has an unsupported schema`);
    }
    if (candidate.report.status !== "passed") continue;
    const previous = selected.get(shard);
    if (!previous || attempt > previous.attempt) {
      selected.set(shard, { ...candidate, shard, attempt });
    } else if (attempt === previous.attempt) {
      throw new Error(`duplicate clean timing artifacts for shard ${shard} attempt ${attempt}`);
    }
  }
  const missing = Array.from({ length: expectedShards }, (_, index) => index + 1)
    .filter((shard) => !selected.has(shard));
  if (missing.length > 0) {
    throw new Error(`no clean timing artifact for shard(s): ${missing.join(", ")}`);
  }
  return [...selected.values()].sort((left, right) => left.shard - right.shard);
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
  if (!args.base || !args.input || !args.output || !args["expected-shards"] || !args["generated-at"]) {
    throw new Error("usage: e2e-duration-history.mjs --base <json> --input <dir> --output <json> --expected-shards <count> --generated-at <iso> [--source-run <id>] [--source-sha <sha>]");
  }
  const reports = selectLatestCleanReports(timingFiles(args.input).map((file) => ({
    name: basename(file),
    report: JSON.parse(readFileSync(file, "utf8")),
  })), Number(args["expected-shards"]));
  const result = mergeDurationHistory({
    base: JSON.parse(readFileSync(args.base, "utf8")),
    reports,
  });
  result.generatedAt = new Date(args["generated-at"]).toISOString();
  result.source = {
    runId: args["source-run"] ? Number(args["source-run"]) : undefined,
    headSha: args["source-sha"] || undefined,
  };
  writeFileSync(args.output, `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`updated ${Object.keys(result.tests).length} duration records from ${reports.length} shards\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`e2e-duration-history: ${error.message}`);
    process.exitCode = 1;
  }
}
