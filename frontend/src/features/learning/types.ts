// ── Course & Lesson content (static, lives in repo files) ──────────

export interface Course {
  id: string;
  title: string;
  description: string;
  language: string;
  lessonOrder: string[];
}

export interface CompletionRule {
  type: "expected_stdout" | "required_file_contains" | "custom_validator";
  expected?: string;
  file?: string;
  pattern?: string;
}

export interface LessonMeta {
  id: string;
  courseId: string;
  title: string;
  description: string;
  order: number;
  language: string;
  estimatedMinutes: number;
  objectives: string[];
  conceptTags: string[];
  completionRules: CompletionRule[];
  prerequisiteLessonIds: string[];
  recap?: string;
  practicePrompts?: string[];
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
  userId?: string;
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
}

// ── Validation ─────────────────────────────────────────────────────

export interface ValidationResult {
  passed: boolean;
  feedback: string[];
  nextHints?: string[];
}

// ── Guided tutor context (sent in AI ask body) ─────────────────────

export interface LessonContext {
  courseId: string;
  lessonId: string;
  lessonTitle: string;
  lessonObjectives: string[];
  conceptTags: string[];
  completionRules: CompletionRule[];
  studentProgressSummary: string;
}
