import {
  TEST_SENTINEL,
  type FunctionTest,
  type HarnessBackend,
  type HarnessFile,
  type TestCaseResult,
  type TestReport,
} from "./types.js";

export const HARNESS_PY = "__codetutor_tests.py";
export const HARNESS_JSON = "__codetutor_tests.json";

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

export const pythonHarness: HarnessBackend = {
  language: "python",
  prepareFiles(tests: FunctionTest[]): HarnessFile[] {
    return [
      { name: HARNESS_PY, content: harnessPython() },
      { name: HARNESS_JSON, content: JSON.stringify(tests) },
    ];
  },
  execCommand(): string {
    return `python3 ${HARNESS_PY}`;
  },
  parseOutput: parseHarnessOutput,
};
