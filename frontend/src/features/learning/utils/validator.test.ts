import { describe, it, expect } from "vitest";
import { validateLesson, pickFirstFailure } from "./validator";
import type { CompletionRule, TestCaseResult, TestReport } from "../types";
import type { RunResult, ProjectFile } from "../../../types";

function tc(overrides: Partial<TestCaseResult> = {}): TestCaseResult {
  return {
    name: "t",
    hidden: false,
    category: null,
    passed: true,
    actualRepr: null,
    expectedRepr: null,
    stdoutDuring: "",
    error: null,
    ...overrides,
  };
}

function report(results: TestCaseResult[], harnessError: string | null = null): TestReport {
  return { results, harnessError, cleanStdout: "" };
}

const okRun: RunResult = {
  stdout: "Hello, World!\n",
  stderr: "",
  exitCode: 0,
  durationMs: 42,
  errorType: "none",
  stage: "run",
};

const errorRun: RunResult = {
  stdout: "",
  stderr: "SyntaxError: invalid syntax",
  exitCode: 1,
  durationMs: 10,
  errorType: "runtime",
  stage: "run",
};

const files: ProjectFile[] = [
  { path: "main.py", content: 'print("Hello, World!")\n' },
];

describe("validateLesson", () => {
  it("auto-passes when there are no rules", () => {
    const result = validateLesson(okRun, files, []);
    expect(result.passed).toBe(true);
  });

  it("passes expected_stdout when output contains the expected string", () => {
    const rules: CompletionRule[] = [
      { type: "expected_stdout", expected: "Hello, World!" },
    ];
    const result = validateLesson(okRun, files, rules);
    expect(result.passed).toBe(true);
  });

  it("fails expected_stdout when output does not match", () => {
    const rules: CompletionRule[] = [
      { type: "expected_stdout", expected: "Goodbye" },
    ];
    const result = validateLesson(okRun, files, rules);
    expect(result.passed).toBe(false);
    expect(result.feedback.some((f) => f.includes("Goodbye"))).toBe(true);
  });

  it("fails expected_stdout when no run result exists", () => {
    const rules: CompletionRule[] = [
      { type: "expected_stdout", expected: "Hello" },
    ];
    const result = validateLesson(null, files, rules);
    expect(result.passed).toBe(false);
    expect(result.feedback[0]).toMatch(/run your code/i);
  });

  it("fails expected_stdout when exit code is nonzero", () => {
    const rules: CompletionRule[] = [
      { type: "expected_stdout", expected: "Hello" },
    ];
    const result = validateLesson(errorRun, files, rules);
    expect(result.passed).toBe(false);
    expect(result.feedback[0]).toMatch(/error/i);
  });

  it("passes required_file_contains when pattern is present", () => {
    const rules: CompletionRule[] = [
      { type: "required_file_contains", file: "main.py", pattern: "print" },
    ];
    const result = validateLesson(okRun, files, rules);
    expect(result.passed).toBe(true);
  });

  it("fails required_file_contains when pattern is missing", () => {
    const rules: CompletionRule[] = [
      { type: "required_file_contains", file: "main.py", pattern: "input(" },
    ];
    const result = validateLesson(okRun, files, rules);
    expect(result.passed).toBe(false);
  });

  it("fails required_file_contains when file does not exist", () => {
    const rules: CompletionRule[] = [
      { type: "required_file_contains", file: "other.py", pattern: "x" },
    ];
    const result = validateLesson(okRun, files, rules);
    expect(result.passed).toBe(false);
    expect(result.feedback[0]).toMatch(/not found/i);
  });

  it("defaults to main.py when file is not specified", () => {
    const rules: CompletionRule[] = [
      { type: "required_file_contains", pattern: "print" },
    ];
    const result = validateLesson(okRun, files, rules);
    expect(result.passed).toBe(true);
  });

  it("requires all rules to pass", () => {
    const rules: CompletionRule[] = [
      { type: "expected_stdout", expected: "Hello, World!" },
      { type: "required_file_contains", file: "main.py", pattern: "input(" },
    ];
    const result = validateLesson(okRun, files, rules);
    expect(result.passed).toBe(false);
  });

  it("handles custom_validator gracefully", () => {
    const rules: CompletionRule[] = [
      { type: "custom_validator" },
    ];
    const result = validateLesson(okRun, files, rules);
    expect(result.passed).toBe(true);
  });

  it("returns nextHints when validation fails", () => {
    const rules: CompletionRule[] = [
      { type: "expected_stdout", expected: "Goodbye" },
    ];
    const result = validateLesson(okRun, files, rules);
    expect(result.passed).toBe(false);
    expect(result.nextHints).toBeDefined();
    expect(result.nextHints!.length).toBeGreaterThan(0);
  });

  describe("function_tests", () => {
    const rules: CompletionRule[] = [{ type: "function_tests" }];

    it("fails when no testReport has been run yet", () => {
      const v = validateLesson(okRun, files, rules);
      expect(v.passed).toBe(false);
      expect(v.feedback[0]).toMatch(/run the examples first/i);
    });

    it("fails when the harness reports a harnessError (code crashed)", () => {
      const v = validateLesson(okRun, files, rules, {
        testReport: report([], "NameError: xxx"),
      });
      expect(v.passed).toBe(false);
      expect(v.feedback[0]).toMatch(/couldn't run/i);
    });

    it("passes when every test in the report passes", () => {
      const v = validateLesson(okRun, files, rules, {
        testReport: report([tc({ name: "a" }), tc({ name: "b" }), tc({ name: "c", hidden: true })]),
      });
      expect(v.passed).toBe(true);
      expect(v.feedback[0]).toMatch(/all 3 tests pass/i);
    });

    it("fails and names the failing visible test", () => {
      const v = validateLesson(okRun, files, rules, {
        testReport: report([
          tc({ name: "empty", passed: false }),
          tc({ name: "ok", passed: true }),
        ]),
      });
      expect(v.passed).toBe(false);
      expect(v.feedback[0]).toMatch(/"empty"/);
    });

    it("fails with generic copy when only a hidden test fails", () => {
      const v = validateLesson(okRun, files, rules, {
        testReport: report([
          tc({ name: "vis", passed: true }),
          tc({ name: "hid", passed: false, hidden: true, category: "empty-input" }),
        ]),
      });
      expect(v.passed).toBe(false);
      // Must NOT name the hidden test
      expect(v.feedback[0]).not.toContain("hid");
      expect(v.feedback[0]).toMatch(/visible examples but breaks/i);
    });

    it("prioritizes visible failure over hidden failure in feedback", () => {
      const v = validateLesson(okRun, files, rules, {
        testReport: report([
          tc({ name: "vis-fail", passed: false }),
          tc({ name: "hid-fail", passed: false, hidden: true }),
        ]),
      });
      expect(v.feedback[0]).toContain("vis-fail");
      expect(v.feedback[0]).not.toContain("hid-fail");
    });

    it("combines with other rules — both must pass", () => {
      const mixed: CompletionRule[] = [
        { type: "function_tests" },
        { type: "required_file_contains", file: "main.py", pattern: "def " },
      ];
      const withFunc: ProjectFile[] = [{ path: "main.py", content: "def f(): pass\n" }];
      const v = validateLesson(okRun, withFunc, mixed, {
        testReport: report([tc({ passed: false })]),
      });
      expect(v.passed).toBe(false);
    });
  });

  describe("pickFirstFailure", () => {
    it("returns null for null/empty reports", () => {
      expect(pickFirstFailure(null)).toBeNull();
      expect(pickFirstFailure(report([]))).toBeNull();
    });

    it("returns the first visible failure, skipping passing ones", () => {
      const r = report([
        tc({ name: "ok1" }),
        tc({ name: "fail1", passed: false }),
        tc({ name: "fail2", passed: false }),
      ]);
      expect(pickFirstFailure(r)?.name).toBe("fail1");
    });

    it("returns the first hidden failure when all visible pass", () => {
      const r = report([
        tc({ name: "ok1" }),
        tc({ name: "ok2" }),
        tc({ name: "hid", passed: false, hidden: true }),
      ]);
      expect(pickFirstFailure(r)?.name).toBe("hid");
    });

    it("prefers visible failure over hidden failure", () => {
      const r = report([
        tc({ name: "hid-fail", passed: false, hidden: true }),
        tc({ name: "vis-fail", passed: false }),
      ]);
      expect(pickFirstFailure(r)?.name).toBe("vis-fail");
    });

    it("returns null when every test passes", () => {
      expect(pickFirstFailure(report([tc(), tc()]))).toBeNull();
    });
  });

  describe("required_file_contains word-boundary matching", () => {
    it("does NOT match 'int(' inside 'print('", () => {
      const rules: CompletionRule[] = [
        { type: "required_file_contains", file: "main.py", pattern: "int(" },
      ];
      const printOnly: ProjectFile[] = [
        { path: "main.py", content: 'print("hi")\n' },
      ];
      const result = validateLesson(okRun, printOnly, rules);
      expect(result.passed).toBe(false);
    });

    it("DOES match 'int(' when standalone", () => {
      const rules: CompletionRule[] = [
        { type: "required_file_contains", file: "main.py", pattern: "int(" },
      ];
      const withInt: ProjectFile[] = [
        { path: "main.py", content: 'x = int(input("n: "))\n' },
      ];
      const result = validateLesson(okRun, withInt, rules);
      expect(result.passed).toBe(true);
    });

    it("does NOT match 'append(' inside another identifier (hypothetical)", () => {
      const rules: CompletionRule[] = [
        { type: "required_file_contains", file: "main.py", pattern: "append(" },
      ];
      // A contrived case where "append" would be a substring of a longer identifier
      const embedded: ProjectFile[] = [
        { path: "main.py", content: "xappend(5)\n" },
      ];
      const result = validateLesson(okRun, embedded, rules);
      expect(result.passed).toBe(false);
    });

    it("matches '.get(' as plain substring (non-word-starting pattern)", () => {
      const rules: CompletionRule[] = [
        { type: "required_file_contains", file: "main.py", pattern: ".get(" },
      ];
      const withGet: ProjectFile[] = [
        { path: "main.py", content: "d.get(key, 0)\n" },
      ];
      const result = validateLesson(okRun, withGet, rules);
      expect(result.passed).toBe(true);
    });

    it("matches identifier patterns after punctuation (method calls like '.append(')", () => {
      const rules: CompletionRule[] = [
        { type: "required_file_contains", file: "main.py", pattern: "append(" },
      ];
      const methodCall: ProjectFile[] = [
        { path: "main.py", content: "numbers.append(0)\n" },
      ];
      const result = validateLesson(okRun, methodCall, rules);
      expect(result.passed).toBe(true);
    });

    it("matches 'for ' even when trailing space is significant", () => {
      const rules: CompletionRule[] = [
        { type: "required_file_contains", file: "main.py", pattern: "for " },
      ];
      const withFor: ProjectFile[] = [
        { path: "main.py", content: "for x in items:\n    print(x)\n" },
      ];
      const result = validateLesson(okRun, withFor, rules);
      expect(result.passed).toBe(true);
    });
  });
});
