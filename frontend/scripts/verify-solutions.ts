/**
 * Verify solutions CLI
 *
 * For every lesson and every practice exercise, runs the committed golden
 * solution against its completionRules and asserts all rules pass.
 *
 * expected_stdout       — runs `python3 main.py` (with optional stdin) and
 *                         checks trimmed-substring match (same semantics as
 *                         validator.ts in production).
 * required_file_contains — word-boundary-aware pattern check mirroring the
 *                         production validator.
 * function_tests        — writes the same __codetutor_tests.py harness the
 *                         backend uses, runs python3, and parses the
 *                         sentinel-wrapped HMAC-signed envelope (Phase 16
 *                         trust model), asserting every test passes.
 * custom_validator      — skipped with a warning (dead in production too).
 *
 * Requires python3 on PATH. Exits 0 clean, 1 on any failure.
 */

import { readFileSync, readdirSync, statSync, existsSync, mkdtempSync, rmSync, writeFileSync, cpSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import crypto from "node:crypto";
import { lessonMetaSchema } from "../src/features/learning/content/schema";
import {
  entryFileFor,
  fileExtForLanguage,
  hasFunctionTestsHarnessLanguage,
  type Language,
} from "./language";
import type { z } from "zod";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");
const COURSES_DIR = resolve(ROOT, "public/courses");

// Mirror the production harness constants
// (backend/src/services/execution/harness/types.ts).
const TEST_SENTINEL = "__CODETUTOR_TESTS_v2_a8f3b1c7d2e4f5a6__";
const RESULT_MARKER = "__CODETUTOR_RESULT_v2__";
const RESULT_ERR_MARKER = "__CODETUTOR_RESULT_v2_ERR__";
const HARNESS_PY = "__codetutor_tests.py";
const HARNESS_JS = "__codetutor_tests.js";
const HARNESS_JSON = "__codetutor_tests.json";

type Lesson = z.infer<typeof lessonMetaSchema>;
type Rule = Lesson["completionRules"][number];

interface RunFailure {
  where: string;
  message: string;
}

const failures: RunFailure[] = [];

function main() {
  // python3 is only strictly required if any course is Python — other
  // languages have their own runtime checks inside runRulesAgainstSolution.
  // The broad precheck stays for the common case: we want to fail early when
  // the Python courses (our primary content) can't be verified.
  if (!isPythonAvailable()) {
    console.error("verify-solutions: python3 is required on PATH.");
    process.exit(2);
  }

  if (!existsSync(COURSES_DIR)) {
    console.error(`No courses directory at ${COURSES_DIR}`);
    process.exit(2);
  }

  const courseFolders = readdirSync(COURSES_DIR).filter((name) =>
    statSync(join(COURSES_DIR, name)).isDirectory(),
  );

  for (const courseFolder of courseFolders) {
    verifyCourse(courseFolder);
  }

  if (failures.length === 0) {
    console.log("verify-solutions: all solutions pass all rules.");
    process.exit(0);
  }

  for (const f of failures) {
    console.log(`[FAIL] ${f.where}\n        ${f.message}`);
  }
  console.log(`\nverify-solutions: ${failures.length} failure(s).`);
  process.exit(1);
}

function verifyCourse(courseFolder: string) {
  const lessonsDir = join(COURSES_DIR, courseFolder, "lessons");
  if (!existsSync(lessonsDir)) return;

  const lessonFolders = readdirSync(lessonsDir).filter((name) =>
    statSync(join(lessonsDir, name)).isDirectory(),
  );

  for (const lessonFolder of lessonFolders) {
    verifyLesson(courseFolder, lessonFolder);
  }
}

function verifyLesson(courseFolder: string, lessonFolder: string) {
  const lessonDir = join(COURSES_DIR, courseFolder, "lessons", lessonFolder);
  const lessonPath = join(lessonDir, "lesson.json");
  if (!existsSync(lessonPath)) return;

  let lesson: Lesson;
  try {
    lesson = lessonMetaSchema.parse(JSON.parse(readFileSync(lessonPath, "utf8")));
  } catch (e) {
    failures.push({
      where: `${courseFolder}/${lessonFolder}/lesson.json`,
      message: `lesson.json did not parse — run content-lint first. (${(e as Error).message})`,
    });
    return;
  }

  const lang: Language = lesson.language;
  const entry = entryFileFor(lang);
  const ext = fileExtForLanguage(lang);

  const solutionDir = join(lessonDir, "solution");
  const mainSolution = join(solutionDir, entry);

  if (!existsSync(mainSolution)) {
    failures.push({
      where: `${courseFolder}/${lessonFolder}`,
      message: `missing solution/${entry} — every lesson must have a golden solution`,
    });
  } else {
    const inputPath = join(solutionDir, "input.txt");
    runRulesAgainstSolution({
      where: `${courseFolder}/${lessonFolder} (main)`,
      language: lang,
      solutionFile: mainSolution,
      stdinFile: existsSync(inputPath) ? inputPath : null,
      rules: lesson.completionRules,
    });
  }

  for (const exercise of lesson.practiceExercises ?? []) {
    const exSolution = join(solutionDir, "practice", `${exercise.id}.${ext}`);
    if (!existsSync(exSolution)) {
      failures.push({
        where: `${courseFolder}/${lessonFolder}/practice/${exercise.id}`,
        message: `missing solution/practice/${exercise.id}.${ext}`,
      });
      continue;
    }
    const exStdin = join(solutionDir, "practice", `${exercise.id}.stdin`);
    runRulesAgainstSolution({
      where: `${courseFolder}/${lessonFolder}/practice/${exercise.id}`,
      language: lang,
      solutionFile: exSolution,
      stdinFile: existsSync(exStdin) ? exStdin : null,
      rules: exercise.completionRules,
    });
  }
}

interface RunArgs {
  where: string;
  language: Language;
  solutionFile: string;
  stdinFile: string | null;
  rules: Rule[];
}

interface RunSpec {
  command: string;
  args: string[];
}

function runSpecFor(language: Language, entry: string): RunSpec | null {
  switch (language) {
    case "python":
      return { command: "python3", args: [entry] };
    case "javascript":
      return { command: "node", args: [entry] };
    default:
      return null;
  }
}

function runRulesAgainstSolution(args: RunArgs) {
  const { where, language, solutionFile, stdinFile, rules } = args;
  const entry = entryFileFor(language);

  const tmp = mkdtempSync(join(tmpdir(), "verify-sol-"));
  try {
    const mainPath = join(tmp, entry);
    cpSync(solutionFile, mainPath);
    const stdinText = stdinFile ? readFileSync(stdinFile, "utf8") : "";
    const solutionSource = readFileSync(solutionFile, "utf8");

    const spec = runSpecFor(language, entry);
    let scriptStdout: string | null = null;
    let scriptExitCode: number | null = null;
    const ensureScriptRun = () => {
      if (scriptStdout !== null) return;
      if (!spec) {
        failures.push({
          where,
          message: `cannot run expected_stdout rule — no run command registered for language "${language}"`,
        });
        scriptStdout = "";
        scriptExitCode = -1;
        return;
      }
      const r = spawnSync(spec.command, spec.args, {
        cwd: tmp,
        input: stdinText,
        encoding: "utf8",
        timeout: 10_000,
      });
      scriptStdout = r.stdout ?? "";
      scriptExitCode = r.status;
      if (r.status !== 0) {
        failures.push({
          where,
          message: `${spec.command} ${spec.args.join(" ")} exited with code ${r.status}. stderr: ${(r.stderr ?? "").trim().slice(0, 300)}`,
        });
      }
    };

    for (const rule of rules) {
      if (rule.type === "expected_stdout") {
        ensureScriptRun();
        if (scriptExitCode !== 0) continue;
        const expected = rule.expected.trim();
        const actual = (scriptStdout ?? "").trim();
        if (!actual.includes(expected)) {
          failures.push({
            where,
            message: `expected stdout to contain ${JSON.stringify(expected)} but got ${JSON.stringify(actual.slice(0, 200))}`,
          });
        }
      } else if (rule.type === "required_file_contains") {
        if (!containsPattern(solutionSource, rule.pattern)) {
          failures.push({
            where,
            message: `solution source does not contain required pattern ${JSON.stringify(rule.pattern)}`,
          });
        }
      } else if (rule.type === "function_tests") {
        if (!hasFunctionTestsHarnessLanguage(language)) {
          console.log(`[skip] ${where}  no function_tests harness for language "${language}"`);
          continue;
        }
        const report = runHarness(language, tmp, rule.tests);
        if (report.harnessError) {
          failures.push({
            where,
            message: `harness error before tests ran: ${report.harnessError.slice(0, 300)}`,
          });
          continue;
        }
        const failed = report.results.filter((r) => !r.passed);
        if (failed.length > 0) {
          const first = failed[0];
          failures.push({
            where,
            message: `function_test "${first.name}" failed: expected ${first.expectedRepr ?? "?"} but got ${first.actualRepr ?? "(error: " + (first.error ?? "unknown").split("\n")[0] + ")"}`,
          });
        }
      } else if (rule.type === "custom_validator") {
        // Dead in production — skip.
      }
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

interface HarnessResult {
  name: string;
  passed: boolean;
  expectedRepr: string | null;
  actualRepr: string | null;
  error: string | null;
}
interface HarnessReport {
  results: HarnessResult[];
  harnessError: string | null;
}

function runHarness(language: Language, workspace: string, tests: unknown): HarnessReport {
  const jsonPath = join(workspace, HARNESS_JSON);
  writeFileSync(jsonPath, JSON.stringify(tests), "utf8");

  const nonce = crypto.randomBytes(32).toString("hex");
  // Phase 17: nonce goes on stdin (not env). /proc/<pid>/environ leaks env
  // even after unsetenv, so env is not a safe channel for anything user-code
  // children must not see.
  const env = {
    ...process.env,
    HARNESS_PER_TEST_TIMEOUT_MS: "5000",
  };
  const stdinPayload = `${nonce}\n`;

  if (language === "python") {
    writeFileSync(join(workspace, HARNESS_PY), harnessPython(), "utf8");
    const r = spawnSync("python3", [HARNESS_PY], {
      cwd: workspace,
      encoding: "utf8",
      timeout: 30_000,
      env,
      input: stdinPayload,
    });
    return parseSignedEnvelope(r.stdout ?? "", r.stderr ?? "", nonce);
  }
  if (language === "javascript") {
    writeFileSync(join(workspace, HARNESS_JS), harnessJavaScript(), "utf8");
    const r = spawnSync("node", [HARNESS_JS], {
      cwd: workspace,
      encoding: "utf8",
      timeout: 30_000,
      env,
      input: stdinPayload,
    });
    return parseSignedEnvelope(r.stdout ?? "", r.stderr ?? "", nonce);
  }
  return {
    results: [],
    harnessError: `no function_tests harness for language "${language}"`,
  };
}

// Mirror of backend/src/services/execution/harness/envelope.ts::parseSignedEnvelope.
// Verifies the HMAC-SHA256 signature the harness produced over the body string
// using the nonce we handed it, then returns the body's {results, harnessError}.
function parseSignedEnvelope(stdout: string, stderr: string, nonce: string): HarnessReport {
  const start = stdout.indexOf(TEST_SENTINEL);
  const end = stdout.lastIndexOf(TEST_SENTINEL);
  if (start === -1 || start === end) {
    const msg = stderr.trim() || "harness did not emit sentinel block";
    return { results: [], harnessError: msg };
  }
  const encoded = stdout.slice(start + TEST_SENTINEL.length, end).trim();
  if (!/^[A-Za-z0-9+/=\s]*$/.test(encoded) || encoded.length === 0) {
    return { results: [], harnessError: "harness envelope had non-base64 content" };
  }
  let parsed: { body?: unknown; sig?: unknown };
  try {
    const innerJson = Buffer.from(encoded, "base64").toString("utf8");
    parsed = JSON.parse(innerJson);
  } catch (e) {
    return { results: [], harnessError: `could not decode harness envelope: ${(e as Error).message}` };
  }
  if (typeof parsed.body !== "string" || typeof parsed.sig !== "string") {
    return { results: [], harnessError: "harness envelope missing body/sig fields" };
  }
  const expected = crypto.createHmac("sha256", nonce).update(parsed.body).digest("hex");
  const sigBuf = safeHexBuffer(parsed.sig);
  const expBuf = safeHexBuffer(expected);
  if (!sigBuf || !expBuf || sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return { results: [], harnessError: "harness envelope signature did not verify" };
  }
  try {
    const body = JSON.parse(parsed.body) as HarnessReport;
    return {
      results: Array.isArray(body.results) ? body.results : [],
      harnessError: typeof body.harnessError === "string" ? body.harnessError : null,
    };
  } catch (e) {
    return { results: [], harnessError: `could not parse harness body: ${(e as Error).message}` };
  }
}

function safeHexBuffer(hex: string): Buffer | null {
  if (!/^[0-9a-f]*$/i.test(hex) || hex.length % 2 !== 0) return null;
  try {
    return Buffer.from(hex, "hex");
  } catch {
    return null;
  }
}

// Mirror of backend/src/services/execution/harness/javascriptHarness.ts::harnessJavaScript().
// Kept in sync by convention — a divergence would be caught by a verify-solutions
// failure on the first golden solution that exercises function_tests.
function harnessJavaScript(): string {
  return `"use strict";
const fs = require("fs");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const SENTINEL = ${JSON.stringify(TEST_SENTINEL)};
const RESULT_MARKER = ${JSON.stringify(RESULT_MARKER)};
const RESULT_ERR_MARKER = ${JSON.stringify(RESULT_ERR_MARKER)};

// Phase 17: nonce comes in on stdin, not env. We read to EOF so the pipe is
// drained; we don't fs.closeSync(0) because libuv aborts on closing fd 0.
let _stdinData = "";
try { _stdinData = fs.readFileSync(0, "utf8"); } catch (_e) { _stdinData = ""; }
const NONCE = (_stdinData.split("\\n", 1)[0] || "").trim();

let PER_TEST_TIMEOUT_MS = parseInt(process.env.HARNESS_PER_TEST_TIMEOUT_MS || "5000", 10);
if (!Number.isFinite(PER_TEST_TIMEOUT_MS) || PER_TEST_TIMEOUT_MS <= 0) PER_TEST_TIMEOUT_MS = 5000;
delete process.env.HARNESS_PER_TEST_TIMEOUT_MS;

const TESTS_PATH = ${JSON.stringify(HARNESS_JSON)};
let TESTS = [];
let loadErr = null;
try {
  TESTS = JSON.parse(fs.readFileSync(TESTS_PATH, "utf8"));
  fs.unlinkSync(TESTS_PATH);
} catch (e) {
  loadErr = "could not load test specs: " + (e && e.message ? e.message : String(e));
}

// vm.createContext is a module loader, NOT a security boundary. The runner
// container is the sandbox. We pass only intrinsics into the ctx so the user's
// main.js can't grab require/process/Buffer off the ambient global — if those
// are needed in the future, rebind them narrowly. (M-A4.)
const DRIVER = [
  '"use strict";',
  'const fs = require("fs");',
  'const vm = require("vm");',
  'const RESULT_MARKER = ' + JSON.stringify(RESULT_MARKER) + ';',
  'const RESULT_ERR_MARKER = ' + JSON.stringify(RESULT_ERR_MARKER) + ';',
  'const spec = JSON.parse(process.argv[1]);',
  'function fmt(v) { if (typeof v === "string") return v; if (v === undefined) return "undefined"; try { return JSON.stringify(v); } catch { return String(v); } }',
  'let captured = "";',
  'const bufConsole = {',
  '  log: (...a) => { captured += a.map(fmt).join(" ") + "\\\\n"; },',
  '  info: (...a) => { captured += a.map(fmt).join(" ") + "\\\\n"; },',
  '  warn: (...a) => { captured += a.map(fmt).join(" ") + "\\\\n"; },',
  '  error: (...a) => { captured += a.map(fmt).join(" ") + "\\\\n"; },',
  '  debug: (...a) => { captured += a.map(fmt).join(" ") + "\\\\n"; },',
  '};',
  'const ctx = {',
  '  console: bufConsole,',
  '  Math: Math, JSON: JSON, Object: Object, Array: Array, String: String, Number: Number, Boolean: Boolean, Date: Date,',
  '  Error: Error, TypeError: TypeError, RangeError: RangeError, ReferenceError: ReferenceError, SyntaxError: SyntaxError,',
  '  RegExp: RegExp, Map: Map, Set: Set, Promise: Promise, Symbol: Symbol,',
  '  parseInt: parseInt, parseFloat: parseFloat, isNaN: isNaN, isFinite: isFinite,',
  '  globalThis: undefined,',
  '};',
  'ctx.globalThis = ctx;',
  'vm.createContext(ctx);',
  'let reprStr = null;',
  'try {',
  '  const src = fs.readFileSync("main.js", "utf8");',
  '  vm.runInContext(src, ctx, { filename: "main.js" });',
  '  if (spec.setup) vm.runInContext(spec.setup, ctx, { filename: "setup" });',
  '  const actual = vm.runInContext(spec.call || "", ctx, { filename: "call" });',
  '  reprStr = (actual === undefined) ? "undefined" : JSON.stringify(actual);',
  '  process.stdout.write(captured);',
  '  process.stdout.write("\\\\n" + RESULT_MARKER + (reprStr === undefined ? "undefined" : reprStr) + RESULT_MARKER + "\\\\n");',
  '} catch (e) {',
  '  const msg = (e && e.name && e.message) ? (e.name + ": " + e.message) : String(e);',
  '  process.stdout.write(captured);',
  '  process.stdout.write("\\\\n" + RESULT_ERR_MARKER + msg + RESULT_ERR_MARKER + "\\\\n");',
  '}',
].join("\\n");

function extractBetween(text, marker) {
  const end = text.lastIndexOf(marker);
  if (end === -1) return null;
  const start = text.lastIndexOf(marker, end - 1);
  if (start === -1 || start === end) return null;
  return text.slice(start + marker.length, end);
}

function stripMarkers(text) {
  for (const m of [RESULT_MARKER, RESULT_ERR_MARKER]) {
    while (true) {
      const a = text.indexOf(m);
      if (a === -1) break;
      const b = text.indexOf(m, a + m.length);
      if (b === -1) break;
      text = text.slice(0, a) + text.slice(b + m.length);
    }
  }
  return text.replace(/^\\s+|\\s+$/g, "");
}

function deepEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) if (!deepEqual(a[k], b[k])) return false;
  return true;
}

function resultShell(test) {
  return {
    name: test.name || "",
    hidden: !!test.hidden,
    category: test.category || null,
    passed: false,
    actualRepr: null,
    expectedRepr: null,
    stdoutDuring: "",
    error: null,
  };
}

function probeMain() {
  try {
    return spawnSync(
      process.execPath,
      ["-e", "const vm = require('vm'); const fs = require('fs'); const ctx = { console: console, Math: Math, JSON: JSON, Object: Object, Array: Array, String: String, Number: Number, Boolean: Boolean, Date: Date, Error: Error, RegExp: RegExp, Map: Map, Set: Set, Promise: Promise, Symbol: Symbol, parseInt: parseInt, parseFloat: parseFloat, isNaN: isNaN, isFinite: isFinite }; ctx.globalThis = ctx; vm.createContext(ctx); vm.runInContext(fs.readFileSync('main.js', 'utf8'), ctx, { filename: 'main.js' });"],
      { encoding: "utf8", timeout: PER_TEST_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (e) {
    return null;
  }
}

function runOne(test) {
  const shell = resultShell(test);
  const payload = JSON.stringify({ setup: test.setup || "", call: test.call || "" });
  let r;
  try {
    // stdio:['ignore', ...] so the child has no stdin at all — it cannot read
    // the parent's drained stdin pipe where the nonce briefly lived.
    r = spawnSync(
      process.execPath,
      ["-e", DRIVER, payload],
      { encoding: "utf8", timeout: PER_TEST_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (e) {
    shell.error = "Could not spawn test subprocess: " + (e && e.message ? e.message : String(e));
    return shell;
  }

  if (r.error && r.error.code === "ETIMEDOUT") {
    shell.error = "Test timed out.";
    return shell;
  }

  const childOut = r.stdout || "";
  const actualRepr = extractBetween(childOut, RESULT_MARKER);
  const errBlob = extractBetween(childOut, RESULT_ERR_MARKER);
  shell.stdoutDuring = stripMarkers(childOut);

  const expectedSrc = test.expected || "";
  if (actualRepr !== null) {
    let expected;
    try {
      expected = JSON.parse(expectedSrc);
    } catch (e) {
      shell.error = "invalid expected (must be JSON-literal): " + expectedSrc.slice(0, 200);
      shell.actualRepr = actualRepr;
      return shell;
    }
    let actual;
    let parsed = true;
    try {
      actual = actualRepr === "undefined" ? undefined : JSON.parse(actualRepr);
    } catch {
      parsed = false;
    }
    if (parsed) {
      shell.passed = deepEqual(actual, expected);
    } else {
      shell.passed = actualRepr === JSON.stringify(expected);
    }
    shell.actualRepr = actualRepr;
    shell.expectedRepr = expected === undefined ? "undefined" : JSON.stringify(expected);
    return shell;
  }

  if (errBlob !== null) {
    const tail = errBlob.trim().split("\\n").filter(Boolean).pop() || "";
    shell.error = tail || "Test raised an exception.";
    return shell;
  }

  let stderrTail = "";
  if (r.stderr) {
    const lines = r.stderr.trim().split("\\n").filter(Boolean);
    if (lines.length) stderrTail = lines[lines.length - 1];
  }
  shell.error = stderrTail || "Test produced no result (the subprocess exited before finishing).";
  return shell;
}

const results = [];
let harnessError = loadErr;
let cleanStdout = "";

if (harnessError === null) {
  const probe = probeMain();
  if (!probe || probe.error) {
    harnessError = "Your code could not be loaded (probe timed out or crashed).";
  } else if (probe.status !== 0) {
    const msg = (probe.stderr || "").trim() || "Your code could not be loaded.";
    harnessError = msg;
  } else {
    cleanStdout = probe.stdout || "";
    for (const t of TESTS) results.push(runOne(t));
  }
}

const body = JSON.stringify({ results: results, harnessError: harnessError, cleanStdout: cleanStdout });
const sig = crypto.createHmac("sha256", NONCE).update(body).digest("hex");
const inner = JSON.stringify({ body: body, sig: sig });
const encoded = Buffer.from(inner, "utf8").toString("base64");
process.stdout.write(SENTINEL + encoded + SENTINEL + "\\n");
`;
}

// Mirror of backend/src/services/execution/harness/pythonHarness.ts::harnessPython().
function harnessPython(): string {
  return `import base64, hashlib, hmac, json, os, subprocess, sys, traceback

SENTINEL = ${JSON.stringify(TEST_SENTINEL)}
RESULT_MARKER = ${JSON.stringify(RESULT_MARKER)}
RESULT_ERR_MARKER = ${JSON.stringify(RESULT_ERR_MARKER)}

# Phase 17: nonce arrives on stdin. Read to EOF, then close stdin so there's
# no residue visible via /proc/<pid>/fd/0 to any later child.
try:
    _stdin_data = sys.stdin.read()
except BaseException:
    _stdin_data = ""
try:
    sys.stdin.close()
except BaseException:
    pass
_nonce = _stdin_data.split("\\n", 1)[0].strip() if _stdin_data else ""

try:
    _per_test_timeout = float(os.environ.get("HARNESS_PER_TEST_TIMEOUT_MS", "5000")) / 1000.0
except (TypeError, ValueError):
    _per_test_timeout = 5.0
if "HARNESS_PER_TEST_TIMEOUT_MS" in os.environ:
    del os.environ["HARNESS_PER_TEST_TIMEOUT_MS"]

_tests_path = ${JSON.stringify(HARNESS_JSON)}
_tests = []
_load_err = None
try:
    with open(_tests_path, "r", encoding="utf-8") as _f:
        _tests = json.load(_f)
    os.remove(_tests_path)
except BaseException as _e:
    _load_err = "could not load test specs: " + repr(_e)

_DRIVER = (
    "import sys, runpy, traceback, contextlib, io, json\\n"
    "_test = json.loads(sys.argv[1])\\n"
    "_out = io.StringIO()\\n"
    "try:\\n"
    "    with contextlib.redirect_stdout(_out):\\n"
    "        _ns = runpy.run_path('main.py', run_name='__codetutor_main__')\\n"
    "        _setup = _test.get('setup') or ''\\n"
    "        if _setup:\\n"
    "            exec(_setup, _ns)\\n"
    "        _actual = eval(_test.get('call') or '', _ns)\\n"
    "    sys.stdout.write(_out.getvalue())\\n"
    "    sys.stdout.write('\\\\n' + " + json.dumps(RESULT_MARKER) + " + repr(_actual) + " + json.dumps(RESULT_MARKER) + " + '\\\\n')\\n"
    "except BaseException:\\n"
    "    sys.stdout.write(_out.getvalue())\\n"
    "    sys.stdout.write('\\\\n' + " + json.dumps(RESULT_ERR_MARKER) + " + traceback.format_exc(limit=2) + " + json.dumps(RESULT_ERR_MARKER) + " + '\\\\n')\\n"
)

def _extract_between(text, marker):
    end = text.rfind(marker)
    if end == -1:
        return None
    start = text.rfind(marker, 0, end)
    if start == -1:
        return None
    return text[start + len(marker):end]

def _strip_markers(text):
    for m in (RESULT_MARKER, RESULT_ERR_MARKER):
        while True:
            a = text.find(m)
            if a == -1:
                break
            b = text.find(m, a + len(m))
            if b == -1:
                break
            text = text[:a] + text[b + len(m):]
    return text.strip()

def _probe_main():
    # stdin=DEVNULL so the probe child cannot read the parent's stdin pipe.
    try:
        return subprocess.run(
            ["python3", "-c", "import runpy; runpy.run_path('main.py', run_name='__codetutor_main__')"],
            stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=_per_test_timeout,
        )
    except subprocess.TimeoutExpired:
        return None
    except BaseException:
        return None

def _result_shell(test):
    return {
        "name": test.get("name", ""),
        "hidden": bool(test.get("hidden", False)),
        "category": test.get("category"),
        "passed": False,
        "actualRepr": None,
        "expectedRepr": None,
        "stdoutDuring": "",
        "error": None,
    }

def _run_one(test):
    shell = _result_shell(test)
    payload = json.dumps({"setup": test.get("setup") or "", "call": test.get("call") or ""})
    try:
        # stdin=DEVNULL so the child cannot read the parent's drained stdin pipe.
        r = subprocess.run(
            ["python3", "-c", _DRIVER, payload],
            stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=_per_test_timeout,
        )
    except subprocess.TimeoutExpired:
        shell["error"] = "Test timed out."
        return shell
    except BaseException as e:
        shell["error"] = "Could not spawn test subprocess: " + repr(e)
        return shell

    child_out = r.stdout or ""
    actual_repr = _extract_between(child_out, RESULT_MARKER)
    err_blob = _extract_between(child_out, RESULT_ERR_MARKER)
    shell["stdoutDuring"] = _strip_markers(child_out)

    expected_src = test.get("expected", "")
    if actual_repr is not None:
        try:
            import ast
            expected = ast.literal_eval(expected_src)
        except BaseException:
            shell["error"] = "invalid expected (must be a Python literal): " + expected_src[:200]
            shell["actualRepr"] = actual_repr
            return shell
        try:
            import ast as _ast
            actual = _ast.literal_eval(actual_repr)
            shell["passed"] = actual == expected
        except BaseException:
            shell["passed"] = actual_repr == repr(expected)
        shell["actualRepr"] = actual_repr
        shell["expectedRepr"] = repr(expected)
        return shell

    if err_blob is not None:
        tail = (err_blob.strip().splitlines() or [""])[-1]
        shell["error"] = tail or "Test raised an exception."
        return shell

    stderr_tail = ""
    if r.stderr:
        lines = r.stderr.strip().splitlines()
        if lines:
            stderr_tail = lines[-1]
    shell["error"] = stderr_tail or "Test produced no result (the subprocess exited before finishing)."
    return shell

_results = []
_harness_error = _load_err
_clean_stdout = ""

if _harness_error is None:
    _probe = _probe_main()
    if _probe is None:
        _harness_error = "Your code could not be loaded (probe timed out or crashed)."
    elif _probe.returncode != 0:
        _msg = (_probe.stderr or "").strip() or "Your code could not be loaded."
        _harness_error = _msg
    else:
        _clean_stdout = _probe.stdout or ""
        for _t in _tests:
            _results.append(_run_one(_t))

_body = json.dumps({
    "results": _results,
    "harnessError": _harness_error,
    "cleanStdout": _clean_stdout,
})
_sig = hmac.new(_nonce.encode("utf-8"), _body.encode("utf-8"), hashlib.sha256).hexdigest()
_inner = json.dumps({"body": _body, "sig": _sig})
_encoded = base64.b64encode(_inner.encode("utf-8")).decode("ascii")
sys.stdout.write(SENTINEL + _encoded + SENTINEL + "\\n")
`;
}

// Mirror frontend/src/features/learning/utils/validator.ts::containsPattern
function containsPattern(content: string, pattern: string): boolean {
  if (!pattern) return true;
  if (!/^\w/.test(pattern)) return content.includes(pattern);
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}`).test(content);
}

function isPythonAvailable(): boolean {
  try {
    const r = spawnSync("python3", ["-c", "print(1)"], { encoding: "utf8" });
    return r.status === 0;
  } catch {
    return false;
  }
}

main();
