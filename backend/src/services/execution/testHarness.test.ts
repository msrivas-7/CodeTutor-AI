import { describe, it, expect } from "vitest";
import {
  harnessPython,
  parseHarnessOutput,
  TEST_SENTINEL,
  HARNESS_JSON,
} from "./testHarness.js";

describe("harnessPython", () => {
  const src = harnessPython();

  it("embeds the sentinel constant", () => {
    expect(src).toContain(TEST_SENTINEL);
  });

  it("reads tests from the sibling JSON file (never inlines them)", () => {
    expect(src).toContain(`open("${HARNESS_JSON}"`);
    expect(src).toContain("json.load(_f)");
  });

  it("runs main.py under a non-__main__ module name so __main__ guards skip", () => {
    expect(src).toContain(`runpy.run_path("main.py"`);
    expect(src).toContain(`run_name="__codetutor_main__"`);
  });

  it("captures per-test stdout with redirect_stdout", () => {
    expect(src).toContain("contextlib.redirect_stdout(out_buf)");
  });

  it("parses expected values with ast.literal_eval (not raw eval) for safety", () => {
    expect(src).toContain("ast.literal_eval(expected_src)");
    // No bare `eval(expected_src)` — only the ast.literal_eval variant.
    expect(src).not.toMatch(/(?<!ast\.literal_)eval\(expected_src\)/);
  });

  it("catches harness-level errors into harness_error", () => {
    expect(src).toContain("harness_error = traceback.format_exc()");
  });

  it("wraps output between two sentinels on stdout", () => {
    expect(src).toContain("SENTINEL + payload + SENTINEL");
  });

  it("uses BaseException so KeyboardInterrupt/SystemExit don't escape tests", () => {
    expect(src).toContain("except BaseException:");
  });
});

describe("parseHarnessOutput", () => {
  const wrap = (json: string) => `${TEST_SENTINEL}${json}${TEST_SENTINEL}\n`;

  it("extracts results + harnessError when sentinel is present", () => {
    const payload = JSON.stringify({
      results: [
        {
          name: "t1",
          hidden: false,
          category: null,
          passed: true,
          actualRepr: "1",
          expectedRepr: "1",
          stdoutDuring: "",
          error: null,
        },
      ],
      harnessError: null,
    });
    const r = parseHarnessOutput(wrap(payload), "");
    expect(r.harnessError).toBeNull();
    expect(r.results).toHaveLength(1);
    expect(r.results[0].name).toBe("t1");
    expect(r.results[0].passed).toBe(true);
  });

  it("preserves learner's prints as cleanStdout (pre-sentinel)", () => {
    const payload = JSON.stringify({ results: [], harnessError: null });
    const out = `hello from learner\n${wrap(payload)}`;
    const r = parseHarnessOutput(out, "");
    expect(r.cleanStdout).toBe("hello from learner");
  });

  it("returns harnessError fallback when sentinel is missing", () => {
    const r = parseHarnessOutput("", "SyntaxError: invalid syntax");
    expect(r.harnessError).toContain("SyntaxError");
    expect(r.results).toEqual([]);
  });

  it("returns generic harnessError when sentinel missing and stderr is empty", () => {
    const r = parseHarnessOutput("random text\n", "");
    expect(r.harnessError).toMatch(/tests could not run/i);
    expect(r.results).toEqual([]);
  });

  it("returns harnessError fallback when only one sentinel is present", () => {
    const r = parseHarnessOutput(`${TEST_SENTINEL}garbage`, "");
    expect(r.harnessError).toMatch(/tests could not run/i);
    expect(r.results).toEqual([]);
  });

  it("returns harnessError when sentinel payload is not valid JSON", () => {
    const r = parseHarnessOutput(wrap("not-json{"), "");
    expect(r.harnessError).toMatch(/malformed/i);
    expect(r.results).toEqual([]);
  });

  it("propagates harnessError from the harness payload (e.g. main.py crashed)", () => {
    const payload = JSON.stringify({
      results: [],
      harnessError: "Traceback (most recent call last):\n  ...\nNameError: xxx",
    });
    const r = parseHarnessOutput(wrap(payload), "");
    expect(r.harnessError).toContain("NameError");
    expect(r.results).toEqual([]);
  });

  it("returns [] for results if the payload's results isn't an array", () => {
    const payload = JSON.stringify({ results: "oops", harnessError: null });
    const r = parseHarnessOutput(wrap(payload), "");
    expect(r.results).toEqual([]);
    expect(r.harnessError).toBeNull();
  });

  it("handles multiple visible + hidden test results", () => {
    const payload = JSON.stringify({
      results: [
        { name: "basic", hidden: false, category: null, passed: true, actualRepr: "['hi']", expectedRepr: "['hi']", stdoutDuring: "", error: null },
        { name: "empty", hidden: true, category: "empty-input", passed: false, actualRepr: null, expectedRepr: null, stdoutDuring: "", error: "TypeError: ..." },
      ],
      harnessError: null,
    });
    const r = parseHarnessOutput(wrap(payload), "");
    expect(r.results).toHaveLength(2);
    expect(r.results[0].hidden).toBe(false);
    expect(r.results[1].hidden).toBe(true);
    expect(r.results[1].category).toBe("empty-input");
    expect(r.results[1].passed).toBe(false);
  });

  it("strips only the sentinel block — print after tests is preserved", () => {
    const payload = JSON.stringify({ results: [], harnessError: null });
    const out = `prefix\n${wrap(payload)}suffix`;
    const r = parseHarnessOutput(out, "");
    expect(r.cleanStdout).toBe("prefix\nsuffix");
  });
});
