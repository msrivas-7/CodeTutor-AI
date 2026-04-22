import type { JSONValue } from "postgres";
import { z } from "zod";
import { db } from "./client.js";
import { HttpError } from "../middleware/errorHandler.js";

export interface LessonProgress {
  courseId: string;
  lessonId: string;
  status: "not_started" | "in_progress" | "completed";
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
  attemptCount: number;
  runCount: number;
  hintCount: number;
  timeSpentMs: number;
  lastCode: Record<string, unknown> | null;
  lastOutput: string | null;
  practiceCompletedIds: string[];
  // Per-exercise WIP code snapshots. Keyed by exerciseId → file-path map.
  // Distinct from `lastCode` so entering/leaving practice mode doesn't
  // clobber the main lesson buffer.
  practiceExerciseCode: Record<string, Record<string, string>>;
}

// Phase 20-P3 Bucket 3 (#2): parse rows at the DB boundary — catches stray
// statuses or non-numeric counts from a bad migration before they flow into
// progress bars + auto-save math.
export const LessonRowSchema = z.object({
  course_id: z.string(),
  lesson_id: z.string(),
  status: z.enum(["not_started", "in_progress", "completed"]),
  started_at: z.date().nullable(),
  completed_at: z.date().nullable(),
  updated_at: z.date(),
  attempt_count: z.union([z.number(), z.string()]),
  run_count: z.union([z.number(), z.string()]),
  hint_count: z.union([z.number(), z.string()]),
  time_spent_ms: z.union([z.number(), z.string()]),
  last_code: z.record(z.string(), z.unknown()).nullable(),
  last_output: z.string().nullable(),
  practice_completed_ids: z.array(z.string()).nullable(),
  practice_exercise_code: z.record(z.string(), z.record(z.string(), z.string())).nullable(),
});

function rowToLesson(raw: unknown): LessonProgress {
  const parsed = LessonRowSchema.safeParse(raw);
  if (!parsed.success) {
    throw new HttpError(
      500,
      `corrupt lesson_progress row: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    );
  }
  const r = parsed.data;
  return {
    courseId: r.course_id,
    lessonId: r.lesson_id,
    status: r.status,
    startedAt: r.started_at ? r.started_at.toISOString() : null,
    completedAt: r.completed_at ? r.completed_at.toISOString() : null,
    updatedAt: r.updated_at.toISOString(),
    attemptCount: Number(r.attempt_count),
    runCount: Number(r.run_count),
    hintCount: Number(r.hint_count),
    timeSpentMs: Number(r.time_spent_ms),
    lastCode: r.last_code,
    lastOutput: r.last_output,
    practiceCompletedIds: r.practice_completed_ids ?? [],
    practiceExerciseCode: r.practice_exercise_code ?? {},
  };
}

export async function listLessonProgress(
  userId: string,
  courseId?: string,
): Promise<LessonProgress[]> {
  const sql = db();
  const rows = courseId
    ? await sql`
        SELECT course_id, lesson_id, status, started_at, completed_at,
               updated_at, attempt_count, run_count, hint_count,
               time_spent_ms, last_code, last_output, practice_completed_ids,
               practice_exercise_code
          FROM public.lesson_progress
         WHERE user_id = ${userId} AND course_id = ${courseId}
      `
    : await sql`
        SELECT course_id, lesson_id, status, started_at, completed_at,
               updated_at, attempt_count, run_count, hint_count,
               time_spent_ms, last_code, last_output, practice_completed_ids,
               practice_exercise_code
          FROM public.lesson_progress
         WHERE user_id = ${userId}
      `;
  return rows.map(rowToLesson);
}

export interface LessonPatch {
  status?: LessonProgress["status"];
  startedAt?: string | null;
  completedAt?: string | null;
  attemptCount?: number;
  runCount?: number;
  hintCount?: number;
  timeSpentMs?: number;
  lastCode?: Record<string, unknown> | null;
  lastOutput?: string | null;
  practiceCompletedIds?: string[];
  practiceExerciseCode?: Record<string, Record<string, string>>;
}

export async function upsertLessonProgress(
  userId: string,
  courseId: string,
  lessonId: string,
  patch: LessonPatch,
): Promise<LessonProgress> {
  const sql = db();
  const lastCodeJson =
    patch.lastCode === undefined
      ? null
      : sql.json((patch.lastCode ?? null) as JSONValue);
  const practiceCodeJson =
    patch.practiceExerciseCode === undefined
      ? null
      : sql.json(patch.practiceExerciseCode as JSONValue);
  const rows = await sql`
    INSERT INTO public.lesson_progress (
      user_id, course_id, lesson_id, status, started_at, completed_at,
      attempt_count, run_count, hint_count, time_spent_ms,
      last_code, last_output, practice_completed_ids, practice_exercise_code
    )
    VALUES (
      ${userId},
      ${courseId},
      ${lessonId},
      ${patch.status ?? "not_started"},
      ${patch.startedAt ?? null},
      ${patch.completedAt ?? null},
      ${patch.attemptCount ?? 0},
      ${patch.runCount ?? 0},
      ${patch.hintCount ?? 0},
      ${patch.timeSpentMs ?? 0},
      ${patch.lastCode === undefined ? null : sql.json((patch.lastCode ?? null) as JSONValue)},
      ${patch.lastOutput ?? null},
      ${patch.practiceCompletedIds ?? []},
      ${patch.practiceExerciseCode === undefined ? sql.json({} as JSONValue) : sql.json(patch.practiceExerciseCode as JSONValue)}
    )
    ON CONFLICT (user_id, course_id, lesson_id) DO UPDATE SET
      status                 = COALESCE(${patch.status ?? null}, public.lesson_progress.status),
      started_at             = CASE WHEN ${patch.startedAt !== undefined} THEN ${patch.startedAt ?? null}::timestamptz ELSE public.lesson_progress.started_at END,
      completed_at           = CASE WHEN ${patch.completedAt !== undefined} THEN ${patch.completedAt ?? null}::timestamptz ELSE public.lesson_progress.completed_at END,
      attempt_count          = COALESCE(${patch.attemptCount ?? null}, public.lesson_progress.attempt_count),
      run_count              = COALESCE(${patch.runCount ?? null}, public.lesson_progress.run_count),
      hint_count             = COALESCE(${patch.hintCount ?? null}, public.lesson_progress.hint_count),
      time_spent_ms          = COALESCE(${patch.timeSpentMs ?? null}, public.lesson_progress.time_spent_ms),
      last_code              = CASE WHEN ${patch.lastCode !== undefined} THEN ${lastCodeJson} ELSE public.lesson_progress.last_code END,
      last_output            = CASE WHEN ${patch.lastOutput !== undefined} THEN ${patch.lastOutput ?? null} ELSE public.lesson_progress.last_output END,
      practice_completed_ids = COALESCE(${patch.practiceCompletedIds ?? null}, public.lesson_progress.practice_completed_ids),
      practice_exercise_code = CASE WHEN ${patch.practiceExerciseCode !== undefined} THEN ${practiceCodeJson} ELSE public.lesson_progress.practice_exercise_code END,
      updated_at             = now()
    RETURNING course_id, lesson_id, status, started_at, completed_at,
              updated_at, attempt_count, run_count, hint_count,
              time_spent_ms, last_code, last_output, practice_completed_ids,
              practice_exercise_code
  `;
  return rowToLesson(rows[0]);
}

/**
 * P-H4 (adversarial audit, bucket 4b): batch-additive heartbeat write. The
 * frontend accumulates per-lesson ticks in memory and POSTs them on a slow
 * cadence (periodic 60s + pagehide/visibilitychange via sendBeacon). Unlike
 * upsertLessonProgress's COALESCE "set" semantics, this path increments —
 * so two tabs flushing their own deltas within the same second both count.
 *
 * Items with deltaMs<=0 are silently dropped. Lessons with no existing row
 * are inserted with time_spent_ms seeded from the delta (this mirrors what
 * upsertLessonProgress does on first touch).
 *
 * Returns the count of rows actually written so the route can surface a
 * 204 vs 202 on empty batches without an extra round-trip.
 */
export interface LessonHeartbeatItem {
  courseId: string;
  lessonId: string;
  deltaMs: number;
}

export async function addLessonTimes(
  userId: string,
  items: LessonHeartbeatItem[],
): Promise<number> {
  if (items.length === 0) return 0;
  const sql = db();
  // One row per unique (courseId, lessonId) — the frontend de-dupes before
  // posting, but we still fold-and-sum here so we're robust to a future
  // caller that doesn't. One transaction so a partial failure rolls back
  // all bumps; per-row COALESCE handles "first visit + heartbeat" where
  // no lesson_progress row exists yet (we seed status='in_progress').
  const merged = new Map<string, LessonHeartbeatItem>();
  for (const it of items) {
    if (!(it.deltaMs > 0)) continue;
    const key = `${it.courseId}/${it.lessonId}`;
    const prev = merged.get(key);
    merged.set(key, {
      courseId: it.courseId,
      lessonId: it.lessonId,
      deltaMs: (prev?.deltaMs ?? 0) + it.deltaMs,
    });
  }
  if (merged.size === 0) return 0;
  let written = 0;
  await sql.begin(async (tx) => {
    for (const it of merged.values()) {
      await tx`
        INSERT INTO public.lesson_progress (
          user_id, course_id, lesson_id, status, time_spent_ms
        )
        VALUES (
          ${userId}, ${it.courseId}, ${it.lessonId}, 'in_progress', ${it.deltaMs}
        )
        ON CONFLICT (user_id, course_id, lesson_id) DO UPDATE
          SET time_spent_ms = public.lesson_progress.time_spent_ms + ${it.deltaMs},
              updated_at    = now()
      `;
      written += 1;
    }
  });
  return written;
}

/**
 * QA-M4: reap lesson_progress rows that look like abandoned drive-bys — a
 * `startLesson` call fired the insert when the learner hit the URL, but no
 * engagement signal (run, hint, time spent, saved code) followed. If the
 * row is still "in_progress" after 24h with all bookkeeping at zero we
 * treat it as a ghost and delete it. Leaving it in place is not just clutter
 * — it silently self-unlocks prereq-locked lessons because `existingStatus`
 * in the prereq guard reads as "in_progress", so the learner's next visit
 * bypasses the bounce. Hourly sweeper run; bounded blast radius because
 * the WHERE clause is conservative — any evidence of engagement keeps the
 * row.
 */
export async function reapAbandonedLessonProgress(): Promise<number> {
  const sql = db();
  const rows = await sql`
    DELETE FROM public.lesson_progress
     WHERE status = 'in_progress'
       AND run_count = 0
       AND hint_count = 0
       AND attempt_count <= 1
       AND time_spent_ms = 0
       AND (last_code IS NULL OR last_code::text = 'null')
       AND updated_at < now() - interval '24 hours'
     RETURNING lesson_id
  `;
  return rows.length;
}

export async function deleteLessonProgress(
  userId: string,
  courseId: string,
  lessonId?: string,
): Promise<number> {
  const sql = db();
  const rows = lessonId
    ? await sql`
        DELETE FROM public.lesson_progress
         WHERE user_id = ${userId}
           AND course_id = ${courseId}
           AND lesson_id = ${lessonId}
         RETURNING lesson_id
      `
    : await sql`
        DELETE FROM public.lesson_progress
         WHERE user_id = ${userId} AND course_id = ${courseId}
         RETURNING lesson_id
      `;
  return rows.length;
}
