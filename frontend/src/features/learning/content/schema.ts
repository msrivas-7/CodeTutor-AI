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

// Lesson 1's `expected_stdout: "Hello, "` substring rule is lenient
// by design (any output starting with "Hello, " counts). The paired
// `forbidden_in_stdout` rule lets the lesson reject "lazy-pass" outputs
// — Phase A — A1 sets it to "Hello, World!" so a learner who just
// types the literal example shown in the starter comment doesn't clear
// the funnel. Other lessons can use this rule to forbid placeholder
// sentinels (`YOUR_NAME`-style), copy-pasted starter shells, or any
// output that signals zero learner-driven editing.
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

// Phase A — A1 (funnel-edge pedagogy): a learner-driven retrieval check
// that fires AFTER the other completion rules pass but BEFORE the
// celebration panel mounts. Not auto-evaluated against stdout — the
// learner picks an answer, the validator gates `showComplete` on
// the correct choice. Without this, a learner can paste their way past
// `expected_stdout` and the funnel measures clicks, not learning.
//
// The rule is OPTIONAL on every lesson (existing lessons without it
// behave exactly as before — the rule's absence is "no gate"). Lesson 1
// of python-fundamentals adds one in Wave 1; other lessons can adopt
// the pattern as authored.
export const retrievalCheckRuleSchema = z
  .object({
    type: z.literal("retrieval_check"),
    question: nonEmptyString,
    // 2–4 multiple-choice answers. Single-choice; one is correct.
    choices: z.array(nonEmptyString).min(2).max(4),
    // 0-indexed position of the correct choice within `choices`.
    correctIndex: z.number().int().min(0),
    // Optional explanation shown after a wrong answer. Omitted = no
    // explanation, just "try again."
    explanation: z.string().optional(),
  })
  // Cross-field invariant: correctIndex must reference a real choice.
  // Without this, a lesson author shipping `correctIndex: 5` with 3
  // choices passes Zod parse but creates an unsatisfiable lesson —
  // the panel can never resolve "you got it right" because none of
  // the rendered buttons map to that index.
  .refine((rule) => rule.correctIndex < rule.choices.length, {
    message: "correctIndex must reference an existing choice (0..choices.length-1)",
    path: ["correctIndex"],
  });

export const completionRuleSchema = z.discriminatedUnion("type", [
  expectedStdoutRuleSchema,
  forbiddenInStdoutRuleSchema,
  requiredFileContainsRuleSchema,
  functionTestsRuleSchema,
  customValidatorRuleSchema,
  retrievalCheckRuleSchema,
]);

export const practiceExerciseSchema = z
  .object({
    id: kebabOrSnake,
    title: nonEmptyString,
    prompt: nonEmptyString,
    goal: nonEmptyString,
    starterCode: z.string().optional(),
    completionRules: z.array(completionRuleSchema).min(1),
    hints: z.array(z.string()).optional(),
  })
  // Phase A — A1: practice-exercise validation runs through the
  // shared `validateLesson` path but the LessonPage's retrieval
  // panel is keyed to the lesson, not the exercise. Allowing a
  // retrieval_check rule on a practice exercise would create an
  // unsatisfiable lesson at runtime (rule fires, no UI surfaces to
  // answer it). Reject it at parse time so a future lesson author
  // can't ship a soft-locked practice by accident.
  .refine(
    (ex) => !ex.completionRules.some((r) => r.type === "retrieval_check"),
    {
      message:
        "retrieval_check is not supported inside practiceExercises (no panel renders for the exercise scope)",
      path: ["completionRules"],
    },
  );

export const assistanceMoveSchema = z.object({
  id: kebabOrSnake,
  trigger: z.object({
    type: z.literal("repeated_error"),
    errorCode: z.literal("python-unclosed-parenthesis"),
    // V0 deliberately supports one reviewed threshold. Making this an
    // arbitrary author-controlled number would silently change the product's
    // intervention policy from content.
    minAttempts: z.literal(2),
  }),
  learningMove: z.literal("observe"),
  conceptTags: z.array(nonEmptyString).min(1),
  question: nonEmptyString,
  maxScaffoldLevel: z.literal(1),
  productiveResponse: nonEmptyString,
  endsWhen: z.literal("evidence_changes"),
});

export const assistanceMovesSchema = z.object({
  version: z.literal(1),
  moves: z.array(assistanceMoveSchema).min(1),
});

export const lessonMetaSchema = z.object({
  id: kebabOrSnake,
  courseId: courseId,
  title: nonEmptyString,
  description: nonEmptyString,
  order: z.number().int().positive(),
  language: languageEnum,
  // Multi-file lessons declare their starter files in metadata so the browser
  // never has to probe a normally-missing _index.json (a 404 in production).
  // Content lint keeps this list identical to starter/_index.json, which is
  // still consumed by authoring and golden-solution tooling.
  starterFilePaths: z
    .array(
      z
        .string()
        .min(1)
        .regex(
          /^[a-z0-9][a-z0-9._-]*$/i,
          "must be a safe starter filename without path separators",
        ),
    )
    .min(1)
    .optional(),
  estimatedMinutes: z.number().int().positive(),
  objectives: z.array(z.string()).min(1),
  teachesConceptTags: z.array(z.string()).default([]),
  usesConceptTags: z.array(z.string()).default([]),
  completionRules: z.array(completionRuleSchema).min(1),
  prerequisiteLessonIds: z.array(kebabOrSnake),
  recap: z.string().optional(),
  practicePrompts: z.array(z.string()).optional(),
  practiceExercises: z.array(practiceExerciseSchema).optional(),
  assistanceMoves: assistanceMovesSchema.optional(),
  // Phase A — A7 (founder identity): the "post-credits" beat shown on
  // LessonCompletePanel. Soft, optional, lesson-author-controlled.
  // Phrasing convention: "In the next lesson, you'll …" — NEVER
  // "Tomorrow you'll…" (lets the user decide cadence). Falls back to
  // the next lesson's first objective if unset; renders nothing on the
  // last lesson of a course.
  nextLessonHint: z.string().optional(),
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
export type AssistanceMoveSchemaInferred = z.infer<typeof assistanceMoveSchema>;
export type AssistanceMovesSchemaInferred = z.infer<typeof assistanceMovesSchema>;
