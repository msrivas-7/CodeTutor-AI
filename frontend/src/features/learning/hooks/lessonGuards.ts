// Phase 20-P3 Bucket 3 (#3): pure branches carved out of useLessonLoader +
// useLessonValidator so they can be tested without a full hook render.
//
// The rest of the hooks coordinate stores + side effects (store writes,
// confetti, navigate, setSearchParams) which only matter when they're
// triggered on the right branch. Unit-testing these guards directly means
// the Playwright suite only has to cover the integration path, not every
// permutation of prereq state × practice state × completion status.

import type { Lesson, TestReport } from "../types";

export function lessonWorkspaceContextKey(
  mode: "anon" | "authed",
  courseId: string | undefined,
  lessonId: string | undefined,
): string | null {
  if (!courseId || !lessonId) return null;
  return `${mode === "anon" ? "anon-lesson" : "lesson"}:${courseId}/${lessonId}`;
}

export function shouldPersistLessonDraft(
  learnerId: string | null,
  projectContext: string | null,
  expectedContext: string,
): boolean {
  return learnerId !== null && projectContext === expectedContext;
}

export interface PrereqGateInput {
  lessonPrerequisiteIds: readonly string[];
  completedLessonIds: readonly string[];
  existingStatus: "not_started" | "in_progress" | "completed";
}

// Mirrors the server's prerequisite guard. Existing progress is data, not an
// authorization credential: a stale/ghost row must never unlock a lesson.
// Progress remains stored server-side while the learner is bounced, so meeting
// the prerequisites later restores the draft without losing their work.
export function shouldBouncePrereq(input: PrereqGateInput): boolean {
  if (input.lessonPrerequisiteIds.length === 0) return false;
  const met = input.lessonPrerequisiteIds.every((id) =>
    input.completedLessonIds.includes(id),
  );
  return !met;
}

export interface AutoPracticeInput {
  hasLesson: boolean;
  modeParam: string | null;
  lessonStatus: "not_started" | "in_progress" | "completed" | undefined;
  practiceExerciseCount: number;
}

// Auto-enter practice mode only when `?mode=practice` AND the lesson is
// completed AND there's at least one practice exercise. Anything else is
// a bad link (or a stale bookmark from an earlier version) and the caller
// clears the query param without entering practice.
export function shouldAutoEnterPractice(input: AutoPracticeInput): boolean {
  if (!input.hasLesson) return false;
  if (input.modeParam !== "practice") return false;
  if (input.lessonStatus !== "completed") return false;
  if (input.practiceExerciseCount <= 0) return false;
  return true;
}

// handleCheck dispatches to practice-exercise rules or lesson-level rules.
// Keeping this as a pure selector makes it obvious what each branch
// actually validates against.
export function selectCompletionRulesForCheck(
  lesson: Pick<Lesson, "completionRules" | "practiceExercises"> | null,
  practiceMode: boolean,
  practiceIndex: number,
): Lesson["completionRules"] {
  if (!lesson) return [];
  if (practiceMode) {
    return lesson.practiceExercises?.[practiceIndex]?.completionRules ?? [];
  }
  return lesson.completionRules;
}

// Extracted from handleAskTutorAboutFailure. The hidden-vs-visible distinction
// is load-bearing: hidden-test failures must NOT leak inputs / expected values
// through the tutor prompt (that's the whole point of a hidden test). Visible
// failures can share call + expected + got so the tutor coaches concretely.
export interface PromptInput {
  name: string;
  hidden: boolean;
  error?: string | null;
  actualRepr?: string | null;
  expectedRepr?: string | null;
  category?: string | null;
}

export function buildAskTutorPrompt(f: PromptInput): string {
  if (f.hidden) {
    return `My function passes the visible examples but Check My Work says a related edge case still fails${
      f.category ? ` (category: ${f.category})` : ""
    }. What kinds of inputs should I test beyond the examples, and how would I trace my code through them?`;
  }
  if (f.error) {
    return `When my function ran on the "${f.name}" example, it raised this error:\n\`\`\`\n${f.error.trim().slice(0, 400)}\n\`\`\`\nCan you help me understand what caused it?`;
  }
  return `The "${f.name}" example returned \`${f.actualRepr ?? "(no value)"}\` but expected \`${f.expectedRepr ?? "(unknown)"}\`. Can you help me see why my code gives the wrong answer here?`;
}

// The validator also derives counters off the latest report. Extract so we
// can test "don't double-count hidden fails when visible fails are present"
// is preserved.
export interface FailBreakdown {
  visibleFails: number;
  hiddenFails: number;
}

export function countFailsByVisibility(report: TestReport | null): FailBreakdown {
  if (!report) return { visibleFails: 0, hiddenFails: 0 };
  let visibleFails = 0;
  let hiddenFails = 0;
  for (const r of report.results) {
    if (r.passed) continue;
    if (r.hidden) hiddenFails++;
    else visibleFails++;
  }
  return { visibleFails, hiddenFails };
}
