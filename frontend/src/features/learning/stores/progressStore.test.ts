import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Phase 18b: progressStore is now a thin wrapper over the backend user-data
// API. Tests mock `api` and assert that (a) optimistic in-memory state
// updates are correct and (b) the right PATCH/DELETE calls fire.

const {
  patchLessonProgress,
  patchCourseProgress,
  deleteCourseProgress,
  resetLessonProgress,
  listCourseProgress,
  listLessonProgress,
  resetPracticeProgress,
  saveLessonDraft,
} = vi.hoisted(() => ({
  patchLessonProgress: vi.fn(),
  patchCourseProgress: vi.fn(),
  deleteCourseProgress: vi.fn(async () => ({})),
  resetLessonProgress: vi.fn(),
  listCourseProgress: vi.fn(async () => ({ courses: [] as unknown[] })),
  listLessonProgress: vi.fn(async () => ({ lessons: [] as unknown[] })),
  resetPracticeProgress: vi.fn(),
  saveLessonDraft: vi.fn(),
}));

vi.mock("../../../api/client", () => ({
  api: {
    patchLessonProgress,
    patchCourseProgress,
    deleteCourseProgress,
    resetLessonProgress,
    listCourseProgress,
    listLessonProgress,
    resetPracticeProgress,
    saveLessonDraft,
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
  patchCourseProgress.mockReset();
  deleteCourseProgress.mockClear();
  resetLessonProgress.mockReset();
  resetPracticeProgress.mockReset();
  saveLessonDraft.mockReset();
  listCourseProgress.mockReset();
  listLessonProgress.mockReset();
  listCourseProgress.mockResolvedValue({ courses: [] });
  listLessonProgress.mockResolvedValue({ lessons: [] });
  patchLessonProgress.mockImplementation(
    async (courseId: string, lessonId: string, body: Record<string, unknown>) => ({
      courseId,
      lessonId,
      status: body.status ?? "in_progress",
      startedAt: body.startedAt ?? "t1",
      completedAt: body.completedAt ?? null,
      updatedAt: "t2",
      attemptCount: 0,
      runCount: 0,
      hintCount: 0,
      timeSpentMs: 0,
      lastCode: null,
      draftRevision: 0,
      draftWriterId: null,
      draftUpdatedAt: null,
      lastOutput: null,
      practiceCompletedIds: body.practiceCompletedIds ?? [],
      practiceExerciseCode: body.practiceExerciseCode ?? {},
    }),
  );
  patchCourseProgress.mockImplementation(
    async (courseId: string, body: Record<string, unknown>) => ({
      courseId,
      status: body.status ?? "in_progress",
      startedAt: body.startedAt ?? "t1",
      completedAt: body.completedAt ?? null,
      updatedAt: "t2",
      lastLessonId: body.lastLessonId ?? null,
      completedLessonIds: body.completedLessonIds ?? [],
    }),
  );
  saveLessonDraft.mockImplementation(
    async (_courseId: string, _lessonId: string, body: Record<string, unknown>) => ({
      courseId: COURSE,
      lessonId: LESSON,
      status: "in_progress",
      startedAt: "t1",
      completedAt: null,
      updatedAt: "t2",
      attemptCount: 0,
      runCount: 0,
      hintCount: 0,
      timeSpentMs: 0,
      lastCode: body.code,
      draftRevision: 1,
      draftWriterId: body.writerId,
      draftUpdatedAt: "t2",
      lastOutput: null,
      practiceCompletedIds: [],
      practiceExerciseCode: {},
    }),
  );
  resetPracticeProgress.mockResolvedValue({
    courseId: COURSE,
    lessonId: LESSON,
    status: "in_progress",
    startedAt: "t1",
    completedAt: null,
    updatedAt: "t2",
    attemptCount: 0,
    runCount: 0,
    hintCount: 0,
    timeSpentMs: 0,
    lastCode: null,
    draftRevision: 0,
    draftWriterId: null,
    draftUpdatedAt: null,
    lastOutput: null,
    practiceCompletedIds: [],
    practiceExerciseCode: {},
  });
  resetLessonProgress.mockResolvedValue({
    reset: {
      courseId: COURSE,
      lessonId: LESSON,
      status: "not_started",
      startedAt: null,
      completedAt: null,
      updatedAt: "t2",
      attemptCount: 0,
      runCount: 0,
      hintCount: 0,
      timeSpentMs: 0,
      lastCode: null,
      draftRevision: 2,
      draftWriterId: null,
      draftUpdatedAt: "t2",
      lastOutput: null,
      practiceCompletedIds: [],
      practiceExerciseCode: {},
    },
    course: {
      courseId: COURSE,
      status: "not_started",
      startedAt: null,
      completedAt: null,
      updatedAt: "t2",
      lastLessonId: null,
      completedLessonIds: [],
    },
  });
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
  it("marks lesson completed and appends to course.completedLessonIds", async () => {
    useProgressStore.getState().startLesson(LEARNER, COURSE, LESSON);
    patchLessonProgress.mockClear();
    patchCourseProgress.mockClear();

    await useProgressStore.getState().completeLesson(LEARNER, COURSE, LESSON, 3);

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

  it("flips course to completed when the final lesson lands", async () => {
    await useProgressStore.getState().completeLesson(LEARNER, COURSE, "a", 2);
    await useProgressStore.getState().completeLesson(LEARNER, COURSE, "b", 2);
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

  it("saveCode stores the files map with a revisioned draft write", async () => {
    const code = { "main.py": "print('hi')" };
    await useProgressStore.getState().saveCode(COURSE, LESSON, code);
    expect(useProgressStore.getState().lessonProgress[KEY].lastCode).toEqual(code);
    expect(saveLessonDraft).toHaveBeenLastCalledWith(
      COURSE,
      LESSON,
      expect.objectContaining({ code, expectedRevision: 0 }),
    );
    expect(loadSavedCode(COURSE, LESSON)).toEqual(code);
  });

  it("keeps an offline draft visible and clears the warning after retry", async () => {
    const code = { "main.py": "print('offline but safe')" };
    saveLessonDraft.mockRejectedValueOnce(new Error("offline"));

    await useProgressStore.getState().saveCode(COURSE, LESSON, code);
    expect(useProgressStore.getState().lessonProgress[KEY].lastCode).toEqual(code);
    expect(useProgressStore.getState().draftSaveErrors[KEY]).toMatch(/not synced/i);

    await useProgressStore.getState().retryDraftSave(COURSE, LESSON);
    expect(useProgressStore.getState().draftSaveErrors[KEY]).toBeUndefined();
    expect(saveLessonDraft).toHaveBeenLastCalledWith(
      COURSE,
      LESSON,
      expect.objectContaining({ code, expectedRevision: 0 }),
    );
  });

  it("keeps the chosen local copy through a conflict resolution write", async () => {
    const localCode = { "main.py": "print('keep me')" };
    useProgressStore.setState((state) => ({
      draftConflicts: {
        ...state.draftConflicts,
        [KEY]: {
          courseId: COURSE,
          lessonId: LESSON,
          localCode,
          remoteCode: { "main.py": "print('remote')" },
          remoteRevision: 4,
          remoteWriterId: "other-tab",
          remoteUpdatedAt: "t4",
        },
      },
    }));

    await expect(
      useProgressStore.getState().keepLocalDraft(COURSE, LESSON),
    ).resolves.toBe(true);

    expect(saveLessonDraft).toHaveBeenLastCalledWith(
      COURSE,
      LESSON,
      expect.objectContaining({ code: localCode, expectedRevision: 4 }),
    );
    expect(useProgressStore.getState().draftConflicts[KEY]).toBeUndefined();
    expect(useProgressStore.getState().lessonProgress[KEY].lastCode).toEqual(localCode);
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
    await useProgressStore.getState().resetPracticeProgress(COURSE, LESSON);
    expect(useProgressStore.getState().lessonProgress[KEY].practiceCompletedIds).toEqual([]);
    expect(resetPracticeProgress).toHaveBeenLastCalledWith(COURSE, LESSON);
  });

  it("does not celebrate completion when the evidence write fails", async () => {
    patchLessonProgress.mockRejectedValueOnce(new Error("offline"));
    await expect(
      useProgressStore.getState().completePracticeExercise(
        COURSE,
        LESSON,
        "ex-1",
        practiceEvidence("00000000-0000-4000-8000-000000000005"),
      ),
    ).rejects.toThrow("offline");

    expect(
      useProgressStore.getState().lessonProgress[KEY].practiceCompletedIds,
    ).toEqual([]);
  });
});

describe("progressStore.resetLessonProgress", () => {
  it("applies the durable reset and discards an obsolete draft conflict", async () => {
    useProgressStore.getState().startLesson(LEARNER, COURSE, LESSON);
    await useProgressStore.getState().completeLesson(LEARNER, COURSE, LESSON, 2);
    useProgressStore.setState({
      draftConflicts: {
        [KEY]: {
          courseId: COURSE,
          lessonId: LESSON,
          localCode: { "main.py": "local" },
          remoteCode: { "main.py": "remote" },
          remoteRevision: 1,
          remoteWriterId: null,
          remoteUpdatedAt: null,
        },
      },
    });
    patchLessonProgress.mockClear();
    patchCourseProgress.mockClear();

    await useProgressStore.getState().resetLessonProgress(LEARNER, COURSE, LESSON);

    expect(useProgressStore.getState().lessonProgress[KEY]).toMatchObject({
      status: "not_started",
      lastCode: null,
      draftRevision: 2,
    });
    expect(useProgressStore.getState().courseProgress[COURSE].completedLessonIds).toEqual([]);
    expect(useProgressStore.getState().draftConflicts[KEY]).toBeUndefined();
    expect(resetLessonProgress).toHaveBeenCalledWith(COURSE, LESSON);
    expect(patchCourseProgress).not.toHaveBeenCalled();
  });
});

describe("progressStore.resetCourseProgress", () => {
  it("wipes lessons + course in-memory only after the server reset", async () => {
    useProgressStore.getState().startLesson(LEARNER, COURSE, "a");
    useProgressStore.getState().startLesson(LEARNER, COURSE, "b");
    useProgressStore.setState({
      draftConflicts: Object.fromEntries(
        ["a", "b"].map((lessonId) => [
          `${COURSE}/${lessonId}`,
          {
            courseId: COURSE,
            lessonId,
            localCode: { "main.py": "local" },
            remoteCode: { "main.py": "remote" },
            remoteRevision: 1,
            remoteWriterId: null,
            remoteUpdatedAt: null,
          },
        ]),
      ),
    });

    await useProgressStore.getState().resetCourseProgress(LEARNER, COURSE, ["a", "b"]);

    const s = useProgressStore.getState();
    expect(s.lessonProgress[`${COURSE}/a`]).toBeUndefined();
    expect(s.lessonProgress[`${COURSE}/b`]).toBeUndefined();
    expect(s.courseProgress[COURSE].status).toBe("not_started");
    expect(s.draftConflicts[`${COURSE}/a`]).toBeUndefined();
    expect(s.draftConflicts[`${COURSE}/b`]).toBeUndefined();
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
