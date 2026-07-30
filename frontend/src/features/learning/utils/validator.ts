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
  // Phase A — A1: when a lesson has a `retrieval_check` rule, this flag
  // gates its pass. Source of truth lives in LessonPage state +
  // localStorage; the validator just consumes it. `undefined` /
  // `false` → the gate fails (lesson not yet complete). The completion
  // panel mounts only when ALL rules pass — so a learner who solved
  // the stdout but hasn't answered the retrieval check sees a
  // RetrievalCheckPanel UI before the celebration.
  retrievalAnswered?: boolean;
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
    return {
      passed: true,
      passedExceptRetrieval: true,
      feedback: ["No validation rules — auto-pass."],
    };
  }

  const feedback: string[] = [];
  const nextHints: string[] = [];
  let allPassed = true;
  // Phase A — A1: track non-retrieval pass separately so LessonPage
  // can decide when to mount the RetrievalCheckPanel (only when the
  // executable rules are already green).
  let allNonRetrievalPassed = true;

  for (const rule of rules) {
    switch (rule.type) {
      case "expected_stdout": {
        if (!result) {
          feedback.push("Run your code first before checking.");
          allPassed = false;
          allNonRetrievalPassed = false;
          break;
        }
        if (result.exitCode !== 0) {
          feedback.push("Your code has an error — fix it and run again.");
          nextHints.push("Check the output panel for error messages.");
          allPassed = false;
          allNonRetrievalPassed = false;
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
          allNonRetrievalPassed = false;
        } else {
          feedback.push(`Expected "${expected}" in output, but got: "${actual.slice(0, 80)}"`);
          nextHints.push("Compare your output carefully — check spelling, spacing, and punctuation.");
          allPassed = false;
          allNonRetrievalPassed = false;
        }
        break;
      }
      case "forbidden_in_stdout": {
        // Paired with expected_stdout to reject "lazy-pass" outputs.
        // Lesson authors set the pattern to whatever the learner would
        // produce by accident or by literal copy-paste of an example
        // (lesson 1: "Hello, World!" — the canonical first-program
        // greeting that the lesson's starter comment shows as a model).
        // Without this, the lenient `expected_stdout: "Hello, "`
        // substring rule would accept any output starting with "Hello, "
        // including the learner doing zero original work.
        if (!result) {
          feedback.push("Run your code first before checking.");
          allPassed = false;
          allNonRetrievalPassed = false;
          break;
        }
        const forbidden = (rule.pattern ?? "").trim();
        const stdoutForCheck = (result.stdout ?? "");
        if (forbidden && stdoutForCheck.includes(forbidden)) {
          feedback.push(
            `Your output still contains "${forbidden}" — replace it with your own value first.`,
          );
          nextHints.push(
            `Edit the code so the printed output no longer contains "${forbidden}".`,
          );
          allPassed = false;
          allNonRetrievalPassed = false;
        } else {
          feedback.push(`Output doesn't contain "${forbidden}" — good.`);
        }
        break;
      }
      case "required_file_contains": {
        const targetPath = rule.file ?? (extra.language ? LANGUAGE_ENTRYPOINT[extra.language] : "main.py");
        const file = files.find((f) => f.path === targetPath);
        if (!file) {
          feedback.push(`File "${targetPath}" not found.`);
          allPassed = false;
          allNonRetrievalPassed = false;
          break;
        }
        const pattern = rule.pattern ?? "";
        if (containsPattern(file.content, pattern)) {
          feedback.push(`File "${targetPath}" contains the required code.`);
        } else {
          feedback.push(`File "${targetPath}" is missing required code pattern.`);
          nextHints.push(`Make sure your code in ${targetPath} uses the required approach.`);
          allPassed = false;
          allNonRetrievalPassed = false;
        }
        break;
      }
      case "function_tests": {
        const report = extra.testReport ?? null;
        if (!report) {
          feedback.push("Run the examples first so we can check your function.");
          allPassed = false;
          allNonRetrievalPassed = false;
          break;
        }
        if (report.harnessError) {
          feedback.push("Your code couldn't run — fix the error above, then try again.");
          nextHints.push("The tests need your code to run without errors before they can check it.");
          allPassed = false;
          allNonRetrievalPassed = false;
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
        allNonRetrievalPassed = false;
        break;
      }
      case "custom_validator": {
        // Fail-closed: an unimplemented validator must never silently auto-pass
        // a lesson. Until custom_validator is wired, treat the whole rule as
        // unsatisfied so the learner isn't marked complete.
        feedback.push("Custom validation isn't implemented yet — please report this lesson.");
        allPassed = false;
        allNonRetrievalPassed = false;
        break;
      }
      case "retrieval_check": {
        // Phase A — A1: gated by `extra.retrievalAnswered` (sourced from
        // LessonPage state + localStorage). The actual question UI is
        // rendered by RetrievalCheckPanel — the validator just reflects
        // whether the learner has passed it.
        if (extra.retrievalAnswered === true) {
          feedback.push("Retrieval check passed — you've got the concept.");
        } else {
          feedback.push("One quick check before you finish — answer the question that appears.");
          // No nextHint here: the RetrievalCheckPanel is its own UI surface,
          // not something the learner can "fix" by editing code.
          allPassed = false;
        }
        break;
      }
    }
  }

  return {
    passed: allPassed,
    passedExceptRetrieval: allNonRetrievalPassed,
    feedback,
    nextHints: nextHints.length > 0 ? nextHints : undefined,
  };
}
