import type { Language } from "../../types";

// ── Course & Lesson content (static, lives in repo files) ──────────

export interface Course {
  id: string;
  title: string;
  description: string;
  language: Language;
  lessonOrder: string[];
  baseVocabulary?: string[];
  // When true, this course is kept out of the learner-facing dashboard. Used
  // for architecture-validation courses that aren't ready (or intended) to
  // ship. ContentHealthPage still lists them.
  internal?: boolean;
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
  type: "expected_stdout" | "required_file_contains" | "custom_validator" | "function_tests";
  expected?: string;
  file?: string;
  pattern?: string;
  tests?: FunctionTest[];
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
}

export interface Lesson extends LessonMeta {
  content: string;
  starterFiles: { path: string; content: string }[];
}

// ── Learner identity ───────────────────────────────────────────────

export interface LearnerIdentity {
  learnerId: string;
  createdAt: string;
  isAnonymous: boolean;
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
  timeSpentMs?: number;
}

// ── Validation ─────────────────────────────────────────────────────

export interface ValidationResult {
  passed: boolean;
  feedback: string[];
  nextHints?: string[];
}

