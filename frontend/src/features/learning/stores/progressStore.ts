import { create } from "zustand";
import type { CourseProgress, LessonProgress } from "../types";

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
  } catch {
    /* quota or disabled */
  }
}

function now(): string {
  return new Date().toISOString();
}

const startedThisSession = new Set<string>();

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
}

function resolveLesson(
  state: ProgressState,
  courseId: string,
  lessonId: string,
): LessonProgress | null {
  const compositeKey = `${courseId}/${lessonId}`;
  const fromStore = state.lessonProgress[compositeKey];
  if (fromStore) return fromStore;
  return loadJson<LessonProgress>(LESSON_KEY(courseId, lessonId));
}

export const useProgressStore = create<ProgressState>()((set, get) => ({
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
    const current = resolveLesson(get(), courseId, lessonId);

    const isNewSession = !startedThisSession.has(compositeKey);
    startedThisSession.add(compositeKey);

    const shouldBumpAttempt =
      isNewSession && current?.status !== "completed";

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
    set((s) => ({
      lessonProgress: { ...s.lessonProgress, [compositeKey]: updated },
    }));

    const courseKey = COURSE_KEY(courseId);
    const cp = get().courseProgress[courseId]
      ?? loadJson<CourseProgress>(courseKey);
    if (cp && cp.status === "not_started") {
      const updatedCp: CourseProgress = {
        ...cp,
        status: "in_progress",
        startedAt: cp.startedAt ?? now(),
        updatedAt: now(),
        lastLessonId: lessonId,
      };
      saveJson(courseKey, updatedCp);
      set((s) => ({
        courseProgress: { ...s.courseProgress, [courseId]: updatedCp },
      }));
    } else if (cp) {
      const updatedCp: CourseProgress = {
        ...cp,
        updatedAt: now(),
        lastLessonId: lessonId,
      };
      saveJson(courseKey, updatedCp);
      set((s) => ({
        courseProgress: { ...s.courseProgress, [courseId]: updatedCp },
      }));
    }
  },

  completeLesson(learnerId, courseId, lessonId, totalLessons) {
    const compositeKey = `${courseId}/${lessonId}`;
    const lsKey = LESSON_KEY(courseId, lessonId);
    const current = resolveLesson(get(), courseId, lessonId);
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
    set((s) => ({
      lessonProgress: { ...s.lessonProgress, [compositeKey]: updated },
    }));

    const courseKey = COURSE_KEY(courseId);
    const cp = get().courseProgress[courseId]
      ?? loadJson<CourseProgress>(courseKey);
    if (cp) {
      const completed = cp.completedLessonIds.includes(lessonId)
        ? cp.completedLessonIds
        : [...cp.completedLessonIds, lessonId];
      const allDone = completed.length >= totalLessons;
      const updatedCp: CourseProgress = {
        ...cp,
        status: allDone ? "completed" : "in_progress",
        updatedAt: now(),
        completedAt: allDone ? now() : cp.completedAt,
        completedLessonIds: completed,
      };
      saveJson(courseKey, updatedCp);
      set((s) => ({
        courseProgress: { ...s.courseProgress, [courseId]: updatedCp },
      }));
    }
  },

  incrementRun(courseId, lessonId) {
    const compositeKey = `${courseId}/${lessonId}`;
    const lsKey = LESSON_KEY(courseId, lessonId);
    const current = resolveLesson(get(), courseId, lessonId);
    if (!current) return;
    const updated = { ...current, runCount: current.runCount + 1, updatedAt: now() };
    saveJson(lsKey, updated);
    set((s) => ({
      lessonProgress: { ...s.lessonProgress, [compositeKey]: updated },
    }));
  },

  incrementHint(courseId, lessonId) {
    const compositeKey = `${courseId}/${lessonId}`;
    const lsKey = LESSON_KEY(courseId, lessonId);
    const current = resolveLesson(get(), courseId, lessonId);
    if (!current) return;
    const updated = { ...current, hintCount: current.hintCount + 1, updatedAt: now() };
    saveJson(lsKey, updated);
    set((s) => ({
      lessonProgress: { ...s.lessonProgress, [compositeKey]: updated },
    }));
  },

  saveCode(courseId, lessonId, code) {
    const compositeKey = `${courseId}/${lessonId}`;
    const lsKey = LESSON_KEY(courseId, lessonId);
    const current = resolveLesson(get(), courseId, lessonId);
    if (!current) return;
    const updated = { ...current, lastCode: code, updatedAt: now() };
    saveJson(lsKey, updated);
    set((s) => ({
      lessonProgress: { ...s.lessonProgress, [compositeKey]: updated },
    }));
  },

  saveOutput(courseId, lessonId, output) {
    const compositeKey = `${courseId}/${lessonId}`;
    const lsKey = LESSON_KEY(courseId, lessonId);
    const current = resolveLesson(get(), courseId, lessonId);
    if (!current) return;
    const updated = { ...current, lastOutput: output, updatedAt: now() };
    saveJson(lsKey, updated);
    set((s) => ({
      lessonProgress: { ...s.lessonProgress, [compositeKey]: updated },
    }));
  },
}));
