import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Phase 18b: progressStore is now a thin wrapper over the backend user-data
// API. Tests mock `api` and assert that (a) optimistic in-memory state
// updates are correct and (b) the right PATCH/DELETE calls fire.

const {
  patchLessonProgress,
  patchCourseProgress,
  deleteCourseProgress,
  listCourseProgress,
  listLessonProgress,
} = vi.hoisted(() => ({
  patchLessonProgress: vi.fn(async () => ({})),
  patchCourseProgress: vi.fn(async () => ({})),
  deleteCourseProgress: vi.fn(async () => ({})),
  listCourseProgress: vi.fn(async () => ({ courses: [] as unknown[] })),
  listLessonProgress: vi.fn(async () => ({ lessons: [] as unknown[] })),
}));

vi.mock("../../../api/client", () => ({
  api: {
    patchLessonProgress,
    patchCourseProgress,
    deleteCourseProgress,
    listCourseProgress,
    listLessonProgress,
    // Phase 21B: completeLesson invalidates the streak after the
    // lesson PATCH resolves, which reaches into api.getUserStreak.
    // Stub it so the streak refetch is a no-op in these tests
    // (otherwise: unhandled rejection → CI failure).
    getUserStreak: () =>
      Promise.resolve({
        current: 0,
        longest: 0,
        lastActiveDate: null,
        lastFreezeUsed: null,
        isActiveToday: false,
        isAtRisk: false,
        resetAtUtc: new Date().toISOString(),
        freezeActive: false,
        wasFirstToday: false,
        freezeUsedToday: false,
      }),
  },
}));

import {
  clearSessionStarts,
  loadAllLessonProgress,
  loadSavedCode,
  useProgressStore,
} from "./progressStore";

const LEARNER = "u-1";
const COURSE = "python";
const LESSON = "hello";
const KEY = `${COURSE}/${LESSON}`;
const practiceEvidence = (requestId: string) => ({
  requestId,
  attemptCount: 2,
  hintCount: 1,
  timeSpentMs: 12_000,
  modelAssisted: false,
});

function reset(): void {
  useProgressStore.setState({
    hydrated: false,
    courseProgress: {},
    lessonProgress: {},
  });
  clearSessionStarts();
}

beforeEach(() => {
  reset();
  patchLessonProgress.mockClear();
  patchCourseProgress.mockClear();
  deleteCourseProgress.mockClear();
  listCourseProgress.mockReset();
  listLessonProgress.mockReset();
  listCourseProgress.mockResolvedValue({ courses: [] });
  listLessonProgress.mockResolvedValue({ lessons: [] });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("progressStore.hydrate", () => {
  it("populates in-memory maps from the server", async () => {
    listCourseProgress.mockResolvedValueOnce({
      courses: [
        {
          courseId: COURSE,
          status: "in_progress",
          startedAt: "t1",
          completedAt: null,
          updatedAt: "t2",
          lastLessonId: LESSON,
          completedLessonIds: ["a"],
        },
      ],
    });
    listLessonProgress.mockResolvedValueOnce({
      lessons: [
        {
          courseId: COURSE,
          lessonId: LESSON,
          status: "in_progress",
          startedAt: "t1",
          completedAt: null,
          updatedAt: "t2",
          attemptCount: 3,
          runCount: 2,
          hintCount: 1,
          timeSpentMs: 1000,
          lastCode: { "main.py": "print()" },
          lastOutput: "hi",
          practiceCompletedIds: [],
        },
      ],
    });

    await useProgressStore.getState().hydrate();

    const s = useProgressStore.getState();
    expect(s.hydrated).toBe(true);
    expect(s.courseProgress[COURSE].status).toBe("in_progress");
    expect(s.lessonProgress[KEY].attemptCount).toBe(3);
    expect(s.lessonProgress[KEY].lastCode).toEqual({ "main.py": "print()" });
  });

  it("reconciles a lagging course summary from completed lesson rows", async () => {
    listCourseProgress.mockResolvedValueOnce({
      courses: [
        {
          courseId: COURSE,
          status: "not_started",
          startedAt: null,
          completedAt: null,
          updatedAt: "t1",
          lastLessonId: null,
          completedLessonIds: [],
        },
      ],
    });
    listLessonProgress.mockResolvedValueOnce({
      lessons: [
        {
          courseId: COURSE,
          lessonId: "completed-lesson",
          status: "completed",
          startedAt: "t0",
          completedAt: "t2",
          updatedAt: "t2",
          attemptCount: 1,
          runCount: 1,
          hintCount: 0,
          timeSpentMs: 1000,
          lastCode: null,
          lastOutput: null,
          practiceCompletedIds: [],
        },
        {
          courseId: COURSE,
          lessonId: "unfinished-lesson",
          status: "in_progress",
          startedAt: "t2",
          completedAt: null,
          updatedAt: "t3",
          attemptCount: 0,
          runCount: 0,
          hintCount: 0,
          timeSpentMs: 0,
          lastCode: null,
          lastOutput: null,
          practiceCompletedIds: [],
        },
      ],
    });

    await useProgressStore.getState().hydrate();

    const course = useProgressStore.getState().courseProgress[COURSE];
    expect(course.status).toBe("in_progress");
    expect(course.startedAt).toBe("t0");
    expect(course.lastLessonId).toBe("completed-lesson");
    expect(course.completedLessonIds).toEqual(["completed-lesson"]);

    patchCourseProgress.mockClear();
    useProgressStore.getState().startLesson(LEARNER, COURSE, "next-lesson");
    expect(patchCourseProgress).toHaveBeenCalledWith(
      COURSE,
      expect.objectContaining({
        completedLessonIds: ["completed-lesson"],
        lastLessonId: "next-lesson",
      }),
    );
  });

  it("reconstructs an in-memory course when only completed lessons survived", async () => {
    listLessonProgress.mockResolvedValueOnce({
      lessons: [
        {
          courseId: COURSE,
          lessonId: LESSON,
          status: "completed",
          startedAt: "t1",
          completedAt: "t2",
          updatedAt: "t2",
          attemptCount: 1,
          runCount: 1,
          hintCount: 0,
          timeSpentMs: 1000,
          lastCode: null,
          lastOutput: null,
          practiceCompletedIds: [],
        },
      ],
    });

    await useProgressStore.getState().hydrate();

    expect(useProgressStore.getState().courseProgress[COURSE]).toEqual(
      expect.objectContaining({
        courseId: COURSE,
        status: "in_progress",
        lastLessonId: LESSON,
        completedLessonIds: [LESSON],
      }),
    );
  });

  it("leaves hydrated=false and records hydrateError when the fetch rejects", async () => {
    listCourseProgress.mockRejectedValueOnce(new Error("boom"));
    await useProgressStore.getState().hydrate();
    const s = useProgressStore.getState();
    expect(s.hydrated).toBe(false);
    expect(s.hydrateError).toBe("boom");
  });
});

describe("progressStore.reset", () => {
  it("wipes maps and clears session-start dedup", () => {
    useProgressStore.getState().startLesson(LEARNER, COURSE, LESSON);
    expect(Object.keys(useProgressStore.getState().lessonProgress)).toHaveLength(1);

    useProgressStore.getState().reset();
    const s = useProgressStore.getState();
    expect(s.hydrated).toBe(false);
    expect(s.courseProgress).toEqual({});
    expect(s.lessonProgress).toEqual({});
  });
});

describe("progressStore.startLesson", () => {
  it("creates lesson + course records (no attemptCount bump on open) and fires PATCHes", () => {
    useProgressStore.getState().startLesson(LEARNER, COURSE, LESSON);

    const lp = useProgressStore.getState().lessonProgress[KEY];
    expect(lp.status).toBe("in_progress");
    // Opening a lesson page is no longer counted as an "attempt."
    // An attempt is a Check-button press; that bump lives in
    // incrementAttempt / useLessonValidator.handleCheck.
    expect(lp.attemptCount).toBe(0);

    const cp = useProgressStore.getState().courseProgress[COURSE];
    expect(cp.status).toBe("in_progress");
    expect(cp.lastLessonId).toBe(LESSON);

    expect(patchLessonProgress).toHaveBeenCalledWith(
      COURSE,
      LESSON,
      expect.objectContaining({ status: "in_progress" }),
    );
    expect(patchCourseProgress).toHaveBeenCalledWith(
      COURSE,
      expect.objectContaining({ status: "in_progress", lastLessonId: LESSON }),
    );
  });

  it("startLesson never bumps attemptCount, even on repeated calls", () => {
    useProgressStore.getState().startLesson(LEARNER, COURSE, LESSON);
    useProgressStore.getState().startLesson(LEARNER, COURSE, LESSON);
    expect(useProgressStore.getState().lessonProgress[KEY].attemptCount).toBe(0);
  });

  it("incrementAttempt bumps the counter and skips after completion", () => {
    useProgressStore.getState().startLesson(LEARNER, COURSE, LESSON);
    useProgressStore.getState().incrementAttempt(COURSE, LESSON);
    useProgressStore.getState().incrementAttempt(COURSE, LESSON);
    expect(useProgressStore.getState().lessonProgress[KEY].attemptCount).toBe(2);
    // After completion, re-checks don't count as new attempts.
    useProgressStore.setState((s) => ({
      lessonProgress: {
        ...s.lessonProgress,
        [KEY]: { ...s.lessonProgress[KEY], status: "completed" as const },
      },
    }));
    useProgressStore.getState().incrementAttempt(COURSE, LESSON);
    expect(useProgressStore.getState().lessonProgress[KEY].attemptCount).toBe(2);
  });

  it("preserves a completed lesson's status on re-entry", () => {
    useProgressStore.setState({
      lessonProgress: {
        [KEY]: {
          learnerId: LEARNER,
          courseId: COURSE,
          lessonId: LESSON,
          status: "completed",
          startedAt: "t0",
          updatedAt: "t0",
          completedAt: "t0",
          attemptCount: 2,
          runCount: 3,
          hintCount: 0,
          lastCode: null,
          lastOutput: null,
        },
      },
    });
    useProgressStore.getState().startLesson(LEARNER, COURSE, LESSON);
    const lp = useProgressStore.getState().lessonProgress[KEY];
    expect(lp.status).toBe("completed");
    expect(lp.attemptCount).toBe(2);
  });
});

describe("progressStore.completeLesson", () => {
  it("marks lesson completed and appends to course.completedLessonIds", () => {
    useProgressStore.getState().startLesson(LEARNER, COURSE, LESSON);
    patchLessonProgress.mockClear();
    patchCourseProgress.mockClear();

    useProgressStore.getState().completeLesson(LEARNER, COURSE, LESSON, 3);

    const lp = useProgressStore.getState().lessonProgress[KEY];
    expect(lp.status).toBe("completed");
    expect(lp.completedAt).toBeTruthy();

    const cp = useProgressStore.getState().courseProgress[COURSE];
    expect(cp.completedLessonIds).toEqual([LESSON]);
    expect(cp.status).toBe("in_progress");

    expect(patchLessonProgress).toHaveBeenCalledWith(
      COURSE,
      LESSON,
      expect.objectContaining({ status: "completed" }),
    );
  });

  it("flips course to completed when the final lesson lands", () => {
    useProgressStore.getState().completeLesson(LEARNER, COURSE, "a", 2);
    useProgressStore.getState().completeLesson(LEARNER, COURSE, "b", 2);
    const cp = useProgressStore.getState().courseProgress[COURSE];
    expect(cp.status).toBe("completed");
    expect(cp.completedAt).toBeTruthy();
  });
});

describe("progressStore counters", () => {
  beforeEach(() => {
    useProgressStore.getState().startLesson(LEARNER, COURSE, LESSON);
    patchLessonProgress.mockClear();
  });

  it("incrementRun bumps runCount and patches", () => {
    useProgressStore.getState().incrementRun(COURSE, LESSON);
    useProgressStore.getState().incrementRun(COURSE, LESSON);
    expect(useProgressStore.getState().lessonProgress[KEY].runCount).toBe(2);
    expect(patchLessonProgress).toHaveBeenLastCalledWith(
      COURSE,
      LESSON,
      { runCount: 2 },
    );
  });

  it("incrementHint bumps hintCount and patches", () => {
    useProgressStore.getState().incrementHint(COURSE, LESSON);
    expect(useProgressStore.getState().lessonProgress[KEY].hintCount).toBe(1);
    expect(patchLessonProgress).toHaveBeenLastCalledWith(
      COURSE,
      LESSON,
      { hintCount: 1 },
    );
  });

  it("incrementLessonTime accumulates and ignores non-positive deltas", () => {
    useProgressStore.getState().incrementLessonTime(COURSE, LESSON, 5_000);
    useProgressStore.getState().incrementLessonTime(COURSE, LESSON, 0);
    useProgressStore.getState().incrementLessonTime(COURSE, LESSON, -10);
    useProgressStore.getState().incrementLessonTime(COURSE, LESSON, 2_500);
    expect(useProgressStore.getState().lessonProgress[KEY].timeSpentMs).toBe(7_500);
  });
});

describe("progressStore.saveCode / saveOutput", () => {
  beforeEach(() => {
    useProgressStore.getState().startLesson(LEARNER, COURSE, LESSON);
    patchLessonProgress.mockClear();
  });

  it("saveCode stores the files map and patches lastCode", () => {
    const code = { "main.py": "print('hi')" };
    useProgressStore.getState().saveCode(COURSE, LESSON, code);
    expect(useProgressStore.getState().lessonProgress[KEY].lastCode).toEqual(code);
    expect(patchLessonProgress).toHaveBeenLastCalledWith(
      COURSE,
      LESSON,
      { lastCode: code },
    );
    expect(loadSavedCode(COURSE, LESSON)).toEqual(code);
  });

  it("saveOutput stores the output and patches", () => {
    useProgressStore.getState().saveOutput(COURSE, LESSON, "ok\n");
    expect(useProgressStore.getState().lessonProgress[KEY].lastOutput).toBe("ok\n");
    expect(patchLessonProgress).toHaveBeenLastCalledWith(
      COURSE,
      LESSON,
      { lastOutput: "ok\n" },
    );
  });
});

describe("progressStore practice", () => {
  beforeEach(() => {
    useProgressStore.getState().startLesson(LEARNER, COURSE, LESSON);
    patchLessonProgress.mockClear();
  });

  it("completePracticeExercise appends unique ids and persists bounded evidence", async () => {
    await useProgressStore.getState().completePracticeExercise(
      COURSE,
      LESSON,
      "ex-1",
      practiceEvidence("00000000-0000-4000-8000-000000000001"),
    );
    await useProgressStore.getState().completePracticeExercise(
      COURSE,
      LESSON,
      "ex-2",
      practiceEvidence("00000000-0000-4000-8000-000000000002"),
    );
    await useProgressStore.getState().completePracticeExercise(
      COURSE,
      LESSON,
      "ex-1",
      practiceEvidence("00000000-0000-4000-8000-000000000003"),
    );
    const lp = useProgressStore.getState().lessonProgress[KEY];
    expect(lp.practiceCompletedIds).toEqual(["ex-1", "ex-2"]);
    expect(patchLessonProgress).toHaveBeenCalledTimes(2);
    expect(patchLessonProgress).toHaveBeenCalledWith(
      COURSE,
      LESSON,
      expect.objectContaining({
        practiceCompletedIds: ["ex-1"],
        practiceEvidence: expect.objectContaining({
          exerciseId: "ex-1",
          attemptCount: 2,
        }),
      }),
    );
  });

  it("resetPracticeProgress empties the list and patches", async () => {
    await useProgressStore.getState().completePracticeExercise(
      COURSE,
      LESSON,
      "ex-1",
      practiceEvidence("00000000-0000-4000-8000-000000000004"),
    );
    patchLessonProgress.mockClear();
    useProgressStore.getState().resetPracticeProgress(COURSE, LESSON);
    expect(useProgressStore.getState().lessonProgress[KEY].practiceCompletedIds).toEqual([]);
    expect(patchLessonProgress).toHaveBeenLastCalledWith(
      COURSE,
      LESSON,
      { practiceCompletedIds: [], practiceExerciseCode: {} },
    );
  });

  it("rolls back optimistic completion when the evidence write fails", async () => {
    patchLessonProgress.mockRejectedValueOnce(new Error("offline"));
    const recorded = await useProgressStore.getState().completePracticeExercise(
      COURSE,
      LESSON,
      "ex-1",
      practiceEvidence("00000000-0000-4000-8000-000000000005"),
    );

    expect(recorded).toBe(false);
    expect(
      useProgressStore.getState().lessonProgress[KEY].practiceCompletedIds,
    ).toEqual([]);
  });
});

describe("progressStore.resetLessonProgress", () => {
  it("drops the lesson in-memory and zeros out the server row", () => {
    useProgressStore.getState().startLesson(LEARNER, COURSE, LESSON);
    useProgressStore.getState().completeLesson(LEARNER, COURSE, LESSON, 2);
    patchLessonProgress.mockClear();
    patchCourseProgress.mockClear();

    useProgressStore.getState().resetLessonProgress(LEARNER, COURSE, LESSON);

    expect(useProgressStore.getState().lessonProgress[KEY]).toBeUndefined();
    expect(useProgressStore.getState().courseProgress[COURSE].completedLessonIds).toEqual([]);
    expect(patchLessonProgress).toHaveBeenCalledWith(
      COURSE,
      LESSON,
      expect.objectContaining({ status: "not_started", attemptCount: 0 }),
    );
    expect(patchCourseProgress).toHaveBeenCalledWith(
      COURSE,
      expect.objectContaining({ completedLessonIds: [] }),
    );
  });
});

describe("progressStore.resetCourseProgress", () => {
  it("wipes lessons + course in-memory and calls DELETE", () => {
    useProgressStore.getState().startLesson(LEARNER, COURSE, "a");
    useProgressStore.getState().startLesson(LEARNER, COURSE, "b");

    useProgressStore.getState().resetCourseProgress(LEARNER, COURSE, ["a", "b"]);

    const s = useProgressStore.getState();
    expect(s.lessonProgress[`${COURSE}/a`]).toBeUndefined();
    expect(s.lessonProgress[`${COURSE}/b`]).toBeUndefined();
    expect(s.courseProgress[COURSE].status).toBe("not_started");
    expect(deleteCourseProgress).toHaveBeenCalledWith(COURSE);
  });
});

describe("progressStore read helpers", () => {
  it("loadSavedCode returns null when nothing is stored", () => {
    expect(loadSavedCode(COURSE, LESSON)).toBeNull();
  });

  it("loadAllLessonProgress filters to the requested ids", () => {
    useProgressStore.getState().startLesson(LEARNER, COURSE, "a");
    useProgressStore.getState().startLesson(LEARNER, COURSE, "c");
    const rows = loadAllLessonProgress(COURSE, ["a", "b", "c"]);
    expect(rows.map((r) => r.lessonId).sort()).toEqual(["a", "c"]);
  });
});
