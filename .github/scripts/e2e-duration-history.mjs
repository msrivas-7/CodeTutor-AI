#!/usr/bin/env node

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCHEMA_VERSION = 1;
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
    schemaVersion: SCHEMA_VERSION,
    algorithm: "ewma-0.7",
    tests: Object.fromEntries(Object.entries(tests).sort(([left], [right]) => left.localeCompare(right))),
  };
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
  if (!args.base || !args.input || !args.output) {
    throw new Error("usage: e2e-duration-history.mjs --base <json> --input <dir> --output <json>");
  }
  const reports = timingFiles(args.input).map((file) => ({
    name: basename(file),
    report: JSON.parse(readFileSync(file, "utf8")),
  }));
  const result = mergeDurationHistory({
    base: JSON.parse(readFileSync(args.base, "utf8")),
    reports,
  });
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
