import { create } from "zustand";
import type { CourseProgress, LessonProgress } from "../types";
import {
  api,
  type ServerCoursePatch,
  type ServerCourseProgress,
  type ServerLessonPatch,
  type ServerLessonProgress,
  type PracticeEvidencePayload,
} from "../../../api/client";
import { currentGen } from "../../../auth/generation";
import { invalidateStreak } from "../../../state/useStreak";
import { ApiError } from "../../../api/ApiError";
import { tabWriterId } from "../../../util/tabWriterId";
import { useProjectStore } from "../../../state/projectStore";

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

export const lessonDraftWriterId = tabWriterId;

export interface LessonDraftConflict {
  courseId: string;
  lessonId: string;
  localCode: Record<string, string>;
  remoteCode: Record<string, string>;
  remoteRevision: number;
  remoteWriterId: string | null;
  remoteUpdatedAt: string | null;
}

const draftSaveChains = new Map<string, Promise<void>>();
const draftChannel: BroadcastChannel | null =
  typeof BroadcastChannel === "function"
    ? new BroadcastChannel("codetutor:lesson-drafts:v1")
    : null;

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
    draftRevision: row.draftRevision,
    draftWriterId: row.draftWriterId,
    draftUpdatedAt: row.draftUpdatedAt,
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
  draftConflicts: Record<string, LessonDraftConflict>;
  draftSaveErrors: Record<string, string>;

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
  ) => Promise<void>;
  incrementRun: (courseId: string, lessonId: string) => void;
  incrementAttempt: (courseId: string, lessonId: string) => void;
  incrementHint: (courseId: string, lessonId: string) => void;
  saveCode: (
    courseId: string,
    lessonId: string,
    code: Record<string, string>,
  ) => Promise<void>;
  keepLocalDraft: (courseId: string, lessonId: string) => Promise<boolean>;
  retryDraftSave: (courseId: string, lessonId: string) => Promise<void>;
  acceptRemoteDraft: (
    courseId: string,
    lessonId: string,
  ) => Record<string, string> | null;
  saveOutput: (courseId: string, lessonId: string, output: string) => void;
  incrementLessonTime: (courseId: string, lessonId: string, deltaMs: number) => void;
  completePracticeExercise: (
    courseId: string,
    lessonId: string,
    exerciseId: string,
    evidence: Omit<PracticeEvidencePayload, "exerciseId">,
  ) => Promise<boolean>;
  savePracticeCode: (
    courseId: string,
    lessonId: string,
    exerciseId: string,
    code: Record<string, string>,
  ) => void;
  resetPracticeProgress: (courseId: string, lessonId: string) => Promise<void>;
  resetLessonProgress: (
    learnerId: string,
    courseId: string,
    lessonId: string,
  ) => Promise<void>;
  resetCourseProgress: (
    learnerId: string,
    courseId: string,
    lessonIds: string[],
  ) => Promise<void>;
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
    draftRevision: 0,
    draftWriterId: null,
    draftUpdatedAt: null,
    lastOutput: null,
    timeSpentMs: 0,
    practiceCompletedIds: [],
    practiceExerciseCode: {},
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

/**
 * Lesson completion and its course-level summary are persisted by separate
 * idempotent requests. The detailed lesson row is the durable proof that a
 * lesson was completed; if the companion course PATCH is delayed or fails,
 * trusting only `course_progress.completed_lesson_ids` would falsely relock
 * the curriculum on the next hydrate. Merge completed lesson rows into the
 * in-memory course aggregate so the learner keeps access. Opening the lesson
 * later sends the reconciled aggregate back through `startLesson`, naturally
 * repairing the server summary as well.
 */
function reconcileCompletedLessons(
  courseMap: Record<string, CourseProgress>,
  lessonMap: Record<string, LessonProgress>,
  learnerId: string,
): void {
  for (const lesson of Object.values(lessonMap)) {
    if (lesson.status !== "completed") continue;

    const course = courseMap[lesson.courseId];
    if (!course) {
      courseMap[lesson.courseId] = {
        ...freshCourse(learnerId, lesson.courseId),
        status: "in_progress",
        startedAt: lesson.startedAt,
        updatedAt: lesson.updatedAt,
        lastLessonId: lesson.lessonId,
        completedLessonIds: [lesson.lessonId],
      };
      continue;
    }

    if (course.completedLessonIds.includes(lesson.lessonId)) continue;
    courseMap[lesson.courseId] = {
      ...course,
      status: course.status === "not_started" ? "in_progress" : course.status,
      startedAt: course.startedAt ?? lesson.startedAt,
      lastLessonId: course.lastLessonId ?? lesson.lessonId,
      completedLessonIds: [...course.completedLessonIds, lesson.lessonId],
    };
  }
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
    draftConflicts: {},
    draftSaveErrors: {},

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
        reconcileCompletedLessons(courseMap, lessonMap, learnerId);
        set({
          courseProgress: courseMap,
          lessonProgress: lessonMap,
          draftConflicts: {},
          draftSaveErrors: {},
          hydrated: true,
        });
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
        draftConflicts: {},
        draftSaveErrors: {},
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
      // `startedThisSession` is still tracked but no longer drives an
      // attemptCount bump — opening a lesson page is not an "attempt."
      // An attempt is a Check button press; that lives in
      // `incrementAttempt` below, called from useLessonValidator.
      startedThisSession.add(key);

      const s = get();
      const currentL = s.lessonProgress[key];
      const nextL: LessonProgress = {
        ...(currentL ?? freshLesson(learnerId, courseId, lessonId)),
        status: currentL?.status === "completed" ? "completed" : "in_progress",
        startedAt: currentL?.startedAt ?? now(),
        updatedAt: now(),
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

    async completeLesson(learnerId, courseId, lessonId, totalLessons) {
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
      // Persist the detailed lesson row before the UI celebrates. It is the
      // durable proof used to recover the course aggregate after interruption.
      const savedLesson = await api.patchLessonProgress(courseId, lessonId, {
        status: "completed",
        startedAt: nextL.startedAt,
        completedAt: nextL.completedAt,
        attemptCount: nextL.attemptCount,
      });
      invalidateStreak();
      set((state) => ({
        lessonProgress: {
          ...state.lessonProgress,
          [key]: serverLessonToState(savedLesson, learnerId),
        },
        courseProgress: { ...state.courseProgress, [courseId]: nextC },
      }));
      const coursePatch: ServerCoursePatch = {
        status: nextC.status,
        startedAt: nextC.startedAt,
        completedAt: nextC.completedAt,
        lastLessonId: nextC.lastLessonId,
        completedLessonIds: nextC.completedLessonIds,
      };
      // Keep the derived course request ordered after the lesson. A failure
      // here is repairable because hydrate reconstructs it from lesson rows.
      try {
        const savedCourse = await api.patchCourseProgress(courseId, coursePatch);
        set((state) => ({
          courseProgress: {
            ...state.courseProgress,
            [courseId]: serverCourseToState(savedCourse, learnerId),
          },
        }));
      } catch (error) {
        console.error(
          `[progress] completeLesson ${courseId} course summary:`,
          (error as Error).message,
        );
      }
    },

    incrementRun(courseId, lessonId) {
      patchLesson(
        courseId,
        lessonId,
        (lp) => ({ ...lp, runCount: lp.runCount + 1, updatedAt: now() }),
        (next) => ({ runCount: next.runCount }),
      );
    },

    // Caller: useLessonValidator.handleCheck — fires once per Check
    // button press. Skips the bump after the lesson is completed
    // (re-checks of an already-passed lesson aren't fresh attempts).
    incrementAttempt(courseId, lessonId) {
      patchLesson(
        courseId,
        lessonId,
        (lp) =>
          lp.status === "completed"
            ? lp
            : { ...lp, attemptCount: lp.attemptCount + 1, updatedAt: now() },
        (next) => ({ attemptCount: next.attemptCount }),
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
      const key = compositeKey(courseId, lessonId);
      const current = get().lessonProgress[key];
      if (!current) return Promise.resolve();

      set((state) => ({
        lessonProgress: {
          ...state.lessonProgress,
          [key]: { ...current, lastCode: code, updatedAt: now() },
        },
      }));

      const prior = draftSaveChains.get(key) ?? Promise.resolve();
      const operation = prior
        .catch(() => undefined)
        .then(async () => {
          const latest = get();
          const lesson = latest.lessonProgress[key];
          if (!lesson || latest.draftConflicts[key]) return;
          try {
            const saved = await api.saveLessonDraft(courseId, lessonId, {
              code,
              expectedRevision: lesson.draftRevision ?? 0,
              writerId: lessonDraftWriterId,
            });
            set((state) => {
              const local = state.lessonProgress[key];
              if (!local) return state;
              const { [key]: _resolvedError, ...remainingErrors } =
                state.draftSaveErrors;
              return {
                lessonProgress: {
                  ...state.lessonProgress,
                  [key]: {
                    ...local,
                    lastCode: local.lastCode === code ? saved.lastCode : local.lastCode,
                    draftRevision: saved.draftRevision,
                    draftWriterId: saved.draftWriterId,
                    draftUpdatedAt: saved.draftUpdatedAt,
                    updatedAt: saved.updatedAt,
                  },
                },
                draftSaveErrors: remainingErrors,
              };
            });
            draftChannel?.postMessage({
              key,
              courseId,
              lessonId,
              code,
              revision: saved.draftRevision,
              writerId: lessonDraftWriterId,
              updatedAt: saved.draftUpdatedAt,
            });
          } catch (error) {
            if (error instanceof ApiError && error.status === 409) {
              try {
                const body = JSON.parse(error.body) as {
                  current?: ServerLessonProgress;
                };
                if (body.current) {
                  const remote = body.current;
                  set((state) => ({
                    draftConflicts: {
                      ...state.draftConflicts,
                      [key]: {
                        courseId,
                        lessonId,
                        localCode:
                          state.lessonProgress[key]?.lastCode ?? code,
                        remoteCode: remote.lastCode ?? {},
                        remoteRevision: remote.draftRevision,
                        remoteWriterId: remote.draftWriterId,
                        remoteUpdatedAt: remote.draftUpdatedAt,
                      },
                    },
                    lessonProgress: {
                      ...state.lessonProgress,
                      [key]: {
                        ...state.lessonProgress[key],
                        draftRevision: remote.draftRevision,
                        draftWriterId: remote.draftWriterId,
                        draftUpdatedAt: remote.draftUpdatedAt,
                      },
                    },
                    draftSaveErrors: Object.fromEntries(
                      Object.entries(state.draftSaveErrors).filter(
                        ([errorKey]) => errorKey !== key,
                      ),
                    ),
                  }));
                  return;
                }
              } catch {
                // Fall through to the ordinary save failure log.
              }
            }
            console.error(
              `[progress] saveCode ${courseId}/${lessonId}:`,
              (error as Error).message,
            );
            set((state) => ({
              draftSaveErrors: {
                ...state.draftSaveErrors,
                [key]: "Your code is still open here, but it has not synced yet.",
              },
            }));
          }
        })
        .finally(() => {
          if (draftSaveChains.get(key) === operation) draftSaveChains.delete(key);
        });
      draftSaveChains.set(key, operation);
      return operation;
    },

    async keepLocalDraft(courseId, lessonId) {
      const key = compositeKey(courseId, lessonId);
      const conflict = get().draftConflicts[key];
      if (!conflict) return false;
      try {
        const saved = await api.saveLessonDraft(courseId, lessonId, {
          code: conflict.localCode,
          expectedRevision: conflict.remoteRevision,
          writerId: lessonDraftWriterId,
        });
        set((state) => {
          const { [key]: _resolved, ...remaining } = state.draftConflicts;
          const { [key]: _resolvedError, ...remainingErrors } =
            state.draftSaveErrors;
          return {
            draftConflicts: remaining,
            draftSaveErrors: remainingErrors,
            lessonProgress: {
              ...state.lessonProgress,
              [key]: serverLessonToState(saved, state.lessonProgress[key]?.learnerId ?? "server"),
            },
          };
        });
        draftChannel?.postMessage({
          key,
          courseId,
          lessonId,
          code: saved.lastCode ?? conflict.localCode,
          revision: saved.draftRevision,
          writerId: lessonDraftWriterId,
          updatedAt: saved.draftUpdatedAt,
        });
        return true;
      } catch (error) {
        console.error(`[progress] keepLocalDraft ${key}:`, (error as Error).message);
        set((state) => ({
          draftSaveErrors: {
            ...state.draftSaveErrors,
            [key]: "That version could not be saved yet. Both copies are still available.",
          },
        }));
        return false;
      }
    },

    async retryDraftSave(courseId, lessonId) {
      const key = compositeKey(courseId, lessonId);
      const code = get().lessonProgress[key]?.lastCode;
      if (!code) return;
      await get().saveCode(courseId, lessonId, code);
    },

    acceptRemoteDraft(courseId, lessonId) {
      const key = compositeKey(courseId, lessonId);
      const conflict = get().draftConflicts[key];
      if (!conflict) return null;
      set((state) => {
        const { [key]: _resolved, ...remaining } = state.draftConflicts;
        const { [key]: _resolvedError, ...remainingErrors } =
          state.draftSaveErrors;
        const current = state.lessonProgress[key];
        return {
          draftConflicts: remaining,
          draftSaveErrors: remainingErrors,
          lessonProgress: current
            ? {
                ...state.lessonProgress,
                [key]: {
                  ...current,
                  lastCode: conflict.remoteCode,
                  draftRevision: conflict.remoteRevision,
                  draftWriterId: conflict.remoteWriterId,
                  draftUpdatedAt: conflict.remoteUpdatedAt,
                },
              }
            : state.lessonProgress,
        };
      });
      return conflict.remoteCode;
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

    async completePracticeExercise(courseId, lessonId, exerciseId, evidence) {
      const key = compositeKey(courseId, lessonId);
      const current = get().lessonProgress[key];
      if (!current || (current.practiceCompletedIds ?? []).includes(exerciseId)) {
        return false;
      }
      try {
        const saved = await api.patchLessonProgress(courseId, lessonId, {
          practiceCompletedIds: [
            ...(current.practiceCompletedIds ?? []),
            exerciseId,
          ],
          practiceEvidence: { exerciseId, ...evidence },
        });
        set((state) => ({
          lessonProgress: {
            ...state.lessonProgress,
            [key]: serverLessonToState(
              saved,
              state.lessonProgress[key]?.learnerId ?? "server",
            ),
          },
        }));
        return true;
      } catch (error) {
        console.error(
          `[progress] completePracticeExercise ${courseId}/${lessonId}:`,
          (error as Error).message,
        );
        throw error;
      }
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

    async resetPracticeProgress(courseId, lessonId) {
      const key = compositeKey(courseId, lessonId);
      const saved = await api.resetPracticeProgress(courseId, lessonId);
      set((state) => ({
        lessonProgress: {
          ...state.lessonProgress,
          [key]: serverLessonToState(
            saved,
            state.lessonProgress[key]?.learnerId ?? "server",
          ),
        },
      }));
    },

    async resetLessonProgress(learnerId, courseId, lessonId) {
      const key = compositeKey(courseId, lessonId);
      const { reset, course } = await api.resetLessonProgress(courseId, lessonId);
      startedThisSession.delete(key);
      set((state) => {
        const { [key]: _discardedConflict, ...remainingConflicts } =
          state.draftConflicts;
        const { [key]: _discardedError, ...remainingErrors } =
          state.draftSaveErrors;
        return {
          lessonProgress: {
            ...state.lessonProgress,
            [key]: serverLessonToState(reset, learnerId),
          },
          courseProgress: {
            ...state.courseProgress,
            [courseId]: serverCourseToState(course, learnerId),
          },
          draftConflicts: remainingConflicts,
          draftSaveErrors: remainingErrors,
        };
      });
    },

    async resetCourseProgress(learnerId, courseId, lessonIds) {
      await api.deleteCourseProgress(courseId);
      for (const lid of lessonIds) {
        startedThisSession.delete(compositeKey(courseId, lid));
      }
      const s = get();
      const updatedLessons = { ...s.lessonProgress };
      for (const lid of lessonIds) {
        delete updatedLessons[compositeKey(courseId, lid)];
      }
      const remainingConflicts = { ...s.draftConflicts };
      const remainingErrors = { ...s.draftSaveErrors };
      for (const lid of lessonIds) {
        delete remainingConflicts[compositeKey(courseId, lid)];
        delete remainingErrors[compositeKey(courseId, lid)];
      }
      const fresh = freshCourse(learnerId, courseId);
      set({
        lessonProgress: updatedLessons,
        courseProgress: { ...s.courseProgress, [courseId]: fresh },
        draftConflicts: remainingConflicts,
        draftSaveErrors: remainingErrors,
      });
    },
  };
});

if (draftChannel) {
  draftChannel.onmessage = (event: MessageEvent<{
    key: string;
    courseId: string;
    lessonId: string;
    code: Record<string, string>;
    revision: number;
    writerId: string;
    updatedAt: string | null;
  }>) => {
    const remote = event.data;
    if (!remote || remote.writerId === lessonDraftWriterId) return;
    const state = useProgressStore.getState();
    const local = state.lessonProgress[remote.key];
    if (!local || remote.revision <= (local.draftRevision ?? 0)) return;
    const activeProject = useProjectStore.getState();
    const visibleCode =
      activeProject.projectContext === `lesson:${remote.key}`
        ? Object.fromEntries(
            activeProject.order.map((path) => [path, activeProject.files[path] ?? ""]),
          )
        : local.lastCode ?? {};
    const sameCode = JSON.stringify(visibleCode) === JSON.stringify(remote.code);
    if (sameCode) {
      useProgressStore.setState({
        lessonProgress: {
          ...state.lessonProgress,
          [remote.key]: {
            ...local,
            draftRevision: remote.revision,
            draftWriterId: remote.writerId,
            draftUpdatedAt: remote.updatedAt,
          },
        },
      });
      return;
    }
    useProgressStore.setState({
      draftConflicts: {
        ...state.draftConflicts,
        [remote.key]: {
          courseId: remote.courseId,
          lessonId: remote.lessonId,
          localCode: visibleCode,
          remoteCode: remote.code,
          remoteRevision: remote.revision,
          remoteWriterId: remote.writerId,
          remoteUpdatedAt: remote.updatedAt,
        },
      },
    });
  };
}

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
