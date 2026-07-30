import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const SCRIPT = new URL("./release-manifest.mjs", import.meta.url).pathname;
const SHA = "a".repeat(40);
const DIGEST = "b".repeat(64);

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "release-manifest-"));
  const archive = join(directory, "production-swa-bundle.tar.gz");
  const manifest = join(directory, "release-manifest.json");
  await writeFile(archive, "immutable frontend bytes", "utf8");
  return { archive, manifest };
}

async function create({ archive, manifest }) {
  await execFileAsync(process.execPath, [
    SCRIPT,
    "create",
    "--sha",
    SHA,
    "--run-id",
    "1234",
    "--backend-ref",
    `ghcr.io/msrivas-7/codetutor-backend@sha256:${DIGEST}`,
    "--runner-ref",
    `ghcr.io/msrivas-7/codetutor-runner@sha256:${DIGEST}`,
    "--frontend-archive",
    archive,
    "--frontend-changed",
    "true",
    "--backend-changed",
    "false",
    "--runner-changed",
    "true",
    "--output",
    manifest,
  ]);
}

test("creates and verifies an immutable candidate manifest", async () => {
  const files = await fixture();
  await create(files);

  const parsed = JSON.parse(await readFile(files.manifest, "utf8"));
  assert.equal(parsed.gitSha, SHA);
  assert.equal(parsed.changes.backend, false);
  assert.equal(parsed.changes.runner, true);
  assert.match(parsed.artifacts.frontend.sha256, /^[0-9a-f]{64}$/);

  await execFileAsync(process.execPath, [
    SCRIPT,
    "verify",
    "--manifest",
    files.manifest,
    "--frontend-archive",
    files.archive,
    "--sha",
    SHA,
  ]);
});

test("rejects modified frontend bytes", async () => {
  const files = await fixture();
  await create(files);
  await writeFile(files.archive, "tampered bytes", "utf8");

  await assert.rejects(
    execFileAsync(process.execPath, [
      SCRIPT,
      "verify",
      "--manifest",
      files.manifest,
      "--frontend-archive",
      files.archive,
      "--sha",
      SHA,
    ]),
    /Frontend digest mismatch/,
  );
});

test("rejects a different commit SHA", async () => {
  const files = await fixture();
  await create(files);

  await assert.rejects(
    execFileAsync(process.execPath, [
      SCRIPT,
      "verify",
      "--manifest",
      files.manifest,
      "--frontend-archive",
      files.archive,
      "--sha",
      "c".repeat(40),
    ]),
    /does not match/,
  );
});

test("rejects a mutable backend image reference", async () => {
  const files = await fixture();
  await create(files);
  const parsed = JSON.parse(await readFile(files.manifest, "utf8"));
  parsed.artifacts.backend.ref = "ghcr.io/msrivas-7/codetutor-backend:latest";
  await writeFile(files.manifest, `${JSON.stringify(parsed)}\n`, "utf8");

  await assert.rejects(
    execFileAsync(process.execPath, [
      SCRIPT,
      "verify",
      "--manifest",
      files.manifest,
      "--frontend-archive",
      files.archive,
      "--sha",
      SHA,
    ]),
    /immutable GHCR digest reference/,
  );
});

test("rejects a manifest with an incomplete required gate set", async () => {
  const files = await fixture();
  await create(files);
  const parsed = JSON.parse(await readFile(files.manifest, "utf8"));
  parsed.requiredGates = ["CI", "E2E"];
  await writeFile(files.manifest, `${JSON.stringify(parsed)}\n`, "utf8");

  await assert.rejects(
    execFileAsync(process.execPath, [
      SCRIPT,
      "verify",
      "--manifest",
      files.manifest,
      "--frontend-archive",
      files.archive,
      "--sha",
      SHA,
    ]),
    /complete required gate set/,
  );
});
