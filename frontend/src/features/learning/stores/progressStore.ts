import { create } from "zustand";
import type { CourseProgress, LessonProgress } from "../types";
import {
  api,
  type ServerCoursePatch,
  type ServerCourseProgress,
  type ServerLessonPatch,
  type ServerLessonProgress,
} from "../../../api/client";
import { currentGen } from "../../../auth/generation";

// Phase 18b: per-user progress lives in Postgres (tables course_progress +
// lesson_progress). Read model: a single `hydrate()` on sign-in populates the
// in-memory maps; every UI read stays synchronous against that snapshot so
// components don't need to await. Write model: optimistic in-memory mutation
// + fire-and-forget PATCH. Writes are idempotent upserts on the server, so a
// late retry after a transient network failure re-converges safely; we log
// on failure but don't roll back because progress is additive — the next
// page-load hydrate will reconcile.
//
// The signatures match the pre-18b localStorage implementation intentionally
// so that no UI call site had to change. Anything that used to pass a
// `learnerId` still does; we ignore it on server writes because the server
// binds rows to the JWT's `sub` claim.

function now(): string {
  return new Date().toISOString();
}

function compositeKey(courseId: string, lessonId: string): string {
  return `${courseId}/${lessonId}`;
}

function serverCourseToState(row: ServerCourseProgress, learnerId: string): CourseProgress {
  return {
    learnerId,
    courseId: row.courseId,
    status: row.status,
    startedAt: row.startedAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt,
    lastLessonId: row.lastLessonId,
    completedLessonIds: row.completedLessonIds,
  };
}

function serverLessonToState(row: ServerLessonProgress, learnerId: string): LessonProgress {
  return {
    learnerId,
    courseId: row.courseId,
    lessonId: row.lessonId,
    status: row.status,
    startedAt: row.startedAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt,
    attemptCount: row.attemptCount,
    runCount: row.runCount,
    hintCount: row.hintCount,
    lastCode: row.lastCode,
    lastOutput: row.lastOutput,
    practiceCompletedIds: row.practiceCompletedIds,
    practiceExerciseCode: row.practiceExerciseCode,
    timeSpentMs: row.timeSpentMs,
  };
}

// Fire-and-forget helper for background writes. Promise rejection is logged
// but not surfaced: the UI already reflects the optimistic update, and the
// next hydrate() will reconcile the disk truth.
function fireAndForget(label: string, p: Promise<unknown>): void {
  p.catch((err) => console.error(`[progress] ${label}:`, (err as Error).message));
}

/** Session-scoped dedup — same rule as the pre-18b implementation:
 *  a lesson only gets its attemptCount bumped once per browser session.
 *  Cleared on sign-out via `clearSessionStarts`. */
const startedThisSession = new Set<string>();
export function clearSessionStarts(): void {
  startedThisSession.clear();
}

interface ProgressState {
  hydrated: boolean;
  hydrateError: string | null;
  courseProgress: Record<string, CourseProgress>;
  lessonProgress: Record<string, LessonProgress>;

  hydrate: (gen?: number) => Promise<void>;
  reset: () => void;

  loadCourseProgress: (learnerId: string, courseId: string) => CourseProgress;
  loadLessonProgress: (
    learnerId: string,
    courseId: string,
    lessonId: string,
  ) => LessonProgress;

  startLesson: (learnerId: string, courseId: string, lessonId: string) => void;
  completeLesson: (
    learnerId: string,
    courseId: string,
    lessonId: string,
    totalLessons: number,
  ) => void;
  incrementRun: (courseId: string, lessonId: string) => void;
  incrementHint: (courseId: string, lessonId: string) => void;
  saveCode: (
    courseId: string,
    lessonId: string,
    code: Record<string, string>,
  ) => void;
  saveOutput: (courseId: string, lessonId: string, output: string) => void;
  incrementLessonTime: (courseId: string, lessonId: string, deltaMs: number) => void;
  completePracticeExercise: (
    courseId: string,
    lessonId: string,
    exerciseId: string,
  ) => void;
  savePracticeCode: (
    courseId: string,
    lessonId: string,
    exerciseId: string,
    code: Record<string, string>,
  ) => void;
  resetPracticeProgress: (courseId: string, lessonId: string) => void;
  resetLessonProgress: (
    learnerId: string,
    courseId: string,
    lessonId: string,
  ) => void;
  resetCourseProgress: (
    learnerId: string,
    courseId: string,
    lessonIds: string[],
  ) => void;
}

function freshLesson(
  learnerId: string,
  courseId: string,
  lessonId: string,
): LessonProgress {
  return {
    learnerId,
    courseId,
    lessonId,
    status: "not_started",
    startedAt: null,
    updatedAt: now(),
    completedAt: null,
    attemptCount: 0,
    runCount: 0,
    hintCount: 0,
    lastCode: null,
    lastOutput: null,
  };
}

function freshCourse(learnerId: string, courseId: string): CourseProgress {
  return {
    learnerId,
    courseId,
    status: "not_started",
    startedAt: null,
    updatedAt: now(),
    completedAt: null,
    lastLessonId: null,
    completedLessonIds: [],
  };
}

export const useProgressStore = create<ProgressState>()((set, get) => {
  function patchLesson(
    courseId: string,
    lessonId: string,
    mutator: (current: LessonProgress) => LessonProgress | null,
    serverPatch: (next: LessonProgress) => ServerLessonPatch,
  ): void {
    const key = compositeKey(courseId, lessonId);
    const current = get().lessonProgress[key];
    if (!current) return;
    const next = mutator(current);
    if (!next) return;
    set((s) => ({ lessonProgress: { ...s.lessonProgress, [key]: next } }));
    fireAndForget(
      `patchLesson ${courseId}/${lessonId}`,
      api.patchLessonProgress(courseId, lessonId, serverPatch(next)),
    );
  }

  return {
    hydrated: false,
    hydrateError: null,
    courseProgress: {},
    lessonProgress: {},

    hydrate: async (gen) => {
      set({ hydrateError: null });
      try {
        const [coursesRes, lessonsRes] = await Promise.all([
          api.listCourseProgress(),
          api.listLessonProgress(),
        ]);
        if (gen !== undefined && gen !== currentGen()) return;
        const courseMap: Record<string, CourseProgress> = {};
        const lessonMap: Record<string, LessonProgress> = {};
        // We don't have a synthetic `learnerId` anymore — every row belongs
        // to the signed-in user. Fill it in with a stable string so
        // downstream consumers (test fixtures, snapshot exports) still see
        // a non-empty field. The backend never reads it.
        const learnerId = "server";
        for (const row of coursesRes.courses) {
          courseMap[row.courseId] = serverCourseToState(row, learnerId);
        }
        for (const row of lessonsRes.lessons) {
          lessonMap[compositeKey(row.courseId, row.lessonId)] = serverLessonToState(
            row,
            learnerId,
          );
        }
        set({ courseProgress: courseMap, lessonProgress: lessonMap, hydrated: true });
      } catch (err) {
        if (gen !== undefined && gen !== currentGen()) return;
        const msg = (err as Error).message;
        console.error("[progress] hydrate failed:", msg);
        // Leave `hydrated: false` — see HydrationGate rationale.
        set({ hydrateError: msg });
      }
    },

    reset: () => {
      startedThisSession.clear();
      set({
        hydrated: false,
        hydrateError: null,
        courseProgress: {},
        lessonProgress: {},
      });
    },

    loadCourseProgress(learnerId, courseId) {
      const existing = get().courseProgress[courseId];
      if (existing) return existing;
      const fresh = freshCourse(learnerId, courseId);
      set((s) => ({ courseProgress: { ...s.courseProgress, [courseId]: fresh } }));
      // No server write here — an unstarted course doesn't need a row. The
      // row is created on the first startLesson / completeLesson.
      return fresh;
    },

    loadLessonProgress(learnerId, courseId, lessonId) {
      const key = compositeKey(courseId, lessonId);
      const existing = get().lessonProgress[key];
      if (existing) return existing;
      const fresh = freshLesson(learnerId, courseId, lessonId);
      set((s) => ({ lessonProgress: { ...s.lessonProgress, [key]: fresh } }));
      return fresh;
    },

    startLesson(learnerId, courseId, lessonId) {
      const key = compositeKey(courseId, lessonId);
      const isNewSession = !startedThisSession.has(key);
      startedThisSession.add(key);

      const s = get();
      const currentL = s.lessonProgress[key];
      const shouldBumpAttempt = isNewSession && currentL?.status !== "completed";
      const nextL: LessonProgress = {
        ...(currentL ?? freshLesson(learnerId, courseId, lessonId)),
        status: currentL?.status === "completed" ? "completed" : "in_progress",
        startedAt: currentL?.startedAt ?? now(),
        updatedAt: now(),
        attemptCount: (currentL?.attemptCount ?? 0) + (shouldBumpAttempt ? 1 : 0),
      };

      const currentC = s.courseProgress[courseId];
      let nextC: CourseProgress;
      if (!currentC) {
        nextC = {
          ...freshCourse(learnerId, courseId),
          status: "in_progress",
          startedAt: now(),
          lastLessonId: lessonId,
        };
      } else if (currentC.status === "not_started") {
        nextC = {
          ...currentC,
          status: "in_progress",
          startedAt: currentC.startedAt ?? now(),
          updatedAt: now(),
          lastLessonId: lessonId,
        };
      } else {
        nextC = { ...currentC, updatedAt: now(), lastLessonId: lessonId };
      }

      set({
        lessonProgress: { ...s.lessonProgress, [key]: nextL },
        courseProgress: { ...s.courseProgress, [courseId]: nextC },
      });

      fireAndForget(
        `startLesson ${courseId}/${lessonId} lesson`,
        api.patchLessonProgress(courseId, lessonId, {
          status: nextL.status,
          startedAt: nextL.startedAt,
          attemptCount: nextL.attemptCount,
        }),
      );
      fireAndForget(
        `startLesson ${courseId} course`,
        api.patchCourseProgress(courseId, {
          status: nextC.status,
          startedAt: nextC.startedAt,
          lastLessonId: nextC.lastLessonId,
          completedLessonIds: nextC.completedLessonIds,
        }),
      );
    },

    completeLesson(learnerId, courseId, lessonId, totalLessons) {
      const key = compositeKey(courseId, lessonId);
      const s = get();
      const currentL = s.lessonProgress[key];
      const nextL: LessonProgress = {
        ...(currentL ?? {
          ...freshLesson(learnerId, courseId, lessonId),
          startedAt: now(),
          attemptCount: 1,
        }),
        status: "completed",
        updatedAt: now(),
        completedAt: now(),
      };
      const baseC = s.courseProgress[courseId] ?? {
        ...freshCourse(learnerId, courseId),
        status: "in_progress" as const,
        startedAt: now(),
        lastLessonId: lessonId,
      };
      const completed = baseC.completedLessonIds.includes(lessonId)
        ? baseC.completedLessonIds
        : [...baseC.completedLessonIds, lessonId];
      const allDone = completed.length >= totalLessons;
      const nextC: CourseProgress = {
        ...baseC,
        status: allDone ? "completed" : "in_progress",
        updatedAt: now(),
        completedAt: allDone ? now() : baseC.completedAt,
        completedLessonIds: completed,
      };
      set({
        lessonProgress: { ...s.lessonProgress, [key]: nextL },
        courseProgress: { ...s.courseProgress, [courseId]: nextC },
      });

      fireAndForget(
        `completeLesson ${courseId}/${lessonId} lesson`,
        api.patchLessonProgress(courseId, lessonId, {
          status: "completed",
          startedAt: nextL.startedAt,
          completedAt: nextL.completedAt,
          attemptCount: nextL.attemptCount,
        }),
      );
      const coursePatch: ServerCoursePatch = {
        status: nextC.status,
        startedAt: nextC.startedAt,
        completedAt: nextC.completedAt,
        lastLessonId: nextC.lastLessonId,
        completedLessonIds: nextC.completedLessonIds,
      };
      fireAndForget(
        `completeLesson ${courseId} course`,
        api.patchCourseProgress(courseId, coursePatch),
      );
    },

    incrementRun(courseId, lessonId) {
      patchLesson(
        courseId,
        lessonId,
        (lp) => ({ ...lp, runCount: lp.runCount + 1, updatedAt: now() }),
        (next) => ({ runCount: next.runCount }),
      );
    },

    incrementHint(courseId, lessonId) {
      patchLesson(
        courseId,
        lessonId,
        (lp) => ({ ...lp, hintCount: lp.hintCount + 1, updatedAt: now() }),
        (next) => ({ hintCount: next.hintCount }),
      );
    },

    saveCode(courseId, lessonId, code) {
      patchLesson(
        courseId,
        lessonId,
        (lp) => ({ ...lp, lastCode: code, updatedAt: now() }),
        (next) => ({ lastCode: next.lastCode }),
      );
    },

    saveOutput(courseId, lessonId, output) {
      patchLesson(
        courseId,
        lessonId,
        (lp) => ({ ...lp, lastOutput: output, updatedAt: now() }),
        (next) => ({ lastOutput: next.lastOutput }),
      );
    },

    incrementLessonTime(courseId, lessonId, deltaMs) {
      if (!Number.isFinite(deltaMs) || deltaMs <= 0) return;
      // P-H4: in-memory update only. The server write is owned by the
      // lessonHeartbeatBuffer batcher (periodic + pagehide flush), which
      // POSTs an additive delta to /api/user/lessons/heartbeat. We keep
      // the local bump here so the "Time spent" badge animates smoothly
      // between flushes.
      const key = compositeKey(courseId, lessonId);
      const current = get().lessonProgress[key];
      if (!current) return;
      set((s) => ({
        lessonProgress: {
          ...s.lessonProgress,
          [key]: {
            ...current,
            timeSpentMs: (current.timeSpentMs ?? 0) + deltaMs,
            updatedAt: now(),
          },
        },
      }));
    },

    completePracticeExercise(courseId, lessonId, exerciseId) {
      patchLesson(
        courseId,
        lessonId,
        (lp) => {
          const existing = lp.practiceCompletedIds ?? [];
          if (existing.includes(exerciseId)) return null;
          return {
            ...lp,
            practiceCompletedIds: [...existing, exerciseId],
            updatedAt: now(),
          };
        },
        (next) => ({ practiceCompletedIds: next.practiceCompletedIds ?? [] }),
      );
    },

    savePracticeCode(courseId, lessonId, exerciseId, code) {
      patchLesson(
        courseId,
        lessonId,
        (lp) => ({
          ...lp,
          practiceExerciseCode: {
            ...(lp.practiceExerciseCode ?? {}),
            [exerciseId]: code,
          },
          updatedAt: now(),
        }),
        (next) => ({
          practiceExerciseCode: next.practiceExerciseCode ?? {},
        }),
      );
    },

    resetPracticeProgress(courseId, lessonId) {
      patchLesson(
        courseId,
        lessonId,
        (lp) => ({
          ...lp,
          practiceCompletedIds: [],
          practiceExerciseCode: {},
          updatedAt: now(),
        }),
        () => ({ practiceCompletedIds: [], practiceExerciseCode: {} }),
      );
    },

    resetLessonProgress(learnerId, courseId, lessonId) {
      const key = compositeKey(courseId, lessonId);
      startedThisSession.delete(key);

      const s = get();
      const cp = s.courseProgress[courseId];
      let nextCourse = s.courseProgress;
      if (cp) {
        const updatedCp: CourseProgress = {
          ...cp,
          completedLessonIds: cp.completedLessonIds.filter((id) => id !== lessonId),
          status: cp.completedLessonIds.filter((id) => id !== lessonId).length === 0
            ? "not_started"
            : "in_progress",
          completedAt: null,
          updatedAt: now(),
        };
        nextCourse = { ...s.courseProgress, [courseId]: updatedCp };
        fireAndForget(
          `resetLesson ${courseId} course`,
          api.patchCourseProgress(courseId, {
            status: updatedCp.status,
            completedAt: null,
            completedLessonIds: updatedCp.completedLessonIds,
          }),
        );
      }

      const { [key]: _dropped, ...restLessons } = s.lessonProgress;
      set({ courseProgress: nextCourse, lessonProgress: restLessons });

      // Zero out the server row rather than DELETE — keeps updated_at fresh
      // and the upsert path simple. Equivalent end state for the learner.
      fireAndForget(
        `resetLesson ${courseId}/${lessonId}`,
        api.patchLessonProgress(courseId, lessonId, {
          status: "not_started",
          startedAt: null,
          completedAt: null,
          attemptCount: 0,
          runCount: 0,
          hintCount: 0,
          timeSpentMs: 0,
          lastCode: null,
          lastOutput: null,
          practiceCompletedIds: [],
          practiceExerciseCode: {},
        }),
      );
    },

    resetCourseProgress(learnerId, courseId, lessonIds) {
      for (const lid of lessonIds) {
        startedThisSession.delete(compositeKey(courseId, lid));
      }
      const s = get();
      const updatedLessons = { ...s.lessonProgress };
      for (const lid of lessonIds) {
        delete updatedLessons[compositeKey(courseId, lid)];
      }
      const fresh = freshCourse(learnerId, courseId);
      set({
        lessonProgress: updatedLessons,
        courseProgress: { ...s.courseProgress, [courseId]: fresh },
      });

      fireAndForget(
        `resetCourse ${courseId}`,
        api.deleteCourseProgress(courseId),
      );
    },
  };
});

// ── Convenience accessors (synchronous reads against in-memory state) ─────

export function loadSavedCode(
  courseId: string,
  lessonId: string,
): Record<string, string> | null {
  const lp = useProgressStore.getState().lessonProgress[compositeKey(courseId, lessonId)];
  return lp?.lastCode ?? null;
}

export function loadAllLessonProgress(
  courseId: string,
  lessonIds: string[],
): LessonProgress[] {
  const state = useProgressStore.getState();
  const results: LessonProgress[] = [];
  for (const id of lessonIds) {
    const lp = state.lessonProgress[compositeKey(courseId, id)];
    if (lp) results.push(lp);
  }
  return results;
}
