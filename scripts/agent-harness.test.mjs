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
  fs.mkdirSync(path.join(root, "docs", "templates"), { recursive: true });
  fs.mkdirSync(path.join(root, ".githooks"), { recursive: true });
  fs.mkdirSync(path.join(root, ".github"), { recursive: true });
  fs.writeFileSync(path.join(root, ".gitignore"), ".agent-harness/\n");
  fs.writeFileSync(
    path.join(root, "AGENTS.md"),
    "Required learning loop\nagent-harness.mjs start\nagent-harness.mjs browser-audit\nagent-harness.mjs pre-commit\nagent-harness.mjs doctor\n",
  );
  fs.writeFileSync(path.join(root, "CLAUDE.md"), "@AGENTS.md\n");
  fs.writeFileSync(path.join(root, "docs", "AGENT_HARNESS_STRATEGY.md"), "# Strategy\n");
  fs.writeFileSync(
    path.join(root, "docs", "templates", "BROWSER_UX_AUDIT_EVIDENCE.md"),
    "# Browser evidence\n",
  );
  fs.writeFileSync(path.join(root, ".github", "PULL_REQUEST_TEMPLATE.md"), "# PR\n");
  const hook = path.join(root, ".githooks", "pre-commit");
  fs.writeFileSync(hook, "#!/bin/sh\nexit 0\n");
  fs.chmodSync(hook, 0o755);
  fs.writeFileSync(path.join(root, "scripts", "agent-harness.mjs"), "// fixture marker\n");
  fs.writeFileSync(path.join(root, "scripts", "agent-harness.test.mjs"), "// fixture marker\n");
  fs.writeFileSync(path.join(root, "scripts", "agent-harness-seed.json"), SEED);
  assert.equal(spawnSync("git", ["init", "-q"], { cwd: root }).status, 0);
  assert.equal(spawnSync("git", ["add", "."], { cwd: root }).status, 0);
  assert.equal(
    spawnSync(
      "git",
      ["-c", "user.name=Harness Test", "-c", "user.email=harness@example.test", "commit", "-qm", "fixture"],
      { cwd: root },
    ).status,
    0,
  );
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
  const started = run(root, [
    "start", "--feature", "failure lifecycle", "--scope", "backend",
    "--browser-impact", "none",
    "--browser-bypass", "Exercises only the harness CLI failure lifecycle in an isolated fixture repository.",
  ]);
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
    "--no-commit",
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
  const passing = run(root, [
    "run",
    "--session", session,
    "--scope", "backend",
    "--",
    process.execPath,
    "-e",
    "process.exit(0)",
  ]);
  assert.equal(passing.status, 0, passing.stderr);
  fs.rmSync(path.join(root, "CLAUDE.md"));
  const blockedByDoctor = run(root, [
    "finish",
    "--session", session,
    "--summary", "Verified the failure lifecycle.",
    "--tests", "Intentional failure was classified.",
    "--no-commit",
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
    "--no-commit",
  ]);
  assert.equal(finished.status, 0, finished.stderr);
});

test("blocks session completion until a passing validation is recorded", () => {
  const root = fixture();
  const started = run(root, [
    "start", "--feature", "empty evidence", "--scope", "frontend",
    "--browser-impact", "none",
    "--browser-bypass", "Exercises only the harness empty-evidence guard in an isolated fixture repository.",
  ]);
  assert.equal(started.status, 0, started.stderr);
  const session = started.stdout.match(/HARNESS_SESSION_ID=([0-9a-f-]+)/)?.[1];
  assert.ok(session);

  const premature = run(root, [
    "finish",
    "--session", session,
    "--summary", "No validation was run.",
    "--tests", "None.",
    "--no-commit",
  ]);
  assert.notEqual(premature.status, 0);
  assert.match(premature.stderr, /no passing validation/i);

  const passing = run(root, [
    "run", "--session", session, "--", process.execPath, "-e", "process.exit(0)",
  ]);
  assert.equal(passing.status, 0, passing.stderr);
  const finished = run(root, [
    "finish",
    "--session", session,
    "--summary", "Validated the empty-evidence guard.",
    "--tests", "Recorded a passing validation.",
    "--no-commit",
  ]);
  assert.equal(finished.status, 0, finished.stderr);
});

test("rejects vague browser bypasses", () => {
  const root = fixture();
  const started = run(root, [
    "start", "--feature", "vague bypass", "--scope", "frontend",
    "--browser-impact", "none", "--browser-bypass", "no UI",
  ]);
  assert.notEqual(started.status, 0);
  assert.match(started.stderr, /concrete non-browser change/i);
});

test("requires finding and final-phase browser evidence and binds it to the staged commit", () => {
  const root = fixture();
  const started = run(root, [
    "start", "--feature", "browser contract", "--scope", "frontend,e2e",
    "--findings", "UX-001,UX-002",
  ]);
  assert.equal(started.status, 0, started.stderr);
  const session = started.stdout.match(/HARNESS_SESSION_ID=([0-9a-f-]+)/)?.[1];
  assert.ok(session);

  const validation = run(root, [
    "run", "--session", session, "--", process.execPath, "-e", "process.exit(0)",
  ]);
  assert.equal(validation.status, 0, validation.stderr);
  fs.writeFileSync(path.join(root, "browser-change.txt"), "final staged browser change\n");
  assert.equal(spawnSync("git", ["add", "browser-change.txt"], { cwd: root }).status, 0);

  const premature = run(root, [
    "finish", "--session", session,
    "--summary", "Changed the browser experience.",
    "--tests", "A deterministic check passed.",
  ]);
  assert.notEqual(premature.status, 0);
  assert.match(premature.stderr, /lacks passing live-browser evidence/i);

  const screenshotDir = path.join(root, ".agent-harness", "browser-evidence", session);
  fs.mkdirSync(screenshotDir, { recursive: true });
  const screenshot = path.join(screenshotDir, "proof.png");
  fs.writeFileSync(screenshot, "fixture image evidence");
  const common = [
    "--session", session,
    "--tool", "browser:control-in-app-browser",
    "--browser", "In-app Chromium",
    "--environment", "local",
    "--url", "http://localhost:5173/lesson",
    "--entrypoint", "Opened the real lesson route from the course page.",
    "--happy", "Completed the intended interaction and observed the final learner-visible state.",
    "--failure-recovery", "Interrupted the interaction, recovered, and retained the learner state.",
    "--adversarial", "Repeated and reversed the controls while the transition was active.",
    "--viewports", "1152x863 dark and 390x844 light",
    "--focus", "Keyboard focus entered, remained within, and returned to the invoking control.",
    "--screenshots", path.relative(root, screenshot),
    "--result", "pass",
  ];
  for (const finding of ["UX-001", "UX-002"]) {
    const audit = run(root, ["browser-audit", "--level", "finding", "--findings", finding, ...common]);
    assert.equal(audit.status, 0, audit.stderr);
  }
  const phaseAudit = run(root, ["browser-audit", "--level", "phase", ...common]);
  assert.equal(phaseAudit.status, 0, phaseAudit.stderr);

  const finished = run(root, [
    "finish", "--session", session,
    "--summary", "Validated the complete browser evidence contract.",
    "--tests", "Two finding audits, one final phase audit, and deterministic validation passed.",
  ]);
  assert.equal(finished.status, 0, finished.stderr);
  const preCommit = run(root, ["pre-commit"]);
  assert.equal(preCommit.status, 0, preCommit.stderr);

  fs.appendFileSync(path.join(root, "browser-change.txt"), "late unverified change\n");
  assert.equal(spawnSync("git", ["add", "browser-change.txt"], { cwd: root }).status, 0);
  const stale = run(root, ["pre-commit"]);
  assert.notEqual(stale.status, 0);
  assert.match(stale.stderr, /does not match a completed harness session/i);
});

test("accepts truthful native-browser evidence through Computer Use", () => {
  const root = fixture();
  const started = run(root, [
    "start", "--feature", "native Safari audit", "--scope", "frontend,e2e",
    "--findings", "UX-041",
  ]);
  assert.equal(started.status, 0, started.stderr);
  const session = started.stdout.match(/HARNESS_SESSION_ID=([0-9a-f-]+)/)?.[1];
  assert.ok(session);

  const screenshotDir = path.join(root, ".agent-harness", "browser-evidence", session);
  fs.mkdirSync(screenshotDir, { recursive: true });
  const screenshot = path.join(screenshotDir, "safari-proof.png");
  fs.writeFileSync(screenshot, "native Safari fixture evidence");
  const audit = run(root, [
    "browser-audit", "--session", session, "--level", "finding",
    "--findings", "UX-041",
    "--tool", "computer-use:computer-use",
    "--browser", "Safari native macOS",
    "--environment", "production",
    "--url", "https://example.test/lesson",
    "--entrypoint", "Opened the production lesson in native Safari.",
    "--happy", "Completed the visible interaction in the real browser.",
    "--failure-recovery", "Triggered the native window transition and recovered.",
    "--adversarial", "Repeated Escape through the fullscreen boundary.",
    "--viewports", "Safari fullscreen and restored compact window",
    "--focus", "Verified the product layer and keyboard path after reflow.",
    "--screenshots", path.relative(root, screenshot),
    "--result", "pass",
  ]);
  assert.equal(audit.status, 0, audit.stderr);
});
