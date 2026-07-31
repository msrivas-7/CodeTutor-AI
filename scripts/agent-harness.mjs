#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(SCRIPT_DIR, "..");
const REPO_ROOT =
  process.env.NODE_ENV === "test" && process.env.AGENT_HARNESS_TEST_ROOT
    ? path.resolve(process.env.AGENT_HARNESS_TEST_ROOT)
    : DEFAULT_ROOT;
const HARNESS_DIR = path.join(REPO_ROOT, ".agent-harness");
const KNOWLEDGE_PATH = path.join(HARNESS_DIR, "knowledge.json");
const MEMORY_PATH = path.join(HARNESS_DIR, "PROJECT_MEMORY.md");
const EVENTS_PATH = path.join(HARNESS_DIR, "events.jsonl");
const SESSIONS_DIR = path.join(HARNESS_DIR, "sessions");
const FAILURES_DIR = path.join(HARNESS_DIR, "failures");
const LOCK_PATH = path.join(HARNESS_DIR, "write.lock");
const SEED_PATH = path.join(REPO_ROOT, "scripts", "agent-harness-seed.json");
const SCOPES = new Set([
  "frontend",
  "backend",
  "database",
  "e2e",
  "infra",
  "content",
  "ai-evals",
  "release",
  "all",
]);
const CLASSIFICATIONS = new Set([
  "reusable",
  "product-defect",
  "flake",
  "environment",
  "non-reusable",
]);
const CONFIDENCE = new Set(["candidate", "repeated", "verified"]);
const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/,
  /\b(?:API[_-]?KEY|TOKEN|PASSWORD|SECRET|CONNECTION[_-]?STRING)\s*[:=]\s*\S+/i,
  /\bpostgres(?:ql)?:\/\/[^:\s]+:[^@\s]+@/i,
];

function fail(message, exitCode = 1) {
  const error = new Error(message);
  error.exitCode = exitCode;
  throw error;
}

function now() {
  return new Date().toISOString();
}

function reviewDate(from = new Date()) {
  const date = new Date(from);
  date.setUTCDate(date.getUTCDate() + 90);
  return date.toISOString();
}

function sha(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalize(value) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function parseArgv(argv) {
  const separator = argv.indexOf("--");
  const optionArgs = separator >= 0 ? argv.slice(0, separator) : argv;
  const commandArgs = separator >= 0 ? argv.slice(separator + 1) : [];
  const options = {};
  const positional = [];
  for (let index = 0; index < optionArgs.length; index += 1) {
    const item = optionArgs[index];
    if (!item.startsWith("--")) {
      positional.push(item);
      continue;
    }
    const key = item.slice(2);
    const next = optionArgs[index + 1];
    if (next && !next.startsWith("--")) {
      options[key] = next;
      index += 1;
    } else {
      options[key] = true;
    }
  }
  return { positional, options, commandArgs };
}

function requireOption(options, key) {
  const value = options[key];
  if (typeof value !== "string" || !value.trim()) {
    fail(`Missing required --${key} value.`);
  }
  return value.trim();
}

function parseScopes(value = "all") {
  const scopes = value.split(",").map((scope) => scope.trim()).filter(Boolean);
  if (!scopes.length || scopes.some((scope) => !SCOPES.has(scope))) {
    fail(`Invalid scope. Use one or more of: ${[...SCOPES].join(", ")}.`);
  }
  return [...new Set(scopes)];
}

function assertSafeText(label, value, maxLength = 800) {
  if (typeof value !== "string" || !value.trim()) fail(`${label} is required.`);
  if (value.length > maxLength) fail(`${label} exceeds ${maxLength} characters.`);
  if (SECRET_PATTERNS.some((pattern) => pattern.test(value))) {
    fail(`${label} looks like it contains a secret. Nothing was persisted.`);
  }
  return value.trim();
}

function persistedCommand(commandArgs) {
  return commandArgs.map((argument) => {
    if (/^[A-Za-z_][A-Za-z0-9_]*(?:KEY|TOKEN|PASSWORD|SECRET|CONNECTION_STRING)=/i.test(argument)) {
      return `${argument.slice(0, argument.indexOf("="))}=<redacted>`;
    }
    if (SECRET_PATTERNS.some((pattern) => pattern.test(argument))) return "<redacted>";
    return argument.replace(
      /\b(postgres(?:ql)?:\/\/[^:\s]+):[^@\s]+@/gi,
      "$1:<redacted>@",
    );
  }).join(" ");
}

function assertLocalDirectorySafe() {
  if (!fs.existsSync(HARNESS_DIR)) return;
  if (fs.lstatSync(HARNESS_DIR).isSymbolicLink()) {
    fail(".agent-harness must be a real local directory, not a symbolic link.");
  }
}

function writeJson(filePath, value) {
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  fs.renameSync(temporary, filePath);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function appendEvent(type, payload = {}) {
  fs.appendFileSync(
    EVENTS_PATH,
    `${JSON.stringify({ timestamp: now(), type, ...payload })}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
}

function withWriteLock(operation) {
  const deadline = Date.now() + 5_000;
  let descriptor = null;
  while (descriptor === null) {
    try {
      descriptor = fs.openSync(LOCK_PATH, "wx", 0o600);
      fs.writeFileSync(descriptor, JSON.stringify({ pid: process.pid, acquiredAt: now() }));
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const stat = fs.lstatSync(LOCK_PATH);
      if (stat.isSymbolicLink()) fail("Agent harness write lock must not be a symbolic link.");
      let ownerAlive = true;
      try {
        const lock = readJson(LOCK_PATH);
        process.kill(lock.pid, 0);
      } catch (lockError) {
        ownerAlive = lockError.code !== "ESRCH";
      }
      if (!ownerAlive && Date.now() - stat.mtimeMs > 120_000) {
        fs.unlinkSync(LOCK_PATH);
        continue;
      }
      if (Date.now() >= deadline) fail("Agent harness is busy; retry the command.");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
  try {
    return operation();
  } finally {
    fs.closeSync(descriptor);
    try {
      fs.unlinkSync(LOCK_PATH);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

function validateEntry(entry) {
  const required = ["id", "fingerprint", "symptom", "cause", "prevention", "evidence"];
  for (const key of required) {
    if (typeof entry[key] !== "string" || !entry[key].trim()) {
      fail(`Knowledge entry ${entry.id ?? "(unknown)"} has invalid ${key}.`);
    }
    assertSafeText(`entry.${key}`, entry[key], key === "evidence" ? 1200 : 800);
  }
  if (!Array.isArray(entry.scopes) || !entry.scopes.length) {
    fail(`Knowledge entry ${entry.id} has no scopes.`);
  }
  parseScopes(entry.scopes.join(","));
  if (!CONFIDENCE.has(entry.confidence)) {
    fail(`Knowledge entry ${entry.id} has invalid confidence.`);
  }
  if (!new Set(["active", "retired"]).has(entry.status)) {
    fail(`Knowledge entry ${entry.id} has invalid status.`);
  }
  if (!Number.isInteger(entry.occurrences) || entry.occurrences < 1) {
    fail(`Knowledge entry ${entry.id} has invalid occurrences.`);
  }
  for (const key of ["createdAt", "updatedAt", "reviewAfter"]) {
    if (Number.isNaN(Date.parse(entry[key]))) {
      fail(`Knowledge entry ${entry.id} has invalid ${key}.`);
    }
  }
}

function renderMemory(knowledge) {
  const active = knowledge.entries
    .filter((entry) => entry.status === "active")
    .sort((a, b) => a.scopes.join(",").localeCompare(b.scopes.join(",")) || a.id.localeCompare(b.id));
  const retiredCount = knowledge.entries.length - active.length;
  const lines = [
    "# CodeTutor AI local project memory",
    "",
    "> Generated by `node scripts/agent-harness.mjs`; do not edit by hand.",
    "> This file is gitignored and may describe machine-local behavior.",
    "",
    `Active entries: ${active.length}. Retired entries: ${retiredCount}.`,
    "",
  ];
  for (const entry of active) {
    lines.push(
      `## ${entry.id} [${entry.confidence}]`,
      "",
      `- Scope: ${entry.scopes.join(", ")}`,
      `- Symptom: ${entry.symptom}`,
      `- Root cause: ${entry.cause}`,
      `- Prevention: ${entry.prevention}`,
      `- Evidence: ${entry.evidence}`,
      `- Enforcement: ${entry.enforcement || "not yet mechanical"}`,
      `- Occurrences: ${entry.occurrences}`,
      `- Review after: ${entry.reviewAfter}`,
      "",
    );
  }
  fs.writeFileSync(MEMORY_PATH, `${lines.join("\n")}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

function initStore({ quiet = false } = {}) {
  assertLocalDirectorySafe();
  fs.mkdirSync(SESSIONS_DIR, { recursive: true, mode: 0o700 });
  fs.mkdirSync(FAILURES_DIR, { recursive: true, mode: 0o700 });
  if (!fs.existsSync(SEED_PATH)) fail(`Missing tracked seed: ${SEED_PATH}`);
  const seed = readJson(SEED_PATH);
  if (seed.schemaVersion !== 1 || !Array.isArray(seed.entries)) {
    fail("Unsupported or invalid tracked seed schema.");
  }
  for (const entry of seed.entries) validateEntry(entry);
  if (!fs.existsSync(KNOWLEDGE_PATH)) {
    const knowledge = {
      schemaVersion: seed.schemaVersion,
      seedVersion: seed.seedVersion,
      initializedAt: now(),
      updatedAt: now(),
      entries: seed.entries,
    };
    for (const entry of knowledge.entries) validateEntry(entry);
    writeJson(KNOWLEDGE_PATH, knowledge);
    fs.writeFileSync(EVENTS_PATH, "", { encoding: "utf8", mode: 0o600 });
    appendEvent("initialized", { seedEntries: knowledge.entries.length });
  }
  const knowledge = readJson(KNOWLEDGE_PATH);
  if (knowledge.schemaVersion !== 1 || !Array.isArray(knowledge.entries)) {
    fail("Unsupported or invalid local knowledge schema.");
  }
  if (knowledge.seedVersion !== seed.seedVersion) {
    for (const seedEntry of seed.entries) {
      const existing = knowledge.entries.find((entry) => entry.id === seedEntry.id);
      if (!existing) {
        knowledge.entries.push(seedEntry);
        continue;
      }
      if (existing.promotionReason === "tracked-bootstrap") {
        const localLifecycle = {
          occurrences: Math.max(existing.occurrences, seedEntry.occurrences),
          status: existing.status,
          retiredAt: existing.retiredAt,
          retirementReason: existing.retirementReason,
        };
        Object.assign(existing, seedEntry, localLifecycle);
      }
    }
    knowledge.seedVersion = seed.seedVersion;
    knowledge.updatedAt = now();
    writeJson(KNOWLEDGE_PATH, knowledge);
    appendEvent("seed-synchronized", { seedVersion: seed.seedVersion });
  }
  for (const entry of knowledge.entries) validateEntry(entry);
  renderMemory(knowledge);
  if (!quiet) console.log(`Agent harness ready at ${path.relative(REPO_ROOT, HARNESS_DIR)}/`);
  return knowledge;
}

function git(args) {
  const result = spawnSync("git", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

function printContext(knowledge, scopes) {
  const selected = knowledge.entries.filter(
    (entry) =>
      entry.status === "active" &&
      (scopes.includes("all") ||
        entry.scopes.includes("all") ||
        entry.scopes.some((scope) => scopes.includes(scope))),
  );
  const trusted = selected.filter((entry) => entry.confidence !== "candidate");
  const candidates = selected.filter((entry) => entry.confidence === "candidate");
  console.log(`\nHarness context for: ${scopes.join(", ")} (${selected.length} entries)`);
  for (const entry of trusted) {
    console.log(
      `\n[${entry.id}] ${entry.prevention}\n  Why: ${entry.cause}\n  Evidence: ${entry.evidence}`,
    );
  }
  if (candidates.length) {
    console.log("\nUnverified candidates (investigate; do not treat as truth):");
    for (const entry of candidates) console.log(`- [${entry.id}] ${entry.symptom}`);
  }
}

function recordKnowledge(options, metadata = {}) {
  initStore({ quiet: true });
  const scopes = parseScopes(requireOption(options, "scope"));
  const symptom = assertSafeText("symptom", requireOption(options, "symptom"));
  const cause = assertSafeText("cause", requireOption(options, "cause"));
  const prevention = assertSafeText("prevention", requireOption(options, "prevention"));
  const evidence = assertSafeText("evidence", requireOption(options, "evidence"), 1200);
  const enforcement = options.enforcement
    ? assertSafeText("enforcement", String(options.enforcement), 800)
    : null;
  const requestedConfidence = String(options.confidence ?? "candidate");
  if (!new Set(["candidate", "verified"]).has(requestedConfidence)) {
    fail("--confidence must be candidate or verified.");
  }
  const fingerprint = sha(
    [scopes.sort().join(","), normalize(cause), normalize(prevention)].join("\n"),
  );
  return withWriteLock(() => {
  const knowledge = readJson(KNOWLEDGE_PATH);
  let entry = knowledge.entries.find((item) => item.fingerprint === fingerprint);
  if (entry) {
    entry.occurrences += 1;
    entry.updatedAt = now();
    entry.reviewAfter = reviewDate();
    entry.evidence = evidence;
    entry.enforcement = enforcement ?? entry.enforcement;
    entry.status = "active";
    if (requestedConfidence === "verified") {
      entry.confidence = "verified";
      entry.promotionReason = "direct-evidence";
    } else if (entry.confidence === "candidate" && entry.occurrences >= 2) {
      entry.confidence = "repeated";
      entry.promotionReason = "repeated-observation";
    }
    appendEvent("knowledge-observed", {
      entryId: entry.id,
      occurrences: entry.occurrences,
      confidence: entry.confidence,
      ...metadata,
    });
  } else {
    const timestamp = now();
    entry = {
      id: `k-${fingerprint.slice(0, 12)}`,
      fingerprint,
      scopes,
      symptom,
      cause,
      prevention,
      evidence,
      enforcement,
      confidence: requestedConfidence,
      promotionReason:
        requestedConfidence === "verified" ? "direct-evidence" : "first-observation",
      occurrences: 1,
      status: "active",
      createdAt: timestamp,
      updatedAt: timestamp,
      reviewAfter: reviewDate(),
    };
    validateEntry(entry);
    knowledge.entries.push(entry);
    appendEvent("knowledge-recorded", {
      entryId: entry.id,
      confidence: entry.confidence,
      ...metadata,
    });
  }
  knowledge.updatedAt = now();
  writeJson(KNOWLEDGE_PATH, knowledge);
  renderMemory(knowledge);
  console.log(`Knowledge ${entry.id} saved as ${entry.confidence}.`);
  return entry;
  });
}

function startSession(options) {
  const knowledge = initStore({ quiet: true });
  const feature = assertSafeText("feature", requireOption(options, "feature"), 160);
  const scopes = parseScopes(String(options.scope ?? "all"));
  const id = randomUUID();
  const session = {
    schemaVersion: 1,
    id,
    feature,
    scopes,
    status: "active",
    branch: git(["branch", "--show-current"]) ?? "unknown",
    startCommit: git(["rev-parse", "HEAD"]) ?? "unknown",
    startedAt: now(),
    validations: [],
  };
  writeJson(path.join(SESSIONS_DIR, `${id}.json`), session);
  appendEvent("session-started", { sessionId: id, feature, scopes });
  console.log(`HARNESS_SESSION_ID=${id}`);
  console.log(`Feature: ${feature}`);
  console.log(`Branch: ${session.branch} @ ${session.startCommit.slice(0, 12)}`);
  printContext(knowledge, scopes);
}

function pendingFailures(sessionId = null) {
  if (!fs.existsSync(FAILURES_DIR)) return [];
  return fs.readdirSync(FAILURES_DIR)
    .filter((name) => name.endsWith(".json"))
    .map((name) => readJson(path.join(FAILURES_DIR, name)))
    .filter((failure) => failure.status === "pending" && (!sessionId || failure.sessionId === sessionId));
}

function assertFailFastCompositeShell(commandArgs) {
  const shell = path.basename(commandArgs[0]).toLowerCase();
  if (!new Set(["bash", "sh", "zsh"]).has(shell)) return;
  const commandFlag = commandArgs.findIndex((argument) => /^-[a-z]*c[a-z]*$/i.test(argument));
  if (commandFlag < 0 || commandFlag + 1 >= commandArgs.length) return;
  const script = commandArgs[commandFlag + 1];
  if (!/[;|]|&&/.test(script)) return;
  if (!/^\s*set\s+-[^;\n]*e/.test(script)) {
    fail("Compound shell validations must begin with fail-fast `set -e` (prefer `set -euo pipefail`).");
  }
}

function runCommand(options, commandArgs) {
  initStore({ quiet: true });
  if (!commandArgs.length) fail("run requires a command after --.");
  assertFailFastCompositeShell(commandArgs);
  const sessionId = requireOption(options, "session");
  const sessionPath = path.join(SESSIONS_DIR, `${sessionId}.json`);
  if (!fs.existsSync(sessionPath)) fail(`Unknown harness session: ${sessionId}`);
  const session = readJson(sessionPath);
  if (session.status !== "active") fail(`Harness session ${sessionId} is not active.`);
  const scopes = parseScopes(String(options.scope ?? session.scopes.join(",")));
  const relativeCwd = String(options.cwd ?? ".");
  const cwd = path.resolve(REPO_ROOT, relativeCwd);
  if (cwd !== REPO_ROOT && !cwd.startsWith(`${REPO_ROOT}${path.sep}`)) {
    fail("--cwd must stay inside the repository.");
  }
  const startedAt = now();
  const result = spawnSync(commandArgs[0], commandArgs.slice(1), {
    cwd,
    env: process.env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  const exitCode = result.status ?? 1;
  const validation = {
    command: persistedCommand(commandArgs),
    cwd: path.relative(REPO_ROOT, cwd) || ".",
    scopes,
    startedAt,
    finishedAt: now(),
    exitCode,
  };
  withWriteLock(() => {
    const latestSession = readJson(sessionPath);
    latestSession.validations.push(validation);
    writeJson(sessionPath, latestSession);
  });
  if (exitCode === 0) {
    appendEvent("validation-passed", { sessionId, ...validation });
    console.log("Harness validation passed.");
    return 0;
  }
  const id = randomUUID();
  const failure = {
    schemaVersion: 1,
    id,
    sessionId,
    scopes,
    command: validation.command,
    cwd: validation.cwd,
    branch: git(["branch", "--show-current"]) ?? "unknown",
    commit: git(["rev-parse", "HEAD"]) ?? "unknown",
    exitCode,
    status: "pending",
    createdAt: now(),
  };
  writeJson(path.join(FAILURES_DIR, `${id}.json`), failure);
  appendEvent("validation-failed", { failureId: id, sessionId, ...validation });
  console.error(`HARNESS_FAILURE_ID=${id}`);
  console.error(
    "Resolve this incident after diagnosis with agent-harness.mjs resolve; raw output was not persisted.",
  );
  return exitCode;
}

function resolveFailure(options) {
  initStore({ quiet: true });
  const id = requireOption(options, "failure");
  const filePath = path.join(FAILURES_DIR, `${id}.json`);
  if (!fs.existsSync(filePath)) fail(`Unknown harness failure: ${id}`);
  const failure = readJson(filePath);
  if (failure.status !== "pending") fail(`Harness failure ${id} is already resolved.`);
  const classification = requireOption(options, "classification");
  if (!CLASSIFICATIONS.has(classification)) {
    fail(`Invalid classification. Use: ${[...CLASSIFICATIONS].join(", ")}.`);
  }
  let knowledgeEntryId = null;
  if (new Set(["reusable", "flake", "environment"]).has(classification)) {
    const recordOptions = {
      scope: failure.scopes.join(","),
      symptom: requireOption(options, "symptom"),
      cause: requireOption(options, "cause"),
      prevention: requireOption(options, "prevention"),
      evidence: requireOption(options, "evidence"),
      enforcement: options.enforcement,
      confidence: options.confidence ?? "candidate",
    };
    knowledgeEntryId = recordKnowledge(recordOptions, {
      sourceFailureId: id,
      classification,
    }).id;
  }
  const resolution = options.resolution
    ? assertSafeText("resolution", String(options.resolution), 800)
    : classification;
  failure.status = "resolved";
  failure.classification = classification;
  failure.resolution = resolution;
  failure.knowledgeEntryId = knowledgeEntryId;
  failure.resolvedAt = now();
  writeJson(filePath, failure);
  appendEvent("failure-resolved", {
    failureId: id,
    sessionId: failure.sessionId,
    classification,
    knowledgeEntryId,
  });
  console.log(`Failure ${id} resolved as ${classification}.`);
}

function retireKnowledge(options) {
  initStore({ quiet: true });
  const id = requireOption(options, "id");
  const reason = assertSafeText("reason", requireOption(options, "reason"), 800);
  return withWriteLock(() => {
  const knowledge = readJson(KNOWLEDGE_PATH);
  const entry = knowledge.entries.find((item) => item.id === id);
  if (!entry) fail(`Unknown knowledge entry: ${id}`);
  if (entry.status === "retired") fail(`Knowledge entry ${id} is already retired.`);
  entry.status = "retired";
  entry.retiredAt = now();
  entry.retirementReason = reason;
  entry.updatedAt = now();
  knowledge.updatedAt = now();
  writeJson(KNOWLEDGE_PATH, knowledge);
  renderMemory(knowledge);
  appendEvent("knowledge-retired", { entryId: id, reason });
  console.log(`Knowledge ${id} retired.`);
  });
}

function runDoctor({ ci = false, strict = false } = {}) {
  const errors = [];
  const warnings = [];
  const requiredFiles = [
    "AGENTS.md",
    "CLAUDE.md",
    "docs/AGENT_HARNESS_STRATEGY.md",
    "scripts/agent-harness.mjs",
    "scripts/agent-harness-seed.json",
    "scripts/agent-harness.test.mjs",
  ];
  for (const relative of requiredFiles) {
    if (!fs.existsSync(path.join(REPO_ROOT, relative))) errors.push(`Missing ${relative}`);
  }
  const gitignore = fs.existsSync(path.join(REPO_ROOT, ".gitignore"))
    ? fs.readFileSync(path.join(REPO_ROOT, ".gitignore"), "utf8")
    : "";
  if (!/^\.agent-harness\/$/m.test(gitignore)) errors.push(".gitignore must ignore .agent-harness/");
  const agents = fs.existsSync(path.join(REPO_ROOT, "AGENTS.md"))
    ? fs.readFileSync(path.join(REPO_ROOT, "AGENTS.md"), "utf8")
    : "";
  for (const phrase of ["agent-harness.mjs start", "agent-harness.mjs doctor", "Required learning loop"]) {
    if (!agents.includes(phrase)) errors.push(`AGENTS.md is missing contract phrase: ${phrase}`);
  }
  const claude = fs.existsSync(path.join(REPO_ROOT, "CLAUDE.md"))
    ? fs.readFileSync(path.join(REPO_ROOT, "CLAUDE.md"), "utf8")
    : "";
  if (!claude.includes("@AGENTS.md")) errors.push("CLAUDE.md must import @AGENTS.md");
  if (fs.existsSync(SEED_PATH)) {
    try {
      const seed = readJson(SEED_PATH);
      if (seed.schemaVersion !== 1 || typeof seed.seedVersion !== "string" || !Array.isArray(seed.entries)) {
        fail("Invalid seed schema.");
      }
      for (const entry of seed.entries) validateEntry(entry);
      const ids = seed.entries.map((entry) => entry.id);
      const fingerprints = seed.entries.map((entry) => entry.fingerprint);
      if (new Set(ids).size !== ids.length) fail("Harness seed contains duplicate ids.");
      if (new Set(fingerprints).size !== fingerprints.length) {
        fail("Harness seed contains duplicate fingerprints.");
      }
    } catch (error) {
      errors.push(`Invalid harness seed: ${error.message}`);
    }
  }
  const gitRoot = git(["rev-parse", "--show-toplevel"]);
  if (gitRoot) {
    const trackedLocal = git(["ls-files", ".agent-harness"]);
    if (trackedLocal) errors.push("Files under .agent-harness/ must never be tracked");
  }
  if (!ci) {
    try {
      const knowledge = initStore({ quiet: true });
      const overdue = knowledge.entries.filter(
        (entry) => entry.status === "active" && Date.parse(entry.reviewAfter) < Date.now(),
      );
      for (const entry of overdue) warnings.push(`Knowledge ${entry.id} is overdue for review`);
      const pending = pendingFailures();
      for (const failure of pending) warnings.push(`Pending failure ${failure.id} (${failure.command})`);
    } catch (error) {
      errors.push(error.message);
    }
  }
  for (const warning of warnings) console.warn(`WARN: ${warning}`);
  for (const error of errors) console.error(`ERROR: ${error}`);
  if (errors.length || (strict && warnings.length)) {
    fail(`Harness doctor failed with ${errors.length} error(s) and ${warnings.length} warning(s).`);
  }
  console.log(`Harness doctor passed${warnings.length ? ` with ${warnings.length} warning(s)` : ""}.`);
}

function finishSession(options) {
  initStore({ quiet: true });
  const id = requireOption(options, "session");
  const filePath = path.join(SESSIONS_DIR, `${id}.json`);
  if (!fs.existsSync(filePath)) fail(`Unknown harness session: ${id}`);
  const session = readJson(filePath);
  if (session.status !== "active") fail(`Harness session ${id} is already finished.`);
  const pending = pendingFailures(id);
  if (pending.length) {
    fail(`Session ${id} has unresolved failure(s): ${pending.map((item) => item.id).join(", ")}`);
  }
  session.summary = assertSafeText("summary", requireOption(options, "summary"), 1200);
  session.tests = assertSafeText("tests", requireOption(options, "tests"), 1200);
  runDoctor();
  withWriteLock(() => {
    const latestSession = readJson(filePath);
    if (latestSession.status !== "active") fail(`Harness session ${id} is already finished.`);
    latestSession.summary = session.summary;
    latestSession.tests = session.tests;
    latestSession.status = "complete";
    latestSession.endCommit = git(["rev-parse", "HEAD"]) ?? "unknown";
    latestSession.finishedAt = now();
    writeJson(filePath, latestSession);
  });
  appendEvent("session-finished", {
    sessionId: id,
    feature: session.feature,
    validations: session.validations.length,
  });
  console.log(`Harness session ${id} finished.`);
}

function printStatus() {
  initStore({ quiet: true });
  const sessions = fs.readdirSync(SESSIONS_DIR)
    .filter((name) => name.endsWith(".json"))
    .map((name) => readJson(path.join(SESSIONS_DIR, name)));
  const active = sessions.filter((session) => session.status === "active");
  console.log(`Active sessions: ${active.length}`);
  for (const session of active) {
    console.log(`- ${session.id} ${session.feature} [${session.scopes.join(", ")}]`);
  }
  const pending = pendingFailures();
  console.log(`Pending failures: ${pending.length}`);
  for (const failure of pending) console.log(`- ${failure.id} ${failure.command}`);
}

function printHelp() {
  console.log(`CodeTutor AI agent harness

Commands:
  init
  start --feature <name> [--scope frontend,backend]
  context [--scope frontend,backend]
  run --session <id> [--scope scope] [--cwd path] -- <command> [args]
  resolve --failure <id> --classification <type> [knowledge fields]
  record --scope <scope> --symptom <text> --cause <text> --prevention <text> --evidence <text> [--confidence verified]
  retire --id <entry-id> --reason <text>
  finish --session <id> --summary <text> --tests <text>
  status
  doctor [--ci] [--strict]

Classifications: ${[...CLASSIFICATIONS].join(", ")}`);
}

function main() {
  const [command = "help", ...rest] = process.argv.slice(2);
  const { options, commandArgs } = parseArgv(rest);
  switch (command) {
    case "init":
      initStore();
      break;
    case "start":
      startSession(options);
      break;
    case "context": {
      const knowledge = initStore({ quiet: true });
      printContext(knowledge, parseScopes(String(options.scope ?? "all")));
      break;
    }
    case "run":
      process.exitCode = runCommand(options, commandArgs);
      break;
    case "resolve":
      resolveFailure(options);
      break;
    case "record":
      recordKnowledge(options);
      break;
    case "retire":
      retireKnowledge(options);
      break;
    case "finish":
      finishSession(options);
      break;
    case "status":
      printStatus();
      break;
    case "doctor":
      runDoctor({ ci: options.ci === true, strict: options.strict === true });
      break;
    case "help":
    case "--help":
    case "-h":
      printHelp();
      break;
    default:
      fail(`Unknown command: ${command}`);
  }
}

try {
  main();
} catch (error) {
  console.error(`agent-harness: ${error.message}`);
  process.exitCode = error.exitCode ?? 1;
}
