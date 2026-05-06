import { z } from "zod";
import { LANGUAGES, type Language } from "../../../types";

const nonEmptyString = z.string().min(1);
const languageEnum = z.enum(LANGUAGES as [Language, ...Language[]]);
const kebabOrSnake = z
  .string()
  .min(1)
  .regex(/^[a-z0-9][a-z0-9_-]*$/i, "must be a simple identifier (letters, digits, -, _)");
// Course ids additionally permit a single leading underscore, which is the
// folder-naming convention for internal (non-shipping) courses like
// `_internal-js-smoke`.
const courseId = z
  .string()
  .min(1)
  .regex(/^_?[a-z0-9][a-z0-9_-]*$/i, "must be a simple identifier (letters, digits, -, _), optionally prefixed with `_`");

// Phase 20-P3 Bucket 3 (#1): the shapes below are mirrored by
// backend/src/schema/lessonRuleSchema.ts. If you add a variant here (new
// completionRule type, new functionTest field), add the matching variant on
// the backend side or it will be silently dropped at the API boundary.
export const functionTestSchema = z.object({
  name: nonEmptyString,
  call: nonEmptyString,
  expected: nonEmptyString,
  setup: z.string().optional(),
  hidden: z.boolean().optional(),
  category: z.string().optional(),
});

export const expectedStdoutRuleSchema = z.object({
  type: z.literal("expected_stdout"),
  expected: nonEmptyString,
});

// Phase 27-v2 Day 3a: lesson 1's `expected_stdout: "Hello, "` substring
// rule passes the unedited starter (`name = "YOUR_NAME"` → stdout
// `Hello, YOUR_NAME!` → contains "Hello, "). Adding a paired
// `forbidden_in_stdout` rule lets the lesson reject any output that
// still contains the placeholder, without changing the existing
// permissive substring shape (which other lessons may rely on).
// The pair (expected_stdout: "Hello, " + forbidden_in_stdout:
// "YOUR_NAME") is what tightens lesson 1 specifically — every other
// lesson gets the new variant available but doesn't need to use it.
export const forbiddenInStdoutRuleSchema = z.object({
  type: z.literal("forbidden_in_stdout"),
  pattern: nonEmptyString,
});

export const requiredFileContainsRuleSchema = z.object({
  type: z.literal("required_file_contains"),
  file: z.string().optional(),
  pattern: nonEmptyString,
});

export const functionTestsRuleSchema = z.object({
  type: z.literal("function_tests"),
  tests: z.array(functionTestSchema).min(1),
});

export const customValidatorRuleSchema = z.object({
  type: z.literal("custom_validator"),
});

export const completionRuleSchema = z.discriminatedUnion("type", [
  expectedStdoutRuleSchema,
  forbiddenInStdoutRuleSchema,
  requiredFileContainsRuleSchema,
  functionTestsRuleSchema,
  customValidatorRuleSchema,
]);

export const practiceExerciseSchema = z.object({
  id: kebabOrSnake,
  title: nonEmptyString,
  prompt: nonEmptyString,
  goal: nonEmptyString,
  starterCode: z.string().optional(),
  completionRules: z.array(completionRuleSchema).min(1),
  hints: z.array(z.string()).optional(),
});

export const lessonMetaSchema = z.object({
  id: kebabOrSnake,
  courseId: courseId,
  title: nonEmptyString,
  description: nonEmptyString,
  order: z.number().int().positive(),
  language: languageEnum,
  estimatedMinutes: z.number().int().positive(),
  objectives: z.array(z.string()).min(1),
  teachesConceptTags: z.array(z.string()).default([]),
  usesConceptTags: z.array(z.string()).default([]),
  completionRules: z.array(completionRuleSchema).min(1),
  prerequisiteLessonIds: z.array(kebabOrSnake),
  recap: z.string().optional(),
  practicePrompts: z.array(z.string()).optional(),
  practiceExercises: z.array(practiceExerciseSchema).optional(),
});

export const courseSchema = z.object({
  id: courseId,
  title: nonEmptyString,
  description: nonEmptyString,
  language: languageEnum,
  lessonOrder: z.array(kebabOrSnake).min(1),
  baseVocabulary: z.array(z.string()).default([]),
  // Phase 22F2A — B5: inherit `baseVocabulary` from one or more parent
  // courses so `python-intermediate` doesn't have to redeclare every
  // ~50 concept tag from `python-fundamentals` (which would silently drift).
  // Resolution is transitive (parent of parent) and cycle-checked at lint
  // time. Order is preserved during merge but duplicates are coalesced.
  inheritsBaseVocabularyFrom: z.array(courseId).optional(),
  // Phase 22F2A — B6: course-level prerequisites. Soft-warns the learner
  // (no hard lock) when they click a course whose prereq courses aren't
  // fully completed. content-lint validates that referenced course ids
  // exist + don't form a cycle. Frontend surfaces a confirm modal in
  // LearningDashboardPage; runtime gating is intentionally absent.
  prerequisiteCourseIds: z.array(courseId).optional(),
  // Internal courses exist to validate architecture (e.g. the Phase 10 JS
  // smoke-test course) without showing up on the learner dashboard. Dev-only
  // surfaces like ContentHealthPage still list them.
  internal: z.boolean().optional(),
  // QA-M1: since the registry is now derived from the folder layout (see
  // `courseRegistryPlugin`), folder names alphabetize in unpredictable ways
  // (a course named `_internal-...` sorts before a learner-facing course).
  // `displayOrder` lets each course pin its position; missing values sort
  // last in stable fashion after the ordered ones.
  displayOrder: z.number().optional(),
});

export type CourseSchemaInferred = z.infer<typeof courseSchema>;
export type LessonMetaSchemaInferred = z.infer<typeof lessonMetaSchema>;
export type PracticeExerciseSchemaInferred = z.infer<typeof practiceExerciseSchema>;
export type CompletionRuleSchemaInferred = z.infer<typeof completionRuleSchema>;
export type FunctionTestSchemaInferred = z.infer<typeof functionTestSchema>;
