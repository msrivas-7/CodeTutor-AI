import { describe, it, expect } from "vitest";
import { buildLessonContextBlock } from "./lessonContext.js";
import type { LessonContext } from "./lessonContext.js";

const full: LessonContext = {
  courseId: "python-fundamentals",
  lessonId: "hello-world",
  lessonTitle: "Hello, World!",
  language: "python",
  lessonObjectives: ["Write and run a Python program", "Use print()"],
  teachesConceptTags: ["print", "strings"],
  usesConceptTags: ["syntax"],
  priorConcepts: ["identifiers", "whitespace"],
  completionRules: [{ type: "expected_stdout", expected: "Hello, World!" }],
  studentProgressSummary: "attempt 1, 0 runs",
  lessonOrder: 1,
  totalLessons: 10,
};

describe("buildLessonContextBlock", () => {
  it("includes the lesson title in quotes", () => {
    const block = buildLessonContextBlock(full);
    expect(block).toMatch(/"Hello, World!"/);
  });

  it("renders each objective as a bullet", () => {
    const block = buildLessonContextBlock(full);
    expect(block).toMatch(/- Write and run a Python program/);
    expect(block).toMatch(/- Use print\(\)/);
  });

  it("renders teaches, uses, and prior concepts on separate labeled lines", () => {
    const block = buildLessonContextBlock(full);
    expect(block).toMatch(/TEACHES.*print, strings/);
    expect(block).toMatch(/USES.*syntax/);
    expect(block).toMatch(/EARLIER lessons.*identifiers, whitespace/);
  });

  it("labels empty concept lists as (none declared) instead of dropping the line", () => {
    const ctx: LessonContext = { ...full, usesConceptTags: [], priorConcepts: [] };
    const block = buildLessonContextBlock(ctx);
    expect(block).toMatch(/USES.*\(none declared\)/);
    expect(block).toMatch(/EARLIER lessons.*\(none declared\)/);
  });

  it("renders expected_stdout rule as task description", () => {
    const block = buildLessonContextBlock(full);
    expect(block).toMatch(/produce stdout containing "Hello, World!"/);
  });

  it("renders required_file_contains rule with file name", () => {
    const ctx: LessonContext = {
      ...full,
      completionRules: [{ type: "required_file_contains", file: "main.py", pattern: "print" }],
    };
    const block = buildLessonContextBlock(ctx);
    expect(block).toMatch(/write code in main\.py containing `print`/);
  });

  it("defaults to main.py when file is not specified in required_file_contains", () => {
    const ctx: LessonContext = {
      ...full,
      completionRules: [{ type: "required_file_contains", pattern: "def " }],
    };
    const block = buildLessonContextBlock(ctx);
    expect(block).toMatch(/write code in main\.py containing `def `/);
  });

  it("uses the language's entry file for required_file_contains fallback (javascript)", () => {
    const ctx: LessonContext = {
      ...full,
      language: "javascript",
      completionRules: [{ type: "required_file_contains", pattern: "function" }],
    };
    const block = buildLessonContextBlock(ctx);
    expect(block).toMatch(/write code in main\.js containing `function`/);
  });

  it("describes function_tests as defining the tested functions", () => {
    const ctx: LessonContext = {
      ...full,
      completionRules: [
        { type: "function_tests", tests: [{ name: "t", call: "f(1)", expected: "1" }] },
      ],
    };
    const block = buildLessonContextBlock(ctx);
    expect(block).toMatch(/define the tested function/);
  });

  it("renders custom_validator as pass custom validation", () => {
    const ctx: LessonContext = {
      ...full,
      completionRules: [{ type: "custom_validator" }],
    };
    const block = buildLessonContextBlock(ctx);
    expect(block).toMatch(/pass custom validation/);
  });

  it("joins multiple rules with '; and '", () => {
    const ctx: LessonContext = {
      ...full,
      completionRules: [
        { type: "expected_stdout", expected: "Hello" },
        { type: "required_file_contains", file: "main.py", pattern: "print" },
      ],
    };
    const block = buildLessonContextBlock(ctx);
    expect(block).toMatch(/; and /);
  });

  it("includes lesson order when provided", () => {
    const block = buildLessonContextBlock(full);
    expect(block).toMatch(/GUIDED LESSON \(lesson 1 of 10\)/);
  });

  it("omits lesson order when not provided", () => {
    const { lessonOrder, totalLessons, ...noOrder } = full;
    const block = buildLessonContextBlock(noOrder as LessonContext);
    expect(block).toMatch(/^GUIDED LESSON\n/);
    expect(block).not.toMatch(/lesson \d+ of/);
  });

  it("includes student progress summary", () => {
    const block = buildLessonContextBlock(full);
    expect(block).toMatch(/Progress: attempt 1, 0 runs/);
  });

  it("includes lesson rules warning about future material", () => {
    const block = buildLessonContextBlock(full);
    expect(block).toMatch(/IMPORTANT LESSON RULES:/);
    expect(block).toMatch(/Stay within the scope/);
    expect(block).toMatch(/future material/);
    expect(block).toMatch(/Guide toward the solution without giving it away/);
  });
});
