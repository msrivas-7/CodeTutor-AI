import type { CompletionRule, TestCaseResult, TestReport, ValidationResult } from "../types";
import { LANGUAGE_ENTRYPOINT, type Language, type RunResult, type ProjectFile } from "../../../types";

const PRINT_CALL_BY_LANGUAGE: Record<Language, string> = {
  python: "print()",
  javascript: "console.log()",
  typescript: "console.log()",
  c: "printf()",
  cpp: "std::cout",
  java: "System.out.println()",
  go: "fmt.Println()",
  rust: "println!()",
  ruby: "puts",
};

// Word-boundary-aware substring check. For patterns that start with an
// identifier character (letter/digit/underscore), requires a word boundary
// on the left — otherwise "int(" would falsely match inside "print(". For
// patterns starting with a non-word char (".get(", "else:"), falls back to
// plain substring matching.
function containsPattern(content: string, pattern: string): boolean {
  if (!pattern) return true;
  if (!/^\w/.test(pattern)) return content.includes(pattern);
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}`).test(content);
}

export interface ValidateExtraContext {
  testReport?: TestReport | null;
  language?: Language;
}

/**
 * Returns the single most informative failure from a test report, in priority
 * order: first failing visible test, then first failing hidden test. Used by
 * the FailedTestCallout so the learner sees one thing to focus on rather
 * than a wall of red.
 */
export function pickFirstFailure(report: TestReport | null | undefined): TestCaseResult | null {
  if (!report || !report.results) return null;
  const visibleFail = report.results.find((r) => !r.passed && !r.hidden);
  if (visibleFail) return visibleFail;
  const hiddenFail = report.results.find((r) => !r.passed && r.hidden);
  return hiddenFail ?? null;
}

export function validateLesson(
  result: RunResult | null,
  files: ProjectFile[],
  rules: CompletionRule[],
  extra: ValidateExtraContext = {},
): ValidationResult {
  if (!rules.length) {
    return { passed: true, feedback: ["No validation rules — auto-pass."] };
  }

  const feedback: string[] = [];
  const nextHints: string[] = [];
  let allPassed = true;

  for (const rule of rules) {
    switch (rule.type) {
      case "expected_stdout": {
        if (!result) {
          feedback.push("Run your code first before checking.");
          allPassed = false;
          break;
        }
        if (result.exitCode !== 0) {
          feedback.push("Your code has an error — fix it and run again.");
          nextHints.push("Check the output panel for error messages.");
          allPassed = false;
          break;
        }
        const expected = (rule.expected ?? "").trim();
        const actual = (result.stdout ?? "").trim();
        if (actual.includes(expected)) {
          feedback.push(`Output contains "${expected}" — correct!`);
        } else if (actual.length === 0) {
          const printCall = extra.language ? PRINT_CALL_BY_LANGUAGE[extra.language] : "print()";
          feedback.push(`Your code ran but produced no output. Make sure you're using ${printCall}.`);
          nextHints.push(`Add a ${printCall} statement to display your result.`);
          allPassed = false;
        } else {
          feedback.push(`Expected "${expected}" in output, but got: "${actual.slice(0, 80)}"`);
          nextHints.push("Compare your output carefully — check spelling, spacing, and punctuation.");
          allPassed = false;
        }
        break;
      }
      case "required_file_contains": {
        const targetPath = rule.file ?? (extra.language ? LANGUAGE_ENTRYPOINT[extra.language] : "main.py");
        const file = files.find((f) => f.path === targetPath);
        if (!file) {
          feedback.push(`File "${targetPath}" not found.`);
          allPassed = false;
          break;
        }
        const pattern = rule.pattern ?? "";
        if (containsPattern(file.content, pattern)) {
          feedback.push(`File "${targetPath}" contains the required code.`);
        } else {
          feedback.push(`File "${targetPath}" is missing required code pattern.`);
          nextHints.push(`Make sure your code in ${targetPath} uses the required approach.`);
          allPassed = false;
        }
        break;
      }
      case "function_tests": {
        const report = extra.testReport ?? null;
        if (!report) {
          feedback.push("Run the examples first so we can check your function.");
          allPassed = false;
          break;
        }
        if (report.harnessError) {
          feedback.push("Your code couldn't run — fix the error above, then try again.");
          nextHints.push("The tests need your code to run without errors before they can check it.");
          allPassed = false;
          break;
        }
        const failed = report.results.filter((r) => !r.passed);
        if (failed.length === 0) {
          feedback.push(`All ${report.results.length} tests pass — nice work!`);
          break;
        }
        const firstFail = pickFirstFailure(report);
        if (firstFail && !firstFail.hidden) {
          feedback.push(`Test "${firstFail.name}" didn't match.`);
          nextHints.push("Look at the failing example and compare your output to the expected value.");
        } else {
          feedback.push("Your function works on the visible examples but breaks on a related case.");
          nextHints.push("Sketch 2–3 more inputs you'd expect it to handle, then trace them through your code.");
        }
        allPassed = false;
        break;
      }
      case "custom_validator": {
        feedback.push("Custom validation is not yet supported.");
        break;
      }
    }
  }

  return { passed: allPassed, feedback, nextHints: nextHints.length > 0 ? nextHints : undefined };
}
