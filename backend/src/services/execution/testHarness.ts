import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../../config.js";
import { execShell } from "../docker/dockerExec.js";

export const TEST_SENTINEL = "__CODETUTOR_TESTS_v1_da39a3ee5e6b4b0d__";
export const HARNESS_PY = "__codetutor_tests.py";
export const HARNESS_JSON = "__codetutor_tests.json";

export interface FunctionTest {
  name: string;
  call: string;
  expected: string;
  setup?: string;
  hidden?: boolean;
  category?: string;
}

export interface TestCaseResult {
  name: string;
  hidden: boolean;
  category: string | null;
  passed: boolean;
  actualRepr: string | null;
  expectedRepr: string | null;
  stdoutDuring: string;
  error: string | null;
}

export interface TestReport {
  results: TestCaseResult[];
  harnessError: string | null;
  cleanStdout: string;
}

export interface RunTestsOptions {
  containerId: string;
  workspacePath: string;
  tests: FunctionTest[];
  timeoutMs?: number;
}

export interface RunTestsResult {
  report: TestReport;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  durationMs: number;
}

/**
 * Python harness: runs main.py via runpy (so `if __name__ == "__main__":`
 * guards skip), then iterates TESTS from a sibling JSON file, evaluating each
 * call expression against a fresh copy of the learner's module globals.
 * Expected values are parsed with ast.literal_eval so they're limited to
 * Python literal syntax (lists, dicts, tuples, strings, numbers, booleans,
 * None) — safe for author-written JSON. Per-test stdout is captured with
 * contextlib.redirect_stdout so the learner's prints don't pollute the
 * sentinel-wrapped JSON that the parser reads.
 */
export function harnessPython(): string {
  return `import json, sys, traceback, contextlib, io, runpy, ast

SENTINEL = "${TEST_SENTINEL}"

with open("${HARNESS_JSON}", "r", encoding="utf-8") as _f:
    TESTS = json.load(_f)

results = []
harness_error = None

try:
    mod_globals = runpy.run_path("main.py", run_name="__codetutor_main__")
except SystemExit:
    harness_error = "Your program called exit()."
except BaseException:
    harness_error = traceback.format_exc()

if harness_error is None:
    for t in TESTS:
        name = t["name"]
        call_src = t.get("call") or ""
        setup_src = t.get("setup") or ""
        expected_src = t["expected"]
        out_buf = io.StringIO()
        ns = dict(mod_globals)
        try:
            if setup_src:
                exec(setup_src, ns)
            with contextlib.redirect_stdout(out_buf):
                actual = eval(call_src, ns)
            expected = ast.literal_eval(expected_src)
            passed = actual == expected
            results.append({
                "name": name,
                "hidden": bool(t.get("hidden", False)),
                "category": t.get("category"),
                "passed": passed,
                "actualRepr": repr(actual),
                "expectedRepr": repr(expected),
                "stdoutDuring": out_buf.getvalue(),
                "error": None,
            })
        except BaseException:
            results.append({
                "name": name,
                "hidden": bool(t.get("hidden", False)),
                "category": t.get("category"),
                "passed": False,
                "actualRepr": None,
                "expectedRepr": None,
                "stdoutDuring": out_buf.getvalue(),
                "error": traceback.format_exc(limit=1),
            })

payload = json.dumps({"results": results, "harnessError": harness_error})
sys.stdout.write(SENTINEL + payload + SENTINEL + "\\n")
`;
}

/**
 * Extracts the sentinel-wrapped JSON emitted by the harness. Anything the
 * learner's code printed during module load (or during tests via the
 * redirected buffer) is preserved as cleanStdout so the UI can still show it.
 * If the sentinels are missing — the harness itself crashed before it could
 * print — returns a harnessError so the UI shows a generic "code errored
 * before tests could run" message.
 */
export function parseHarnessOutput(stdout: string, stderr: string): TestReport {
  const start = stdout.indexOf(TEST_SENTINEL);
  const end = stdout.lastIndexOf(TEST_SENTINEL);
  if (start === -1 || start === end) {
    // Fallback: harness never emitted its sentinel block. Surface stderr as
    // the diagnostic so the UI can say "something broke before tests ran".
    const msg = stderr.trim() || "Tests could not run. Check for syntax errors in your code.";
    return { results: [], harnessError: msg, cleanStdout: stdout };
  }
  const jsonStr = stdout.slice(start + TEST_SENTINEL.length, end);
  // The harness writes `SENTINEL + payload + SENTINEL + "\n"`; strip that
  // trailing newline so the sentinel block leaves no visible gap in learner
  // stdout. Then trim trailing newlines from the whole cleanStdout too.
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

export async function runTests(opts: RunTestsOptions): Promise<RunTestsResult> {
  const { containerId, workspacePath, tests } = opts;
  const timeoutMs = opts.timeoutMs ?? config.runner.execTimeoutMs;
  const pyPath = path.join(workspacePath, HARNESS_PY);
  const jsonPath = path.join(workspacePath, HARNESS_JSON);

  try {
    await fs.writeFile(pyPath, harnessPython(), "utf8");
    await fs.chmod(pyPath, 0o666).catch(() => {});
    await fs.writeFile(jsonPath, JSON.stringify(tests), "utf8");
    await fs.chmod(jsonPath, 0o666).catch(() => {});

    const exec = await execShell(
      containerId,
      `python3 ${HARNESS_PY}`,
      timeoutMs,
      { stdin: "" },
    );

    // On timeout (137 from `timeout --signal=KILL`) the harness didn't finish
    // — return an explicit harnessError so the UI can say so rather than
    // showing an empty results array.
    const timedOut = exec.exitCode === 137;
    if (timedOut) {
      return {
        report: {
          results: [],
          harnessError: `Tests timed out after ${timeoutMs}ms. Check for infinite loops.`,
          cleanStdout: exec.stdout,
        },
        stderr: exec.stderr,
        exitCode: exec.exitCode,
        timedOut: true,
        durationMs: exec.durationMs,
      };
    }

    const report = parseHarnessOutput(exec.stdout, exec.stderr);
    return {
      report,
      stderr: exec.stderr,
      exitCode: exec.exitCode,
      timedOut: false,
      durationMs: exec.durationMs,
    };
  } finally {
    await fs.rm(pyPath, { force: true }).catch(() => {});
    await fs.rm(jsonPath, { force: true }).catch(() => {});
  }
}
