import type { JSONValue } from "postgres";
import { z } from "zod";
import { db, withRlsContext } from "./client.js";
import { HttpError } from "../middleware/errorHandler.js";
import { writeConceptTags } from "./conceptLedger.js";
import { getLessonConceptTags } from "../services/share/lessonCatalog.js";

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
  // Phase 26: RLS-scoped read.
  const rows = await withRlsContext(userId, async (tx) => {
    return courseId
      ? await tx`
          SELECT course_id, lesson_id, status, started_at, completed_at,
                 updated_at, attempt_count, run_count, hint_count,
                 time_spent_ms, last_code, last_output, practice_completed_ids,
                 practice_exercise_code
            FROM public.lesson_progress
           WHERE user_id = ${userId} AND course_id = ${courseId}
        `
      : await tx`
          SELECT course_id, lesson_id, status, started_at, completed_at,
                 updated_at, attempt_count, run_count, hint_count,
                 time_spent_ms, last_code, last_output, practice_completed_ids,
                 practice_exercise_code
            FROM public.lesson_progress
           WHERE user_id = ${userId}
        `;
  });
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

// Phase A — A6 (memory v0): track which (userId, courseId, lessonId)
// triples have already had their concept-tag rows written, so a
// repeated completion call (e.g., progressStore.completeLesson firing
// on a lesson the user already completed) doesn't re-issue the catalog
// read + ledger writes. This is a soft cache layered over the DB-level
// idempotency in conceptLedger.writeConceptTags — the DB constraint is
// the ultimate truth, this just saves the round trips.
//
// Bounded because entries are only removed on FAILURE (to allow a
// retry); successful writes would otherwise accumulate one entry per
// (user, lesson) forever and leak on a long-lived process. Since the
// cache is a pure optimization over an idempotent DB write, dropping
// the whole set at the ceiling is safe — worst case a few learners
// re-issue one catalog read.
const CONCEPT_WRITE_CACHE_MAX = 10_000;
const completedConceptWriteCache = new Set<string>();

function rememberConceptWrite(cache: Set<string>, key: string): void {
  if (cache.size >= CONCEPT_WRITE_CACHE_MAX) cache.clear();
  cache.add(key);
}

export async function upsertLessonProgress(
  userId: string,
  courseId: string,
  lessonId: string,
  patch: LessonPatch,
): Promise<LessonProgress> {
  // Phase 26: RLS-scoped UPSERT.
  const rows = await withRlsContext(userId, async (tx) => {
    const lastCodeJson =
      patch.lastCode === undefined
        ? null
        : tx.json((patch.lastCode ?? null) as JSONValue);
    const practiceCodeJson =
      patch.practiceExerciseCode === undefined
        ? null
        : tx.json(patch.practiceExerciseCode as JSONValue);
    return await tx`
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
        ${patch.lastCode === undefined ? null : tx.json((patch.lastCode ?? null) as JSONValue)},
        ${patch.lastOutput ?? null},
        ${patch.practiceCompletedIds ?? []},
        ${patch.practiceExerciseCode === undefined ? tx.json({} as JSONValue) : tx.json(patch.practiceExerciseCode as JSONValue)}
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
  });
  const result = rowToLesson(rows[0]);

  // Phase A — A6: write concept-tag rows on the completion transition and on
  // practice progress. Await the bounded idempotent write before returning so
  // a successful HTTP response cannot race process shutdown. Ledger failure
  // still fails open for progress, is logged, and clears the cache for retry.
  const cacheKey = `${userId}/${courseId}/${lessonId}`;
  if (result.status === "completed" && !completedConceptWriteCache.has(cacheKey)) {
    rememberConceptWrite(completedConceptWriteCache, cacheKey);
    await writeConceptTagsForCompletion(userId, courseId, lessonId, "lesson").catch((err) => {
      completedConceptWriteCache.delete(cacheKey);
      console.error(
        JSON.stringify({
          level: "error",
          evt: "concept_ledger_write_failed",
          phase: "lesson",
          userId,
          courseId,
          lessonId,
          msg: err instanceof Error ? err.message : String(err),
        }),
      );
    });
  }
  // Practice-exercise hook: when the patch carries practiceCompletedIds
  // (any value, even an empty array — the route only sends this field
  // when the user just completed an exercise), write `practiced` rows
  // for the lesson's concept tags. The DB UNIQUE index collapses
  // repeats to no-ops, so writing on every practice patch is cheap.
  if (
    patch.practiceCompletedIds !== undefined &&
    !practiceConceptWriteCache.has(cacheKey)
  ) {
    rememberConceptWrite(practiceConceptWriteCache, cacheKey);
    await writeConceptTagsForCompletion(userId, courseId, lessonId, "practice").catch((err) => {
      practiceConceptWriteCache.delete(cacheKey);
      console.error(
        JSON.stringify({
          level: "error",
          evt: "concept_ledger_write_failed",
          phase: "practice",
          userId,
          courseId,
          lessonId,
          msg: err instanceof Error ? err.message : String(err),
        }),
      );
    });
  }

  return result;
}

// Phase A — A6: a separate cache for the practice-exercise write so a
// learner who finishes a practice exercise BEFORE the main lesson check
// (or vice-versa) gets both rows written without one suppressing the
// other.
const practiceConceptWriteCache = new Set<string>();

// Helper kept private to this module: read the lesson's concept tags
// from the catalog, then write them via the ledger. Catalog miss
// (lesson removed from the catalog mid-flight) → no-op write, since
// the ledger is honest about lessons that exist in lesson_progress
// but not in the catalog (a soft inconsistency Phase B's read side
// can tolerate by ignoring orphan tags).
//
// `phase` selects which event types to write: "lesson" → taught + used
// (one row per tag in each), "practice" → practiced (re-uses the same
// taught+used tags as the practice surface for the lesson).
async function writeConceptTagsForCompletion(
  userId: string,
  courseId: string,
  lessonId: string,
  phase: "lesson" | "practice",
): Promise<void> {
  const tags = await getLessonConceptTags(courseId, lessonId);
  if (!tags) return;
  if (tags.taught.length === 0 && tags.used.length === 0) return;
  if (phase === "lesson") {
    await writeConceptTags({
      userId,
      courseId,
      lessonId,
      taught: tags.taught,
      used: tags.used,
    });
  } else {
    // Practice rows reuse the lesson's concept set — Phase B reads
    // them as "did the learner reinforce this concept after the
    // initial lesson" rather than "which exercise was practiced."
    await writeConceptTags({
      userId,
      courseId,
      lessonId,
      practiced: [...tags.taught, ...tags.used],
    });
  }
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
  // One row per unique (courseId, lessonId) — the frontend de-dupes before
  // posting, but we still fold-and-sum here so we're robust to a future
  // caller that doesn't.
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
  // Phase 26: RLS-scoped batch UPSERT. The withRlsContext transaction
  // gives us atomic semantics across all bumps (partial failure rolls
  // back everything) AND RLS WITH CHECK enforces user_id binding on
  // every insert.
  let written = 0;
  await withRlsContext(userId, async (tx) => {
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
  // Phase 26: RLS-scoped DELETE.
  const rows = await withRlsContext(userId, async (tx) => {
    return lessonId
      ? await tx`
          DELETE FROM public.lesson_progress
           WHERE user_id = ${userId}
             AND course_id = ${courseId}
             AND lesson_id = ${lessonId}
           RETURNING lesson_id
        `
      : await tx`
          DELETE FROM public.lesson_progress
           WHERE user_id = ${userId} AND course_id = ${courseId}
           RETURNING lesson_id
        `;
  });
  return rows.length;
}
