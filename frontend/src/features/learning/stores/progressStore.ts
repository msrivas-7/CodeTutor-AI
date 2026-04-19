import { create } from "zustand";
import type { CourseProgress, LessonProgress } from "../types";
import { noteStorageQuotaError } from "../../../state/storageStore";

const COURSE_KEY = (courseId: string) => `learner:v1:progress:${courseId}`;
const LESSON_KEY = (courseId: string, lessonId: string) =>
  `learner:v1:lesson:${courseId}:${lessonId}`;

function loadJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function loadSavedCode(
  courseId: string,
  lessonId: string,
): Record<string, string> | null {
  const lp = loadJson<LessonProgress>(LESSON_KEY(courseId, lessonId));
  return lp?.lastCode ?? null;
}

export function loadAllLessonProgress(
  courseId: string,
  lessonIds: string[],
): LessonProgress[] {
  const results: LessonProgress[] = [];
  for (const id of lessonIds) {
    const lp = loadJson<LessonProgress>(LESSON_KEY(courseId, id));
    if (lp) results.push(lp);
  }
  return results;
}

function saveJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    // Surface quota errors as a dismissible banner — silent loss of progress
    // (what the old `/* quota or disabled */` swallow did) was a footgun.
    noteStorageQuotaError(err);
  }
}

function now(): string {
  return new Date().toISOString();
}

const startedThisSession = new Set<string>();

function resolveLesson(
  storeProgress: Record<string, LessonProgress>,
  courseId: string,
  lessonId: string,
): LessonProgress | null {
  const compositeKey = `${courseId}/${lessonId}`;
  return storeProgress[compositeKey]
    ?? loadJson<LessonProgress>(LESSON_KEY(courseId, lessonId));
}

function resolveCourse(
  storeCourses: Record<string, CourseProgress>,
  courseId: string,
): CourseProgress | null {
  return storeCourses[courseId]
    ?? loadJson<CourseProgress>(COURSE_KEY(courseId));
}

interface ProgressState {
  courseProgress: Record<string, CourseProgress>;
  lessonProgress: Record<string, LessonProgress>;

  loadCourseProgress: (learnerId: string, courseId: string) => CourseProgress;
  loadLessonProgress: (
    learnerId: string,
    courseId: string,
    lessonId: string
  ) => LessonProgress;

  startLesson: (learnerId: string, courseId: string, lessonId: string) => void;
  completeLesson: (
    learnerId: string,
    courseId: string,
    lessonId: string,
    totalLessons: number
  ) => void;
  incrementRun: (courseId: string, lessonId: string) => void;
  incrementHint: (courseId: string, lessonId: string) => void;
  saveCode: (
    courseId: string,
    lessonId: string,
    code: Record<string, string>
  ) => void;
  saveOutput: (courseId: string, lessonId: string, output: string) => void;
  incrementLessonTime: (courseId: string, lessonId: string, deltaMs: number) => void;
  completePracticeExercise: (
    courseId: string,
    lessonId: string,
    exerciseId: string
  ) => void;
  resetPracticeProgress: (courseId: string, lessonId: string) => void;
  resetLessonProgress: (learnerId: string, courseId: string, lessonId: string) => void;
  resetCourseProgress: (learnerId: string, courseId: string, lessonIds: string[]) => void;
}

export const useProgressStore = create<ProgressState>()((set, get) => {
  // Private mutator used by every simple per-lesson update (runCount,
  // hintCount, lastCode, lastOutput, timeSpentMs, practiceCompletedIds, …).
  // Return `null` from `patch` to no-op (e.g. lesson not found, duplicate
  // practice id). Eliminates ~100 lines of resolveLesson/saveJson/set
  // scaffolding that was copy-pasted across 7 methods.
  const updateLesson = (
    courseId: string,
    lessonId: string,
    patch: (current: LessonProgress) => LessonProgress | null,
  ) => {
    const compositeKey = `${courseId}/${lessonId}`;
    const lsKey = LESSON_KEY(courseId, lessonId);
    set((s) => {
      const current = resolveLesson(s.lessonProgress, courseId, lessonId);
      if (!current) return s;
      const next = patch(current);
      if (!next) return s;
      saveJson(lsKey, next);
      return { lessonProgress: { ...s.lessonProgress, [compositeKey]: next } };
    });
  };

  return ({
  courseProgress: {},
  lessonProgress: {},

  loadCourseProgress(learnerId, courseId) {
    const key = COURSE_KEY(courseId);
    const existing = loadJson<CourseProgress>(key);
    if (existing) {
      set((s) => ({
        courseProgress: { ...s.courseProgress, [courseId]: existing },
      }));
      return existing;
    }
    const fresh: CourseProgress = {
      learnerId,
      courseId,
      status: "not_started",
      startedAt: null,
      updatedAt: now(),
      completedAt: null,
      lastLessonId: null,
      completedLessonIds: [],
    };
    saveJson(key, fresh);
    set((s) => ({
      courseProgress: { ...s.courseProgress, [courseId]: fresh },
    }));
    return fresh;
  },

  loadLessonProgress(learnerId, courseId, lessonId) {
    const compositeKey = `${courseId}/${lessonId}`;
    const lsKey = LESSON_KEY(courseId, lessonId);
    const existing = loadJson<LessonProgress>(lsKey);
    if (existing) {
      set((s) => ({
        lessonProgress: { ...s.lessonProgress, [compositeKey]: existing },
      }));
      return existing;
    }
    const fresh: LessonProgress = {
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
    saveJson(lsKey, fresh);
    set((s) => ({
      lessonProgress: { ...s.lessonProgress, [compositeKey]: fresh },
    }));
    return fresh;
  },

  startLesson(learnerId, courseId, lessonId) {
    const compositeKey = `${courseId}/${lessonId}`;
    const lsKey = LESSON_KEY(courseId, lessonId);

    const isNewSession = !startedThisSession.has(compositeKey);
    startedThisSession.add(compositeKey);

    set((s) => {
      const current = resolveLesson(s.lessonProgress, courseId, lessonId);
      const shouldBumpAttempt = isNewSession && current?.status !== "completed";

      const updated: LessonProgress = {
        ...(current ?? {
          learnerId,
          courseId,
          lessonId,
          completedAt: null,
          attemptCount: 0,
          runCount: 0,
          hintCount: 0,
          lastCode: null,
          lastOutput: null,
        }),
        status: current?.status === "completed" ? "completed" : "in_progress",
        startedAt: current?.startedAt ?? now(),
        updatedAt: now(),
        attemptCount: (current?.attemptCount ?? 0) + (shouldBumpAttempt ? 1 : 0),
      };
      saveJson(lsKey, updated);

      const courseKey = COURSE_KEY(courseId);
      const cp = resolveCourse(s.courseProgress, courseId);
      let courseUpdate = s.courseProgress;
      if (!cp) {
        const freshCp: CourseProgress = {
          learnerId,
          courseId,
          status: "in_progress",
          startedAt: now(),
          updatedAt: now(),
          completedAt: null,
          lastLessonId: lessonId,
          completedLessonIds: [],
        };
        saveJson(courseKey, freshCp);
        courseUpdate = { ...s.courseProgress, [courseId]: freshCp };
      } else if (cp.status === "not_started") {
        const updatedCp: CourseProgress = {
          ...cp,
          status: "in_progress",
          startedAt: cp.startedAt ?? now(),
          updatedAt: now(),
          lastLessonId: lessonId,
        };
        saveJson(courseKey, updatedCp);
        courseUpdate = { ...s.courseProgress, [courseId]: updatedCp };
      } else {
        const updatedCp: CourseProgress = {
          ...cp,
          updatedAt: now(),
          lastLessonId: lessonId,
        };
        saveJson(courseKey, updatedCp);
        courseUpdate = { ...s.courseProgress, [courseId]: updatedCp };
      }

      return {
        lessonProgress: { ...s.lessonProgress, [compositeKey]: updated },
        courseProgress: courseUpdate,
      };
    });
  },

  completeLesson(learnerId, courseId, lessonId, totalLessons) {
    const compositeKey = `${courseId}/${lessonId}`;
    const lsKey = LESSON_KEY(courseId, lessonId);

    set((s) => {
      const current = resolveLesson(s.lessonProgress, courseId, lessonId);
      const updated: LessonProgress = {
        ...(current ?? {
          learnerId,
          courseId,
          lessonId,
          startedAt: now(),
          attemptCount: 1,
          runCount: 0,
          hintCount: 0,
          lastCode: null,
          lastOutput: null,
        }),
        status: "completed",
        updatedAt: now(),
        completedAt: now(),
      };
      saveJson(lsKey, updated);

      const courseKey = COURSE_KEY(courseId);
      const cp = resolveCourse(s.courseProgress, courseId);
      let courseUpdate = s.courseProgress;
      const baseCp: CourseProgress = cp ?? {
        learnerId,
        courseId,
        status: "in_progress",
        startedAt: now(),
        updatedAt: now(),
        completedAt: null,
        lastLessonId: lessonId,
        completedLessonIds: [],
      };
      const completed = baseCp.completedLessonIds.includes(lessonId)
        ? baseCp.completedLessonIds
        : [...baseCp.completedLessonIds, lessonId];
      const allDone = completed.length >= totalLessons;
      const updatedCp: CourseProgress = {
        ...baseCp,
        status: allDone ? "completed" : "in_progress",
        updatedAt: now(),
        completedAt: allDone ? now() : baseCp.completedAt,
        completedLessonIds: completed,
      };
      saveJson(courseKey, updatedCp);
      courseUpdate = { ...s.courseProgress, [courseId]: updatedCp };

      return {
        lessonProgress: { ...s.lessonProgress, [compositeKey]: updated },
        courseProgress: courseUpdate,
      };
    });
  },

  incrementRun(courseId, lessonId) {
    updateLesson(courseId, lessonId, (lp) => ({ ...lp, runCount: lp.runCount + 1, updatedAt: now() }));
  },

  incrementHint(courseId, lessonId) {
    updateLesson(courseId, lessonId, (lp) => ({ ...lp, hintCount: lp.hintCount + 1, updatedAt: now() }));
  },

  saveCode(courseId, lessonId, code) {
    updateLesson(courseId, lessonId, (lp) => ({ ...lp, lastCode: code, updatedAt: now() }));
  },

  saveOutput(courseId, lessonId, output) {
    updateLesson(courseId, lessonId, (lp) => ({ ...lp, lastOutput: output, updatedAt: now() }));
  },

  incrementLessonTime(courseId, lessonId, deltaMs) {
    if (!Number.isFinite(deltaMs) || deltaMs <= 0) return;
    updateLesson(courseId, lessonId, (lp) => ({
      ...lp,
      timeSpentMs: (lp.timeSpentMs ?? 0) + deltaMs,
      updatedAt: now(),
    }));
  },

  completePracticeExercise(courseId, lessonId, exerciseId) {
    updateLesson(courseId, lessonId, (lp) => {
      const existing = lp.practiceCompletedIds ?? [];
      if (existing.includes(exerciseId)) return null;
      return {
        ...lp,
        practiceCompletedIds: [...existing, exerciseId],
        updatedAt: now(),
      };
    });
  },

  resetPracticeProgress(courseId, lessonId) {
    updateLesson(courseId, lessonId, (lp) => ({
      ...lp,
      practiceCompletedIds: [],
      updatedAt: now(),
    }));
  },

  resetLessonProgress(learnerId, courseId, lessonId) {
    const compositeKey = `${courseId}/${lessonId}`;
    const lsKey = LESSON_KEY(courseId, lessonId);
    startedThisSession.delete(compositeKey);
    try { localStorage.removeItem(lsKey); } catch { /* */ }

    set((s) => {
      const cp = resolveCourse(s.courseProgress, courseId);
      let courseUpdate = s.courseProgress;
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
        saveJson(COURSE_KEY(courseId), updatedCp);
        courseUpdate = { ...s.courseProgress, [courseId]: updatedCp };
      }

      const { [compositeKey]: _, ...restLessons } = s.lessonProgress;
      return { lessonProgress: restLessons, courseProgress: courseUpdate };
    });
  },

  resetCourseProgress(learnerId, courseId, lessonIds) {
    for (const lid of lessonIds) {
      const compositeKey = `${courseId}/${lid}`;
      startedThisSession.delete(compositeKey);
      try { localStorage.removeItem(LESSON_KEY(courseId, lid)); } catch { /* */ }
    }
    try { localStorage.removeItem(COURSE_KEY(courseId)); } catch { /* */ }

    set((s) => {
      const updated = { ...s.lessonProgress };
      for (const lid of lessonIds) {
        delete updated[`${courseId}/${lid}`];
      }

      const freshCp: CourseProgress = {
        learnerId,
        courseId,
        status: "not_started",
        startedAt: null,
        updatedAt: now(),
        completedAt: null,
        lastLessonId: null,
        completedLessonIds: [],
      };
      saveJson(COURSE_KEY(courseId), freshCp);

      return {
        lessonProgress: updated,
        courseProgress: { ...s.courseProgress, [courseId]: freshCp },
      };
    });
  },
  });
});
