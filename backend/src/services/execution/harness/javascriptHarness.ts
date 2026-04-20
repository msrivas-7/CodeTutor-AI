import {
  TEST_SENTINEL,
  RESULT_MARKER,
  RESULT_ERR_MARKER,
  type FunctionTest,
  type HarnessBackend,
  type HarnessFile,
} from "./types.js";

export const HARNESS_JS = "__codetutor_tests.js";
export const HARNESS_JSON = "__codetutor_tests.json";

/**
 * JavaScript harness (Phase 17 trust model) — mirrors pythonHarness.
 *
 * Phase 17 changes from Phase 16:
 *   - Nonce is read from stdin (not env). unsetenv doesn't zero the kernel
 *     env region, so /proc/<ppid>/environ would still leak HARNESS_NONCE to
 *     any child subprocess. Stdin is a pipe: once read to EOF it's drained
 *     and unrecoverable.
 *   - Child subprocesses are spawned with stdio: ['ignore', 'pipe', 'pipe']
 *     so they cannot inherit the parent's drained stdin pipe.
 *   - The vm.createContext ctx no longer exposes require / process / Buffer /
 *     module / exports / __filename / __dirname. Those gave learner code a
 *     direct path to the real Node process — e.g. process.env to read the
 *     parent's environment, require('fs') to read the harness source. The
 *     vm boundary is a namespace isolator, not a sandbox; the runner
 *     container is the actual sandbox.
 *
 *   1. Parent Node process runs inside the runner container. Reads
 *      nonce from stdin, drains the pipe, closes it.
 *   2. Reads __codetutor_tests.json into memory, then fs.unlinkSync()s it.
 *      Hidden-test metadata lives only in parent RAM from this point on.
 *   3. For each test, spawns `node -e DRIVER TEST_JSON` with stdin ignored.
 *      DRIVER runs main.js inside a vm.createContext whose ctx only carries
 *      intrinsics (Math, JSON, Array, …) — no host APIs.
 *   4. Parent extracts the LAST RESULT_MARKER block from each child's
 *      stdout and compares via deepEqual on JSON.parse'd values.
 *   5. Parent HMAC-signs the body with the nonce and emits
 *      SENTINEL + base64(envelope) + SENTINEL + "\\n" to stdout.
 */
export function harnessJavaScript(): string {
  return `"use strict";
const fs = require("fs");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const SENTINEL = ${JSON.stringify(TEST_SENTINEL)};
const RESULT_MARKER = ${JSON.stringify(RESULT_MARKER)};
const RESULT_ERR_MARKER = ${JSON.stringify(RESULT_ERR_MARKER)};

// --- Read nonce from stdin (Phase 17) ---------------------------------
// fs.readFileSync(0) blocks until EOF, so the pipe is fully drained by the
// time we return. /proc/<ppid>/fd/0 will still point at this pipe, but any
// later read gets EOF — the data is gone. We don't fs.closeSync(0): libuv
// refuses to close fds 0/1/2 (uv__close asserts), and draining to EOF is
// the property that matters for secrecy.
let _stdinData = "";
try {
  _stdinData = fs.readFileSync(0, "utf8");
} catch (_e) {
  _stdinData = "";
}
const NONCE = _stdinData.split("\\n", 1)[0].trim();

// --- Per-test timeout stays in env (non-secret) -----------------------
let PER_TEST_TIMEOUT_MS = parseInt(process.env.HARNESS_PER_TEST_TIMEOUT_MS || "5000", 10);
if (!Number.isFinite(PER_TEST_TIMEOUT_MS) || PER_TEST_TIMEOUT_MS <= 0) PER_TEST_TIMEOUT_MS = 5000;
delete process.env.HARNESS_PER_TEST_TIMEOUT_MS;

// --- Read tests into memory, then delete the file (hides C3) ----------
const TESTS_PATH = ${JSON.stringify(HARNESS_JSON)};
let TESTS = [];
let loadErr = null;
try {
  TESTS = JSON.parse(fs.readFileSync(TESTS_PATH, "utf8"));
  fs.unlinkSync(TESTS_PATH);
} catch (e) {
  loadErr = "could not load test specs: " + (e && e.message ? e.message : String(e));
}

// --- Driver run by each per-test subprocess ----------------------------
// The driver reads the test spec from process.argv[1] (setup + call only —
// the expected value stays with the parent, so user code in the subprocess
// cannot read it). node -e is used so driver source and test JSON are on
// argv rather than stdin; nothing on argv is secret.
//
// IMPORTANT: the ctx below is deliberately minimal. Do NOT add require,
// process, Buffer, module, exports, __filename, __dirname, or any other
// host API — learner code must not have a handle onto the real Node
// process. The runner container is the sandbox; the vm ctx is a
// namespace isolator that prevents process.env / require('fs') escapes.
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

// Probe parses + evaluates main.js. The ctx here mirrors the driver's ctx —
// no host APIs reachable by user code. stdio:['ignore', 'pipe', 'pipe']
// gives the child no stdin (can't read parent's drained pipe).
function probeMain() {
  try {
    const r = spawnSync(
      process.execPath,
      ["-e", "const vm = require('vm'); const fs = require('fs'); const ctx = { console: console, globalThis: undefined, Math: Math, JSON: JSON, Object: Object, Array: Array, String: String, Number: Number, Boolean: Boolean, Date: Date, Error: Error, TypeError: TypeError, RangeError: RangeError, ReferenceError: ReferenceError, SyntaxError: SyntaxError, RegExp: RegExp, Map: Map, Set: Set, Promise: Promise, Symbol: Symbol, parseInt: parseInt, parseFloat: parseFloat, isNaN: isNaN, isFinite: isFinite }; ctx.globalThis = ctx; vm.createContext(ctx); vm.runInContext(fs.readFileSync('main.js', 'utf8'), ctx, { filename: 'main.js' });"],
      { encoding: "utf8", timeout: PER_TEST_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] },
    );
    return r;
  } catch (e) {
    return null;
  }
}

function runOne(test) {
  const shell = resultShell(test);
  // Only send setup + call into the subprocess. Expected stays in parent RAM.
  const payload = JSON.stringify({ setup: test.setup || "", call: test.call || "" });
  let r;
  try {
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

  // No marker at all — the subprocess exited before the driver could write
  // anything (process.exit, SIGKILL, etc). Fail closed.
  let stderrTail = "";
  if (r.stderr) {
    const lines = r.stderr.trim().split("\\n").filter(Boolean);
    if (lines.length) stderrTail = lines[lines.length - 1];
  }
  shell.error = stderrTail || "Test produced no result (the subprocess exited before finishing).";
  return shell;
}

// --- Drive the tests ---------------------------------------------------
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

// --- Sign + emit the envelope -----------------------------------------
const body = JSON.stringify({ results: results, harnessError: harnessError, cleanStdout: cleanStdout });
const sig = crypto.createHmac("sha256", NONCE).update(body).digest("hex");
const inner = JSON.stringify({ body: body, sig: sig });
const encoded = Buffer.from(inner, "utf8").toString("base64");
process.stdout.write(SENTINEL + encoded + SENTINEL + "\\n");
`;
}

export const javascriptHarness: HarnessBackend = {
  language: "javascript",
  prepareFiles(tests: FunctionTest[]): HarnessFile[] {
    return [
      { name: HARNESS_JS, content: harnessJavaScript() },
      { name: HARNESS_JSON, content: JSON.stringify(tests) },
    ];
  },
  execCommand(): string {
    return `node ${HARNESS_JS}`;
  },
};
