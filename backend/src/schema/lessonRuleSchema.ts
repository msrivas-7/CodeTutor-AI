// Phase 20-P3 Bucket 3 (#1): canonical backend-side Zod schema for lesson
// completion rules + function tests. Previously these were inlined in three
// places (routes/ai.ts, routes/executeTests.ts, services/ai/prompts/lessonContext.ts)
// so a new variant could be added on the frontend and silently dropped on the
// backend. Every backend surface that accepts completion rules now imports
// from here; TS types flow through z.infer so shape drift is a compile error.
//
// Parity with the frontend authoring schema (frontend/src/features/learning/
// content/schema.ts) is by convention, not tooling: the two files cannot
// share a module without repo-wide workspace restructuring. If you add a
// variant here, add the matching variant in the frontend file and vice versa
// — there's a cross-pointer comment on the frontend side for the same reason.
//
// Route-specific size limits (e.g. executeTests.ts capping `call`/`expected`
// at 4000 chars to prevent oversized harness payloads) stay at the route
// boundary — they are not authoring constraints and shouldn't pollute the
// shared shape.

import { z } from "zod";

export const functionTestSchema = z.object({
  name: z.string().min(1),
  call: z.string().min(1),
  expected: z.string().min(1),
  setup: z.string().optional(),
  hidden: z.boolean().optional(),
  category: z.string().optional(),
});

export const completionRuleSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("expected_stdout"),
    expected: z.string(),
  }),
  // Phase 27-v2 Day 3a: paired with expected_stdout to reject the
  // unedited lesson 1 starter (`Hello, YOUR_NAME!` contains the
  // forbidden substring). See parallel comment in
  // frontend/src/features/learning/content/schema.ts.
  z.object({
    type: z.literal("forbidden_in_stdout"),
    pattern: z.string(),
  }),
  z.object({
    type: z.literal("required_file_contains"),
    file: z.string().optional(),
    pattern: z.string(),
  }),
  z.object({
    type: z.literal("function_tests"),
    tests: z.array(functionTestSchema).min(1),
  }),
  z.object({
    type: z.literal("custom_validator"),
  }),
  // Phase A — A1 (funnel-edge pedagogy): learner-driven retrieval check
  // gating completion. See parallel comment in
  // frontend/src/features/learning/content/schema.ts.
  z.object({
    type: z.literal("retrieval_check"),
    question: z.string().min(1),
    choices: z.array(z.string().min(1)).min(2).max(4),
    correctIndex: z.number().int().min(0),
    explanation: z.string().optional(),
  }),
]);

export type FunctionTestSpec = z.infer<typeof functionTestSchema>;
export type CompletionRule = z.infer<typeof completionRuleSchema>;
