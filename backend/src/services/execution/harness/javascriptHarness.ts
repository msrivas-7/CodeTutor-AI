import {
  TEST_SENTINEL,
  type FunctionTest,
  type HarnessBackend,
  type HarnessFile,
  type TestCaseResult,
  type TestReport,
} from "./types.js";

export const HARNESS_JS = "__codetutor_tests.js";
export const HARNESS_JSON = "__codetutor_tests.json";

/**
 * JavaScript harness: evaluates main.js inside a fresh `vm` context per test
 * so top-level `function` declarations are accessible by name from the test's
 * call expression (sloppy-mode global-binding semantics), then runs the
 * test's `setup` (if any) and `call` against that context. Expected values
 * are parsed with JSON.parse — authors stick to JSON-literal syntax, same
 * contract the Python harness enforces via ast.literal_eval.
 *
 * Two conveniences the learner shouldn't have to think about:
 *  - `console.log/info/warn/error` are redirected per-test to a captured
 *    string so prints don't pollute the sentinel-wrapped payload.
 *  - `module` and `require.main` are distinct objects so the common
 *    `if (require.main === module)` guard short-circuits during tests —
 *    letting authors wrap top-level stdin logic exactly like Python's
 *    `if __name__ == "__main__":` pattern.
 */
export function harnessJavaScript(): string {
  return `"use strict";
const fs = require("fs");
const vm = require("vm");

const SENTINEL = "${TEST_SENTINEL}";
const TESTS = JSON.parse(fs.readFileSync("${HARNESS_JSON}", "utf8"));
const MAIN_SRC = fs.readFileSync("main.js", "utf8");

function fmt(v) {
  if (typeof v === "string") return v;
  if (v === undefined) return "undefined";
  try { return JSON.stringify(v); } catch { return String(v); }
}

function repr(v) {
  if (v === undefined) return "undefined";
  try { return JSON.stringify(v); } catch { return String(v); }
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

function makeContext(stdoutSink) {
  const bufConsole = {
    log: (...args) => { stdoutSink.buf += args.map(fmt).join(" ") + "\\n"; },
    info: (...args) => { stdoutSink.buf += args.map(fmt).join(" ") + "\\n"; },
    warn: (...args) => { stdoutSink.buf += args.map(fmt).join(" ") + "\\n"; },
    error: (...args) => { stdoutSink.buf += args.map(fmt).join(" ") + "\\n"; },
    debug: (...args) => { stdoutSink.buf += args.map(fmt).join(" ") + "\\n"; },
  };
  // A fresh plain-object module so \`require.main === module\` is false
  // during tests. \`require\` stays the real Node require so that the rare
  // learner who imports fs / path / etc. still works.
  const sandboxModule = { exports: {} };
  const ctx = {
    console: bufConsole,
    Math, JSON, Object, Array, String, Number, Boolean, Date,
    Error, TypeError, RangeError, ReferenceError, SyntaxError,
    RegExp, Map, Set, Promise, Symbol,
    parseInt, parseFloat, isNaN, isFinite,
    Buffer,
    process,
    require,
    module: sandboxModule,
    exports: sandboxModule.exports,
    __filename: "main.js",
    __dirname: ".",
    globalThis: undefined,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  return ctx;
}

let harnessError = null;
const results = [];

// Probe: does main.js even load? Surface syntax / reference errors at module
// level before running any tests so the UI shows a useful harnessError rather
// than N identical per-test failures.
try {
  const probeSink = { buf: "" };
  const probeCtx = makeContext(probeSink);
  vm.runInContext(MAIN_SRC, probeCtx, { filename: "main.js" });
} catch (e) {
  harnessError = e instanceof Error ? (e.name + ": " + e.message) : String(e);
}

if (harnessError === null) {
  for (const t of TESTS) {
    const sink = { buf: "" };
    const ctx = makeContext(sink);
    try {
      vm.runInContext(MAIN_SRC, ctx, { filename: "main.js" });
      if (t.setup) vm.runInContext(t.setup, ctx, { filename: "setup" });
      const actual = vm.runInContext(t.call || "", ctx, { filename: "call" });
      let expected;
      try {
        expected = JSON.parse(t.expected);
      } catch (parseErr) {
        throw new Error("invalid expected (must be JSON-literal): " + parseErr.message);
      }
      results.push({
        name: t.name,
        hidden: !!t.hidden,
        category: t.category || null,
        passed: deepEqual(actual, expected),
        actualRepr: repr(actual),
        expectedRepr: repr(expected),
        stdoutDuring: sink.buf,
        error: null,
      });
    } catch (e) {
      const msg = e instanceof Error ? (e.name + ": " + e.message) : String(e);
      results.push({
        name: t.name,
        hidden: !!t.hidden,
        category: t.category || null,
        passed: false,
        actualRepr: null,
        expectedRepr: null,
        stdoutDuring: sink.buf,
        error: msg,
      });
    }
  }
}

const payload = JSON.stringify({ results: results, harnessError: harnessError });
process.stdout.write(SENTINEL + payload + SENTINEL + "\\n");
`;
}

/**
 * Parser is identical to the Python harness — sentinel framing is shared so
 * any language that follows the same envelope can reuse it. Kept local to
 * this file rather than factored out because the "factor it" itch doesn't
 * buy us anything yet (two call sites, five lines each of difference would
 * be zero).
 */
export function parseHarnessOutput(stdout: string, stderr: string): TestReport {
  const start = stdout.indexOf(TEST_SENTINEL);
  const end = stdout.lastIndexOf(TEST_SENTINEL);
  if (start === -1 || start === end) {
    const msg = stderr.trim() || "Tests could not run. Check for syntax errors in your code.";
    return { results: [], harnessError: msg, cleanStdout: stdout };
  }
  const jsonStr = stdout.slice(start + TEST_SENTINEL.length, end);
  let afterEnd = end + TEST_SENTINEL.length;
  if (stdout[afterEnd] === "\n") afterEnd++;
  const cleanStdout = (stdout.slice(0, start) + stdout.slice(afterEnd)).replace(/\n+$/, "");

  let parsed: { results: TestCaseResult[]; harnessError: string | null };
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return {
      results: [],
      harnessError: "Could not parse test results — the harness output was malformed.",
      cleanStdout: stdout,
    };
  }
  return {
    results: Array.isArray(parsed.results) ? parsed.results : [],
    harnessError: parsed.harnessError ?? null,
    cleanStdout,
  };
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
  parseOutput: parseHarnessOutput,
};
