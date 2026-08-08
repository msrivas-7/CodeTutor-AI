// Phase 20-P3 Bucket 3 (#3): unit tests for the pure branches pulled out of
// useLessonLoader + useLessonValidator. These branches used to be covered
// only by Playwright, so the signal loop was 60+ seconds; now they have
// sub-millisecond coverage and the e2e suite only has to exercise the
// integration happy path.

import { describe, expect, it } from "vitest";
import type { FunctionTest, Lesson, TestReport } from "../types";
import {
  buildAskTutorPrompt,
  countFailsByVisibility,
  lessonWorkspaceContextKey,
  selectPracticeWorkspaceFiles,
  selectCompletionRulesForCheck,
  shouldAutoEnterPractice,
  shouldBouncePrereq,
  shouldPersistLessonDraft,
} from "./lessonGuards";

describe("lesson workspace boundaries", () => {
  it("uses different cache identities for anonymous and authenticated work", () => {
    expect(lessonWorkspaceContextKey("anon", "python", "hello")).toBe(
      "anon-lesson:python/hello",
    );
    expect(lessonWorkspaceContextKey("authed", "python", "hello")).toBe(
      "lesson:python/hello",
    );
  });

  it("never durably saves an anonymous draft even if the browser is signed in", () => {
    expect(
      shouldPersistLessonDraft(
        null,
        "anon-lesson:python/hello",
        "anon-lesson:python/hello",
      ),
    ).toBe(false);
    expect(
      shouldPersistLessonDraft(
        "user-1",
        "lesson:python/hello",
        "lesson:python/hello",
      ),
    ).toBe(true);
  });
});

describe("selectPracticeWorkspaceFiles", () => {
  const persisted = { "main.js": "function fixed() { return true; }\n" };
  const starter = "function fixed() { /* TODO */ }\n";

  it("resumes the exercise-specific saved buffer during ordinary navigation", () => {
    expect(
      selectPracticeWorkspaceFiles("main.js", starter, persisted, false),
    ).toEqual(persisted);
  });

  it("uses the immutable authored starter for an explicit reset", () => {
    expect(
      selectPracticeWorkspaceFiles("main.js", starter, persisted, true),
    ).toEqual({ "main.js": starter });
  });
});

describe("shouldBouncePrereq", () => {
  it("does not bounce when the lesson has no prerequisites", () => {
    expect(
      shouldBouncePrereq({
        lessonPrerequisiteIds: [],
        completedLessonIds: [],
        existingStatus: "not_started",
      }),
    ).toBe(false);
  });

  it("does not bounce when every prerequisite is completed", () => {
    expect(
      shouldBouncePrereq({
        lessonPrerequisiteIds: ["l1", "l2"],
        completedLessonIds: ["l1", "l2", "l3"],
        existingStatus: "not_started",
      }),
    ).toBe(false);
  });

  it("bounces when a prerequisite is missing and the lesson hasn't been started", () => {
    expect(
      shouldBouncePrereq({
        lessonPrerequisiteIds: ["l1", "l2"],
        completedLessonIds: ["l1"],
        existingStatus: "not_started",
      }),
    ).toBe(true);
  });

  it("bounces stale in-progress state when a prerequisite is missing", () => {
    expect(
      shouldBouncePrereq({
        lessonPrerequisiteIds: ["l1", "l2"],
        completedLessonIds: ["l1"],
        existingStatus: "in_progress",
      }),
    ).toBe(true);
  });

  it("bounces stale completed state when a prerequisite is missing", () => {
    expect(
      shouldBouncePrereq({
        lessonPrerequisiteIds: ["l1"],
        completedLessonIds: [],
        existingStatus: "completed",
      }),
    ).toBe(true);
  });
});

describe("shouldAutoEnterPractice", () => {
  const base = {
    hasLesson: true,
    modeParam: "practice" as string | null,
    lessonStatus: "completed" as "not_started" | "in_progress" | "completed" | undefined,
    practiceExerciseCount: 2,
  };

  it("enters when the lesson is completed and has exercises", () => {
    expect(shouldAutoEnterPractice(base)).toBe(true);
  });

  it("does not enter without a loaded lesson", () => {
    expect(shouldAutoEnterPractice({ ...base, hasLesson: false })).toBe(false);
  });

  it("does not enter when the query param is missing or wrong", () => {
    expect(shouldAutoEnterPractice({ ...base, modeParam: null })).toBe(false);
    expect(shouldAutoEnterPractice({ ...base, modeParam: "Practice" })).toBe(false);
  });

  it("does not enter when the lesson is not yet completed", () => {
    expect(
      shouldAutoEnterPractice({ ...base, lessonStatus: "in_progress" }),
    ).toBe(false);
    expect(
      shouldAutoEnterPractice({ ...base, lessonStatus: "not_started" }),
    ).toBe(false);
    expect(shouldAutoEnterPractice({ ...base, lessonStatus: undefined })).toBe(false);
  });

  it("does not enter when the lesson has no practice exercises", () => {
    expect(
      shouldAutoEnterPractice({ ...base, practiceExerciseCount: 0 }),
    ).toBe(false);
  });
});

describe("selectCompletionRulesForCheck", () => {
  const rule = { type: "stdout_contains", text: "hi" } as unknown as Lesson["completionRules"][number];
  const practiceRule = { type: "function_tests", tests: [] as FunctionTest[] } as unknown as Lesson["completionRules"][number];
  const lesson = {
    completionRules: [rule],
    practiceExercises: [
      { completionRules: [practiceRule] },
      { completionRules: [] },
    ],
  } as unknown as Lesson;

  it("returns lesson rules in lesson mode", () => {
    expect(selectCompletionRulesForCheck(lesson, false, 0)).toEqual([rule]);
  });

  it("returns the selected practice exercise's rules in practice mode", () => {
    expect(selectCompletionRulesForCheck(lesson, true, 0)).toEqual([practiceRule]);
  });

  it("returns an empty array for an out-of-range practice index", () => {
    expect(selectCompletionRulesForCheck(lesson, true, 99)).toEqual([]);
  });

  it("returns an empty array when the lesson is null", () => {
    expect(selectCompletionRulesForCheck(null, false, 0)).toEqual([]);
  });
});

describe("buildAskTutorPrompt", () => {
  it("for a hidden failure, does NOT leak inputs/expected/got", () => {
    const p = buildAskTutorPrompt({
      name: "hidden-case-3",
      hidden: true,
      actualRepr: "[1,2,3]",
      expectedRepr: "[]",
      category: "empty-list",
    });
    expect(p).not.toContain("[1,2,3]");
    expect(p).not.toContain("hidden-case-3");
    expect(p).toContain("(category: empty-list)");
    expect(p).toMatch(/edge case/i);
  });

  it("for a hidden failure without a category, omits the category fragment", () => {
    const p = buildAskTutorPrompt({ name: "x", hidden: true });
    expect(p).not.toContain("category:");
  });

  it("for a visible error, includes the error text and name, truncated at 400 chars", () => {
    const err = "X".repeat(500);
    const p = buildAskTutorPrompt({ name: "example-1", hidden: false, error: err });
    expect(p).toContain('"example-1"');
    expect(p).toContain("X".repeat(400));
    expect(p).not.toContain("X".repeat(401));
  });

  it("for a visible value mismatch, includes expected and actual reprs", () => {
    const p = buildAskTutorPrompt({
      name: "adds",
      hidden: false,
      actualRepr: "3",
      expectedRepr: "5",
    });
    expect(p).toContain("`3`");
    expect(p).toContain("`5`");
    expect(p).toContain('"adds"');
  });

  it("substitutes placeholder text when reprs are missing", () => {
    const p = buildAskTutorPrompt({ name: "adds", hidden: false });
    expect(p).toContain("(no value)");
    expect(p).toContain("(unknown)");
  });
});

describe("countFailsByVisibility", () => {
  it("returns zeros for a null report", () => {
    expect(countFailsByVisibility(null)).toEqual({ visibleFails: 0, hiddenFails: 0 });
  });

  it("counts visible vs hidden failures separately", () => {
    const report: TestReport = {
      cleanStdout: "",
      harnessError: null,
      results: [
        { name: "a", passed: true, hidden: false },
        { name: "b", passed: false, hidden: false },
        { name: "c", passed: false, hidden: true },
        { name: "d", passed: false, hidden: true },
        { name: "e", passed: true, hidden: true },
      ] as TestReport["results"],
    };
    expect(countFailsByVisibility(report)).toEqual({ visibleFails: 1, hiddenFails: 2 });
  });
});
