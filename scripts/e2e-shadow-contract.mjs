#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(SCRIPT_DIR, "..");
const DEFAULT_CORPUS = path.join(DEFAULT_ROOT, "e2e/shadow/regression-corpus.json");
const DEFAULT_MIGRATION_PILOTS = path.join(DEFAULT_ROOT, "e2e/shadow/migration-pilots.json");

const ALLOWED = {
  risk: new Set(["p0", "p1"]),
  owner: new Set([
    "accessibility",
    "auth",
    "editor",
    "learning",
    "platform",
    "security",
    "share",
    "tutor",
  ]),
  browser: new Set(["chromium", "firefox", "webkit"]),
  device: new Set(["desktop", "phone", "tablet"]),
};

function fail(errors) {
  const detail = errors.map((error) => `- ${error}`).join("\n");
  throw new Error(`E2E shadow contract failed:\n${detail}`);
}

function collectSpecs(suites, parents = [], output = []) {
  for (const suite of suites ?? []) {
    const nextParents = suite.title ? [...parents, suite.title] : parents;
    for (const spec of suite.specs ?? []) {
      output.push({ ...spec, titlePath: [...nextParents, spec.title].join(" › ") });
    }
    collectSpecs(suite.suites, nextParents, output);
  }
  return output;
}

function valuesFor(tags, prefix) {
  return tags
    .filter((tag) => tag.startsWith(`${prefix}:`))
    .map((tag) => tag.slice(prefix.length + 1));
}

function validateMetadata(spec, errors) {
  const label = `${spec.file} › ${spec.title}`;
  const tags = (spec.tags ?? []).map((tag) => tag.replace(/^@/, ""));
  if (!tags.includes("lane:critical")) {
    errors.push(`${label}: missing lane:critical tag`);
  }

  for (const dimension of ["risk", "owner", "browser", "device", "quarantine"]) {
    const values = valuesFor(tags, dimension);
    if (values.length === 0) {
      errors.push(`${label}: missing ${dimension} metadata`);
      continue;
    }
    if ((dimension === "risk" || dimension === "owner" || dimension === "quarantine") && values.length !== 1) {
      errors.push(`${label}: expected exactly one ${dimension} value, found ${values.join(", ")}`);
    }
  }

  for (const dimension of ["risk", "owner", "browser", "device"]) {
    for (const value of valuesFor(tags, dimension)) {
      if (!ALLOWED[dimension].has(value)) {
        errors.push(`${label}: unsupported ${dimension} value ${value}`);
      }
    }
  }

  const quarantine = valuesFor(tags, "quarantine");
  if (quarantine.length === 1 && quarantine[0] !== "none") {
    errors.push(`${label}: critical lane cannot contain active quarantine`);
  }

  if (!Array.isArray(spec.tests) || spec.tests.length === 0) {
    errors.push(`${label}: Playwright inventory contains no project test records`);
  }
  for (const test of spec.tests ?? []) {
    if (test.expectedStatus !== "passed") {
      errors.push(`${label}: expectedStatus must be passed, found ${test.expectedStatus}`);
    }
    const annotationTypes = new Set((test.annotations ?? []).map(({ type }) => type));
    for (const dimension of ["risk", "owner", "browser", "device", "quarantine"]) {
      if (!annotationTypes.has(dimension)) {
        errors.push(`${label}: missing ${dimension} annotation`);
      }
    }
    const annotationValues = new Map(
      (test.annotations ?? []).map(({ type, description }) => [type, description]),
    );
    for (const dimension of ["risk", "owner", "quarantine"]) {
      const tagged = valuesFor(tags, dimension);
      if (tagged.length === 1 && annotationValues.get(dimension) !== tagged[0]) {
        errors.push(`${label}: ${dimension} annotation does not match its tag`);
      }
    }
    for (const dimension of ["browser", "device"]) {
      const tagged = valuesFor(tags, dimension).sort().join(",");
      const annotated = String(annotationValues.get(dimension) ?? "")
        .split(",")
        .filter(Boolean)
        .sort()
        .join(",");
      if (tagged && tagged !== annotated) {
        errors.push(`${label}: ${dimension} annotation does not match its tags`);
      }
    }
  }
}

function validateCorpus(corpus, specs, rootDir, errors) {
  if (corpus.schemaVersion !== 1) errors.push("regression corpus schemaVersion must be 1");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(corpus.frozenAt ?? "")) {
    errors.push("regression corpus frozenAt must be an ISO date");
  }
  if (!Array.isArray(corpus.entries) || corpus.entries.length === 0) {
    errors.push("regression corpus must contain entries");
    return;
  }

  const ids = new Set();
  for (const entry of corpus.entries) {
    if (!entry.id || ids.has(entry.id)) errors.push(`regression corpus has missing or duplicate id ${entry.id ?? "<missing>"}`);
    ids.add(entry.id);
    if (!ALLOWED.risk.has(entry.severity)) errors.push(`${entry.id}: severity must be p0 or p1`);
    if (!new Set(["historical", "seeded"]).has(entry.source)) {
      errors.push(`${entry.id}: source must be historical or seeded`);
    }
    if (!entry.originatingDefect?.trim()) errors.push(`${entry.id}: originatingDefect is required`);

    const layer = entry.expectedCatchingLayer;
    if (layer?.kind === "critical-browser") {
      const caught = specs.some(
        (spec) => spec.file === layer.file && spec.titlePath.includes(layer.titleIncludes),
      );
      if (!caught) {
        errors.push(`${entry.id}: no critical browser test matches ${layer.file} / ${layer.titleIncludes}`);
      }
    } else if (layer?.kind === "lower-layer") {
      const sourcePath = path.resolve(rootDir, layer.file ?? "");
      if (!layer.testIncludes?.trim()) {
        errors.push(`${entry.id}: lower-layer test anchor is required`);
      } else if (!sourcePath.startsWith(`${path.resolve(rootDir)}${path.sep}`) || !fs.existsSync(sourcePath)) {
        errors.push(`${entry.id}: lower-layer file does not exist: ${layer?.file ?? "<missing>"}`);
      } else if (!fs.readFileSync(sourcePath, "utf8").includes(layer.testIncludes)) {
        errors.push(`${entry.id}: lower-layer test anchor is missing from ${layer.file}`);
      }
    } else {
      errors.push(`${entry.id}: expectedCatchingLayer kind is invalid`);
    }
  }
}

function sourceContains(rootDir, file, anchor, label, errors) {
  if (!file?.trim() || !anchor?.trim()) {
    errors.push(`${label}: file and non-empty test anchor are required`);
    return;
  }
  const sourcePath = path.resolve(rootDir, file ?? "");
  if (!sourcePath.startsWith(`${path.resolve(rootDir)}${path.sep}`) || !fs.existsSync(sourcePath)) {
    errors.push(`${label}: file does not exist: ${file ?? "<missing>"}`);
  } else if (!fs.readFileSync(sourcePath, "utf8").includes(anchor ?? "")) {
    errors.push(`${label}: test anchor is missing from ${file}`);
  }
}

function validateMigrationPilots(migrationPilots, rootDir, errors) {
  if (!migrationPilots) return 0;
  if (migrationPilots.schemaVersion !== 1 || migrationPilots.status !== "shadow") {
    errors.push("migration pilots must use schemaVersion 1 and shadow status");
  }
  if (!Array.isArray(migrationPilots.pilots) || migrationPilots.pilots.length !== 3) {
    errors.push("exactly three migration pilots are required");
    return migrationPilots.pilots?.length ?? 0;
  }
  const ids = new Set();
  for (const pilot of migrationPilots.pilots) {
    if (!pilot.id || ids.has(pilot.id)) errors.push(`migration pilot has missing or duplicate id ${pilot.id ?? "<missing>"}`);
    ids.add(pilot.id);
    if (!Array.isArray(pilot.lowerLayerProof) || pilot.lowerLayerProof.length === 0) {
      errors.push(`${pilot.id}: lowerLayerProof is required`);
    }
    for (const proof of pilot.lowerLayerProof ?? []) {
      sourceContains(rootDir, proof.file, proof.testIncludes, pilot.id, errors);
    }
    const retained = pilot.retainedBrowserBoundary;
    sourceContains(
      rootDir,
      retained?.file ? path.join("e2e/specs", retained.file) : undefined,
      retained?.titleIncludes,
      `${pilot.id} retained browser boundary`,
      errors,
    );
    if (pilot.demotion !== "none") errors.push(`${pilot.id}: browser demotion is forbidden during shadow`);
  }
  return migrationPilots.pilots.length;
}

export function validateShadowContract({
  inventory,
  corpus,
  migrationPilots = null,
  rootDir = DEFAULT_ROOT,
}) {
  const errors = [];
  const specs = collectSpecs(inventory.suites);
  if (specs.length === 0) errors.push("critical inventory is empty");
  for (const spec of specs) validateMetadata(spec, errors);

  const files = new Set(specs.map(({ file }) => file));
  const minimumTests = corpus.criticalLane?.minimumTests;
  const minimumFiles = corpus.criticalLane?.minimumFiles;
  if (!Number.isInteger(minimumTests) || specs.length < minimumTests) {
    errors.push(`critical inventory has ${specs.length} tests; minimum is ${minimumTests ?? "unset"}`);
  }
  if (!Number.isInteger(minimumFiles) || files.size < minimumFiles) {
    errors.push(`critical inventory has ${files.size} files; minimum is ${minimumFiles ?? "unset"}`);
  }

  validateCorpus(corpus, specs, rootDir, errors);
  const migrationPilotCount = validateMigrationPilots(migrationPilots, rootDir, errors);
  if (errors.length > 0) fail(errors);
  return {
    tests: specs.length,
    files: files.size,
    corpusEntries: corpus.entries.length,
    migrationPilots: migrationPilotCount,
  };
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function main() {
  const inventoryPath = argument("--inventory");
  if (!inventoryPath) throw new Error("Usage: e2e-shadow-contract.mjs --inventory <playwright-json> [--corpus <json>]");
  const corpusPath = argument("--corpus") ?? DEFAULT_CORPUS;
  const summary = validateShadowContract({
    inventory: JSON.parse(fs.readFileSync(inventoryPath, "utf8")),
    corpus: JSON.parse(fs.readFileSync(corpusPath, "utf8")),
    migrationPilots: JSON.parse(fs.readFileSync(DEFAULT_MIGRATION_PILOTS, "utf8")),
  });
  console.log(
    `E2E shadow contract passed: ${summary.tests} critical tests in ${summary.files} files cover ${summary.corpusEntries} frozen P0/P1 regressions and ${summary.migrationPilots} migration pilots.`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
