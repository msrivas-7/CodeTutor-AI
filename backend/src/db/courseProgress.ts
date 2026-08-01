import { z } from "zod";
import { db, withRlsContext } from "./client.js";
import { HttpError } from "../middleware/errorHandler.js";

export interface CourseProgress {
  courseId: string;
  status: "not_started" | "in_progress" | "completed";
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
  lastLessonId: string | null;
  completedLessonIds: string[];
}

// Phase 20-P3 Bucket 3 (#2): parse rows at the DB boundary — a bad migration
// that lands status='done' (instead of 'completed') would have silently broken
// dashboard filters; now it fails fast.
export const CourseRowSchema = z.object({
  course_id: z.string(),
  status: z.enum(["not_started", "in_progress", "completed"]),
  started_at: z.date().nullable(),
  completed_at: z.date().nullable(),
  updated_at: z.date(),
  last_lesson_id: z.string().nullable(),
  completed_lesson_ids: z.array(z.string()).nullable(),
});

function rowToCourse(raw: unknown): CourseProgress {
  const parsed = CourseRowSchema.safeParse(raw);
  if (!parsed.success) {
    throw new HttpError(
      500,
      `corrupt course_progress row: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    );
  }
  const r = parsed.data;
  return {
    courseId: r.course_id,
    status: r.status,
    startedAt: r.started_at ? r.started_at.toISOString() : null,
    completedAt: r.completed_at ? r.completed_at.toISOString() : null,
    updatedAt: r.updated_at.toISOString(),
    lastLessonId: r.last_lesson_id,
    completedLessonIds: r.completed_lesson_ids ?? [],
  };
}

export async function listCourseProgress(userId: string): Promise<CourseProgress[]> {
  // Phase 26: RLS-scoped read.
  const rows = await withRlsContext(userId, async (tx) => {
    return await tx`
      SELECT course_id, status, started_at, completed_at, updated_at,
             last_lesson_id, completed_lesson_ids
        FROM public.course_progress
       WHERE user_id = ${userId}
    `;
  });
  return rows.map(rowToCourse);
}

export interface CoursePatch {
  status?: CourseProgress["status"];
  startedAt?: string | null;
  completedAt?: string | null;
  lastLessonId?: string | null;
  completedLessonIds?: string[];
}

export async function upsertCourseProgress(
  userId: string,
  courseId: string,
  patch: CoursePatch,
): Promise<CourseProgress> {
  // Server-authoritative write; browser roles are read-only and the explicit
  // composite key preserves ownership on the privileged connection.
  const rows = await db()`
      INSERT INTO public.course_progress (
        user_id, course_id, status, started_at, completed_at,
        last_lesson_id, completed_lesson_ids
      )
      VALUES (
        ${userId},
        ${courseId},
        ${patch.status ?? "not_started"},
        ${patch.startedAt ?? null},
        ${patch.completedAt ?? null},
        ${patch.lastLessonId ?? null},
        ${patch.completedLessonIds ?? []}
      )
      ON CONFLICT (user_id, course_id) DO UPDATE SET
        status               = COALESCE(${patch.status ?? null}, public.course_progress.status),
        started_at           = CASE WHEN ${patch.startedAt !== undefined} THEN ${patch.startedAt ?? null}::timestamptz ELSE public.course_progress.started_at END,
        completed_at         = CASE WHEN ${patch.completedAt !== undefined} THEN ${patch.completedAt ?? null}::timestamptz ELSE public.course_progress.completed_at END,
        last_lesson_id       = CASE WHEN ${patch.lastLessonId !== undefined} THEN ${patch.lastLessonId ?? null} ELSE public.course_progress.last_lesson_id END,
        completed_lesson_ids = COALESCE(${patch.completedLessonIds ?? null}, public.course_progress.completed_lesson_ids),
        updated_at           = now()
      RETURNING course_id, status, started_at, completed_at, updated_at,
                last_lesson_id, completed_lesson_ids
    `;
  return rowToCourse(rows[0]);
}

export async function deleteCourseProgress(
  userId: string,
  courseId: string,
): Promise<boolean> {
  const rows = await db()`
      DELETE FROM public.course_progress
       WHERE user_id = ${userId} AND course_id = ${courseId}
       RETURNING course_id
    `;
  return rows.length > 0;
}
