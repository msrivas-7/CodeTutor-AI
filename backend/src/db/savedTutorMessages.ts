import type { JSONValue } from "postgres";
import { z } from "zod";
import { withRlsContext } from "./client.js";
import { HttpError } from "../middleware/errorHandler.js";

// Phase 21A: per-user saved tutor messages.
//
// Scope tuple semantics:
//   (null, null, null)            → standalone /editor save
//   (course, lesson, null)        → lesson view (not practice)
//   (course, lesson, exercise)    → specific practice exercise
// CHECK constraint in the schema enforces these combinations.

export interface SavedTutorMessage {
  id: string;
  courseId: string | null;
  lessonId: string | null;
  exerciseId: string | null;
  messageId: string;
  role: "assistant";
  content: string;
  sections: Record<string, unknown> | null;
  model: string | null;
  createdAt: string;
  updatedAt: string;
}

const SavedRowSchema = z.object({
  id: z.string().uuid(),
  course_id: z.string().nullable(),
  lesson_id: z.string().nullable(),
  exercise_id: z.string().nullable(),
  message_id: z.string(),
  role: z.literal("assistant"),
  content: z.string(),
  sections: z.record(z.string(), z.unknown()).nullable(),
  model: z.string().nullable(),
  created_at: z.date(),
  updated_at: z.date(),
});

function rowToSaved(raw: unknown): SavedTutorMessage {
  const parsed = SavedRowSchema.safeParse(raw);
  if (!parsed.success) {
    throw new HttpError(
      500,
      `corrupt saved_tutor_messages row: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    );
  }
  const r = parsed.data;
  return {
    id: r.id,
    courseId: r.course_id,
    lessonId: r.lesson_id,
    exerciseId: r.exercise_id,
    messageId: r.message_id,
    role: r.role,
    content: r.content,
    sections: r.sections,
    model: r.model,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

export interface SavedScope {
  courseId: string | null;
  lessonId: string | null;
  exerciseId: string | null;
}

export async function listSavedTutorMessages(
  userId: string,
  scope: SavedScope,
): Promise<SavedTutorMessage[]> {
  // Phase 26: RLS-scoped read.
  const rows = await withRlsContext(userId, async (tx) => {
    return await tx`
      SELECT id, course_id, lesson_id, exercise_id, message_id, role, content,
             sections, model, created_at, updated_at
        FROM public.saved_tutor_messages
       WHERE user_id = ${userId}
         AND course_id   IS NOT DISTINCT FROM ${scope.courseId}
         AND lesson_id   IS NOT DISTINCT FROM ${scope.lessonId}
         AND exercise_id IS NOT DISTINCT FROM ${scope.exerciseId}
       ORDER BY created_at DESC
    `;
  });
  return rows.map(rowToSaved);
}

// Per-user cap: max 100 saved per (course, lesson) tuple. Editor-scope
// (null/null) shares its own bucket. Returns the count for cap enforcement.
export async function countSavedForLesson(
  userId: string,
  courseId: string | null,
  lessonId: string | null,
): Promise<number> {
  // Phase 26: RLS-scoped count read. Cap enforcement was already correct
  // via WHERE user_id = ${userId} but RLS adds defense-in-depth.
  const rows = await withRlsContext(userId, async (tx) => {
    return await tx<Array<{ c: string }>>`
      SELECT COUNT(*)::text AS c
        FROM public.saved_tutor_messages
       WHERE user_id = ${userId}
         AND course_id IS NOT DISTINCT FROM ${courseId}
         AND lesson_id IS NOT DISTINCT FROM ${lessonId}
    `;
  });
  return Number(rows[0]?.c ?? 0);
}

export interface SaveInput {
  messageId: string;
  scope: SavedScope;
  content: string;
  sections: Record<string, unknown> | null;
  model: string | null;
}

export async function insertSavedTutorMessage(
  userId: string,
  input: SaveInput,
): Promise<SavedTutorMessage> {
  // Phase 26: RLS-scoped INSERT. WITH CHECK enforces user_id binding.
  const rows = await withRlsContext(userId, async (tx) => {
    const sectionsJson =
      input.sections === null ? null : tx.json(input.sections as JSONValue);
    // ON CONFLICT (user_id, message_id) DO UPDATE — re-saving the same
    // message id is a no-op upsert that returns the existing row. Avoids
    // a 409 round-trip from an inadvertent double-click.
    return await tx`
      INSERT INTO public.saved_tutor_messages (
        user_id, course_id, lesson_id, exercise_id, message_id, role,
        content, sections, model
      )
      VALUES (
        ${userId},
        ${input.scope.courseId},
        ${input.scope.lessonId},
        ${input.scope.exerciseId},
        ${input.messageId},
        'assistant',
        ${input.content},
        ${sectionsJson},
        ${input.model}
      )
      ON CONFLICT (user_id, message_id) DO UPDATE
        SET updated_at = now()
      RETURNING id, course_id, lesson_id, exercise_id, message_id, role, content,
                sections, model, created_at, updated_at
    `;
  });
  return rowToSaved(rows[0]);
}

export async function deleteSavedTutorMessage(
  userId: string,
  id: string,
): Promise<boolean> {
  // Phase 26: RLS-scoped DELETE.
  const rows = await withRlsContext(userId, async (tx) => {
    return await tx`
      DELETE FROM public.saved_tutor_messages
       WHERE user_id = ${userId} AND id = ${id}
       RETURNING id
    `;
  });
  return rows.length > 0;
}
