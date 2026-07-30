#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const SHA_RE = /^[0-9a-f]{40}$/;
const IMAGE_REF_RE = /^ghcr\.io\/[a-z0-9_.-]+\/[a-z0-9_.-]+@sha256:[0-9a-f]{64}$/;

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const values = {};

  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index];
    const value = rest[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error(`Invalid argument near ${key ?? "<end>"}`);
    }
    values[key.slice(2)] = value;
  }

  return { command, values };
}

function required(values, key) {
  const value = values[key];
  if (!value) throw new Error(`Missing --${key}`);
  return value;
}

function parseBoolean(value, key) {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`--${key} must be true or false`);
}

async function sha256(path) {
  const contents = await readFile(path);
  return createHash("sha256").update(contents).digest("hex");
}

function validateImageRef(value, label) {
  if (!IMAGE_REF_RE.test(value)) {
    throw new Error(`${label} must be an immutable GHCR digest reference`);
  }
}

function validateManifest(manifest, expectedSha) {
  if (manifest.schemaVersion !== 1) throw new Error("Unsupported manifest schemaVersion");
  if (!SHA_RE.test(manifest.gitSha)) throw new Error("Manifest gitSha must be a full lowercase SHA");
  if (expectedSha && manifest.gitSha !== expectedSha) {
    throw new Error(`Manifest SHA ${manifest.gitSha} does not match ${expectedSha}`);
  }
  if (!/^\d+$/.test(manifest.workflowRunId)) {
    throw new Error("Manifest workflowRunId must be numeric");
  }
  if (Number.isNaN(Date.parse(manifest.createdAt))) {
    throw new Error("Manifest createdAt must be an ISO timestamp");
  }
  if (
    JSON.stringify(manifest.requiredGates) !==
    JSON.stringify(["CI", "E2E", "Security suite"])
  ) {
    throw new Error("Manifest must name the complete required gate set");
  }
  if (
    manifest.compatibility?.database !== "expand-contract-required" ||
    manifest.compatibility?.partialPromotion !== "backend-first-frontend-second"
  ) {
    throw new Error("Manifest compatibility contract is invalid");
  }
  for (const component of ["backend", "runner", "frontend"]) {
    if (typeof manifest.changes?.[component] !== "boolean") {
      throw new Error(`Manifest changes.${component} must be boolean`);
    }
  }

  validateImageRef(manifest.artifacts?.backend?.ref ?? "", "Backend ref");
  validateImageRef(manifest.artifacts?.runner?.ref ?? "", "Runner ref");

  if (!/^[0-9a-f]{64}$/.test(manifest.artifacts?.frontend?.sha256 ?? "")) {
    throw new Error("Frontend artifact must have a SHA-256 digest");
  }
  if (manifest.artifacts?.frontend?.archive !== "production-swa-bundle.tar.gz") {
    throw new Error("Frontend artifact name is invalid");
  }
}

async function createManifest(values) {
  const gitSha = required(values, "sha");
  const backendRef = required(values, "backend-ref");
  const runnerRef = required(values, "runner-ref");
  const frontendArchive = required(values, "frontend-archive");
  const output = required(values, "output");

  if (!SHA_RE.test(gitSha)) throw new Error("--sha must be a full lowercase Git SHA");
  validateImageRef(backendRef, "Backend ref");
  validateImageRef(runnerRef, "Runner ref");

  const manifest = {
    schemaVersion: 1,
    gitSha,
    workflowRunId: required(values, "run-id"),
    createdAt: new Date().toISOString(),
    compatibility: {
      database: "expand-contract-required",
      partialPromotion: "backend-first-frontend-second",
    },
    requiredGates: ["CI", "E2E", "Security suite"],
    changes: {
      backend: parseBoolean(required(values, "backend-changed"), "backend-changed"),
      runner: parseBoolean(required(values, "runner-changed"), "runner-changed"),
      frontend: parseBoolean(required(values, "frontend-changed"), "frontend-changed"),
    },
    artifacts: {
      backend: { ref: backendRef },
      runner: { ref: runnerRef },
      frontend: {
        archive: "production-swa-bundle.tar.gz",
        sha256: await sha256(frontendArchive),
      },
    },
  };

  validateManifest(manifest, gitSha);
  await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

async function verifyManifest(values) {
  const manifestPath = required(values, "manifest");
  const frontendArchive = required(values, "frontend-archive");
  const expectedSha = required(values, "sha");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

  validateManifest(manifest, expectedSha);
  const actualFrontendDigest = await sha256(frontendArchive);
  if (actualFrontendDigest !== manifest.artifacts.frontend.sha256) {
    throw new Error(
      `Frontend digest mismatch: ${actualFrontendDigest} != ${manifest.artifacts.frontend.sha256}`,
    );
  }

  process.stdout.write(`${JSON.stringify(manifest)}\n`);
}

const { command, values } = parseArgs(process.argv.slice(2));
if (command === "create") await createManifest(values);
else if (command === "verify") await verifyManifest(values);
else throw new Error("Usage: release-manifest.mjs <create|verify> [--key value ...]");
