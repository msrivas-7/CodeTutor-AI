import type { Language } from "../../types";

// ── Course & Lesson content (static, lives in repo files) ──────────

export interface Course {
  id: string;
  title: string;
  description: string;
  language: Language;
  lessonOrder: string[];
  baseVocabulary?: string[];
  // Phase 22F2A — B5: inherit vocab from parent courses (transitive). Lets
  // python-intermediate omit the ~50 fundamentals concept tags.
  inheritsBaseVocabularyFrom?: string[];
  // Phase 22F2A — B6: course-level prerequisites. Soft-warns the learner
  // (no hard lock) when they click a course whose prereqs aren't fully
  // completed. content-lint validates references; LearningDashboardPage
  // surfaces the warning modal.
  prerequisiteCourseIds?: string[];
  // When true, this course is kept out of the learner-facing dashboard. Used
  // for architecture-validation courses that aren't ready (or intended) to
  // ship. ContentHealthPage still lists them.
  internal?: boolean;
  // QA-M1: dashboard ordering — lower wins; missing values sort last.
  displayOrder?: number;
}

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

export interface CompletionRule {
  type:
    | "expected_stdout"
    | "forbidden_in_stdout"
    | "required_file_contains"
    | "custom_validator"
    | "function_tests"
    | "retrieval_check";
  expected?: string;
  file?: string;
  pattern?: string;
  tests?: FunctionTest[];
  // Phase A — A1: retrieval_check variant fields. Optional on the
  // interface because they only appear when type === "retrieval_check".
  question?: string;
  choices?: string[];
  correctIndex?: number;
  explanation?: string;
}

export interface PracticeExercise {
  id: string;
  title: string;
  prompt: string;
  goal: string;
  starterCode?: string;
  completionRules: CompletionRule[];
  hints?: string[];
}

export interface LessonMeta {
  id: string;
  courseId: string;
  title: string;
  description: string;
  order: number;
  language: Language;
  estimatedMinutes: number;
  objectives: string[];
  teachesConceptTags: string[];
  usesConceptTags: string[];
  completionRules: CompletionRule[];
  prerequisiteLessonIds: string[];
  recap?: string;
  practicePrompts?: string[];
  practiceExercises?: PracticeExercise[];
  // Phase A — A7: optional "post-credits" beat shown on
  // LessonCompletePanel. Convention: "In the next lesson, you'll …"
  // Falls back to next lesson's first objective if unset.
  nextLessonHint?: string;
}

export interface Lesson extends LessonMeta {
  content: string;
  starterFiles: { path: string; content: string }[];
}

// ── Progress tracking ──────────────────────────────────────────────

export type ProgressStatus = "not_started" | "in_progress" | "completed";

export interface CourseProgress {
  learnerId: string;
  courseId: string;
  status: ProgressStatus;
  startedAt: string | null;
  updatedAt: string;
  completedAt: string | null;
  lastLessonId: string | null;
  completedLessonIds: string[];
}

export interface LessonProgress {
  learnerId: string;
  courseId: string;
  lessonId: string;
  status: ProgressStatus;
  startedAt: string | null;
  updatedAt: string;
  completedAt: string | null;
  attemptCount: number;
  runCount: number;
  hintCount: number;
  lastCode: Record<string, string> | null;
  lastOutput: string | null;
  practiceCompletedIds?: string[];
  // Keyed by exerciseId → file-path → content. Distinct from `lastCode`
  // so the main lesson buffer isn't clobbered on practice entry.
  practiceExerciseCode?: Record<string, Record<string, string>>;
  timeSpentMs?: number;
}

// ── Validation ─────────────────────────────────────────────────────

export interface ValidationResult {
  passed: boolean;
  feedback: string[];
  nextHints?: string[];
}

