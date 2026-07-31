import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const HARNESS_SCRIPT = path.join(SCRIPT_DIR, "agent-harness.mjs");
const SEED = fs.readFileSync(path.join(SCRIPT_DIR, "agent-harness-seed.json"), "utf8");

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codetutor-agent-harness-"));
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  fs.writeFileSync(path.join(root, ".gitignore"), ".agent-harness/\n");
  fs.writeFileSync(
    path.join(root, "AGENTS.md"),
    "Required learning loop\nagent-harness.mjs start\nagent-harness.mjs doctor\n",
  );
  fs.writeFileSync(path.join(root, "CLAUDE.md"), "@AGENTS.md\n");
  fs.writeFileSync(path.join(root, "docs", "AGENT_HARNESS_STRATEGY.md"), "# Strategy\n");
  fs.writeFileSync(path.join(root, "scripts", "agent-harness.mjs"), "// fixture marker\n");
  fs.writeFileSync(path.join(root, "scripts", "agent-harness.test.mjs"), "// fixture marker\n");
  fs.writeFileSync(path.join(root, "scripts", "agent-harness-seed.json"), SEED);
  return root;
}

function run(root, args) {
  return spawnSync(process.execPath, [HARNESS_SCRIPT, ...args], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_ENV: "test",
      AGENT_HARNESS_TEST_ROOT: root,
    },
  });
}

test("initializes a local readable store and passes the tracked contract doctor", () => {
  const root = fixture();
  const initialized = run(root, ["init"]);
  assert.equal(initialized.status, 0, initialized.stderr);
  assert.match(fs.readFileSync(path.join(root, ".agent-harness", "PROJECT_MEMORY.md"), "utf8"), /local project memory/i);
  const doctor = run(root, ["doctor", "--ci"]);
  assert.equal(doctor.status, 0, doctor.stderr);
  assert.match(doctor.stdout, /doctor passed/i);
});

test("promotes a repeated candidate while preserving its repetition provenance", () => {
  const root = fixture();
  const args = [
    "record",
    "--scope", "backend",
    "--symptom", "A test starts from the wrong working directory.",
    "--cause", "The helper resolves fixtures relative to the backend package.",
    "--prevention", "Run this helper from backend or pass an explicit absolute fixture root.",
    "--evidence", "Reproduced twice with the same command and fixed by the explicit root.",
  ];
  assert.equal(run(root, args).status, 0);
  assert.equal(run(root, args).status, 0);
  const knowledge = JSON.parse(
    fs.readFileSync(path.join(root, ".agent-harness", "knowledge.json"), "utf8"),
  );
  const entry = knowledge.entries.find((item) => item.symptom.startsWith("A test starts"));
  assert.equal(entry.occurrences, 2);
  assert.equal(entry.confidence, "repeated");
  assert.equal(entry.promotionReason, "repeated-observation");
});

test("rejects secret-like content before persistence", () => {
  const root = fixture();
  const result = run(root, [
    "record",
    "--scope", "backend",
    "--symptom", "A credential failed.",
    "--cause", "API_KEY=sk-abcdefghijklmnop123456",
    "--prevention", "Do not store credentials.",
    "--evidence", "Local observation.",
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /contains a secret/i);
  const memory = fs.readFileSync(path.join(root, ".agent-harness", "PROJECT_MEMORY.md"), "utf8");
  assert.doesNotMatch(memory, /abcdefghijklmnop/);
});

test("redacts secret-like command arguments from validation history", () => {
  const root = fixture();
  const started = run(root, ["start", "--feature", "command redaction", "--scope", "backend"]);
  const session = started.stdout.match(/HARNESS_SESSION_ID=([0-9a-f-]+)/)?.[1];
  assert.ok(session);
  const token = "sk-abcdefghijklmnop123456";
  const validation = run(root, [
    "run",
    "--session", session,
    "--",
    process.execPath,
    "-e",
    `void '${token}'`,
  ]);
  assert.equal(validation.status, 0, validation.stderr);
  const stored = fs.readFileSync(
    path.join(root, ".agent-harness", "sessions", `${session}.json`),
    "utf8",
  );
  assert.doesNotMatch(stored, /abcdefghijklmnop/);
  assert.match(stored, /<redacted>/);
});

test("rejects compound shell validations that can mask an earlier failure", () => {
  const root = fixture();
  const started = run(root, ["start", "--feature", "shell fail fast", "--scope", "release"]);
  const session = started.stdout.match(/HARNESS_SESSION_ID=([0-9a-f-]+)/)?.[1];
  assert.ok(session);

  const unsafe = run(root, [
    "run", "--session", session, "--", "bash", "-lc", "false; echo masked",
  ]);
  assert.notEqual(unsafe.status, 0);
  assert.match(unsafe.stderr, /must begin with fail-fast/i);

  const safe = run(root, [
    "run", "--session", session, "--", "bash", "-lc", "set -euo pipefail; true; echo checked",
  ]);
  assert.equal(safe.status, 0, safe.stderr);
});

test("blocks session completion until failed validation is classified", () => {
  const root = fixture();
  const started = run(root, ["start", "--feature", "failure lifecycle", "--scope", "backend"]);
  assert.equal(started.status, 0, started.stderr);
  const session = started.stdout.match(/HARNESS_SESSION_ID=([0-9a-f-]+)/)?.[1];
  assert.ok(session);
  const failed = run(root, [
    "run",
    "--session", session,
    "--scope", "backend",
    "--",
    process.execPath,
    "-e",
    "process.exit(3)",
  ]);
  assert.equal(failed.status, 3);
  const failure = failed.stderr.match(/HARNESS_FAILURE_ID=([0-9a-f-]+)/)?.[1];
  assert.ok(failure);
  const premature = run(root, [
    "finish",
    "--session", session,
    "--summary", "Handled the feature.",
    "--tests", "The test failed.",
  ]);
  assert.notEqual(premature.status, 0);
  assert.match(premature.stderr, /unresolved failure/i);
  const resolved = run(root, [
    "resolve",
    "--failure", failure,
    "--classification", "non-reusable",
    "--resolution", "Intentional test fixture failure.",
  ]);
  assert.equal(resolved.status, 0, resolved.stderr);
  fs.rmSync(path.join(root, "CLAUDE.md"));
  const blockedByDoctor = run(root, [
    "finish",
    "--session", session,
    "--summary", "Verified the failure lifecycle.",
    "--tests", "Intentional failure was classified.",
  ]);
  assert.notEqual(blockedByDoctor.status, 0);
  const stillActive = JSON.parse(
    fs.readFileSync(path.join(root, ".agent-harness", "sessions", `${session}.json`), "utf8"),
  );
  assert.equal(stillActive.status, "active");
  fs.writeFileSync(path.join(root, "CLAUDE.md"), "@AGENTS.md\n");
  const finished = run(root, [
    "finish",
    "--session", session,
    "--summary", "Verified the failure lifecycle.",
    "--tests", "Intentional failure was classified; harness doctor passed.",
  ]);
  assert.equal(finished.status, 0, finished.stderr);
});
