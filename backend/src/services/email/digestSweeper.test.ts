import { describe, expect, it, beforeEach, vi } from "vitest";

// Phase 22D: digest sweeper contract tests.
//
// We mock the database client + streakNudge.sendStreakNudge + the
// markStreakNudgeSent setter so this exercises ONLY the orchestration
// layer (kill switches, eligibility query result handling, idempotency
// marker, per-user failure isolation, scheduling math).

// vi.mock is hoisted above any top-level statements in the file, so the
// mock fns it references must come from `vi.hoisted` to be accessible
// at the moment the factories run. Without this, the mocked-module
// factory throws "Cannot access 'mockDb' before initialization".
const mocks = vi.hoisted(() => ({
  sqlUnsafe: vi.fn(),
  markStreakNudgeSent: vi.fn(),
  sendStreakNudge: vi.fn(),
}));
const mockSqlUnsafe = mocks.sqlUnsafe;
const mockMarkStreakNudgeSent = mocks.markStreakNudgeSent;
const mockSendStreakNudge = mocks.sendStreakNudge;

vi.mock("../../db/client.js", () => ({
  db: () => ({ unsafe: mocks.sqlUnsafe }),
}));
vi.mock("../../db/preferences.js", () => ({
  markStreakNudgeSent: mocks.markStreakNudgeSent,
}));
vi.mock("./streakNudge.js", () => ({
  sendStreakNudge: mocks.sendStreakNudge,
}));

vi.mock("../../config.js", () => ({
  config: {
    email: {
      acsConnectionString: "endpoint=x;accesskey=y",
      unsubscribeSecret: "test-secret",
      streakNudgeDisabled: false,
      // Phase 23 P1 #1: bounded parallelism. Tests want predictable
      // ordering / single-call assertions, so concurrency=1 keeps the
      // sweep effectively sequential. Real prod default is 3.
      digestSweepConcurrency: 1,
    },
  },
}));

import { config } from "../../config.js";
import {
  _resetDigestSweeperForTests,
  _testHelpers,
  runDigestSweepOnce,
} from "./digestSweeper.js";

beforeEach(() => {
  _resetDigestSweeperForTests();
  mockSqlUnsafe.mockReset();
  mockMarkStreakNudgeSent.mockReset();
  mockSendStreakNudge.mockReset();
  // Default config = configured + enabled. Individual tests override.
  // @ts-expect-error mutate
  config.email.acsConnectionString = "endpoint=x;accesskey=y";
  // @ts-expect-error mutate
  config.email.unsubscribeSecret = "test-secret";
  // @ts-expect-error mutate
  config.email.streakNudgeDisabled = false;
});

const sampleRow = {
  user_id: "u-1",
  email: "u1@test.dev",
  first_name: "Ada",
  current_streak: 3,
  last_course_id: "python-fundamentals",
  last_lesson_id: "loops",
};

describe("runDigestSweepOnce — kill switches", () => {
  it("noops when STREAK_NUDGE_DISABLED is set", async () => {
    // @ts-expect-error mutate
    config.email.streakNudgeDisabled = true;
    const r = await runDigestSweepOnce();
    expect(r).toEqual({ attempted: 0, succeeded: 0, failed: 0 });
    expect(mockSqlUnsafe).not.toHaveBeenCalled();
  });

  it("noops when ACS_CONNECTION_STRING is empty (dev / first boot)", async () => {
    // @ts-expect-error mutate
    config.email.acsConnectionString = "";
    const r = await runDigestSweepOnce();
    expect(r).toEqual({ attempted: 0, succeeded: 0, failed: 0 });
    expect(mockSqlUnsafe).not.toHaveBeenCalled();
  });

  it("noops when EMAIL_UNSUBSCRIBE_SECRET is empty (CAN-SPAM floor)", async () => {
    // @ts-expect-error mutate
    config.email.unsubscribeSecret = "";
    const r = await runDigestSweepOnce();
    expect(r).toEqual({ attempted: 0, succeeded: 0, failed: 0 });
    expect(mockSqlUnsafe).not.toHaveBeenCalled();
  });
});

describe("runDigestSweepOnce — happy path", () => {
  it("sends + marks each eligible user", async () => {
    mockSqlUnsafe.mockResolvedValueOnce([
      sampleRow,
      { ...sampleRow, user_id: "u-2", email: "u2@test.dev" },
    ]);
    mockSendStreakNudge.mockResolvedValue({
      id: "op-1",
      deepLink: "x",
      unsubscribeUrl: "y",
    });
    const r = await runDigestSweepOnce();
    expect(r).toEqual({ attempted: 2, succeeded: 2, failed: 0 });
    expect(mockSendStreakNudge).toHaveBeenCalledTimes(2);
    expect(mockMarkStreakNudgeSent).toHaveBeenCalledTimes(2);
    expect(mockMarkStreakNudgeSent).toHaveBeenCalledWith("u-1");
    expect(mockMarkStreakNudgeSent).toHaveBeenCalledWith("u-2");
  });

  it("forwards SweepRow fields into sendStreakNudge unchanged", async () => {
    mockSqlUnsafe.mockResolvedValueOnce([sampleRow]);
    mockSendStreakNudge.mockResolvedValue({
      id: "op-1",
      deepLink: "x",
      unsubscribeUrl: "y",
    });
    await runDigestSweepOnce();
    expect(mockSendStreakNudge).toHaveBeenCalledWith({
      email: "u1@test.dev",
      userId: "u-1",
      firstName: "Ada",
      currentStreak: 3,
      lastCourseId: "python-fundamentals",
      lastLessonId: "loops",
    });
  });
});

describe("runDigestSweepOnce — failure isolation", () => {
  it("a per-user send failure does NOT mark that user (tomorrow retries)", async () => {
    mockSqlUnsafe.mockResolvedValueOnce([sampleRow]);
    mockSendStreakNudge.mockRejectedValueOnce(new Error("ACS 500"));
    const r = await runDigestSweepOnce();
    expect(r).toEqual({ attempted: 1, succeeded: 0, failed: 1 });
    expect(mockMarkStreakNudgeSent).not.toHaveBeenCalled();
  });

  it("one user's failure doesn't stop the loop for others", async () => {
    mockSqlUnsafe.mockResolvedValueOnce([
      sampleRow,
      { ...sampleRow, user_id: "u-2", email: "u2@test.dev" },
      { ...sampleRow, user_id: "u-3", email: "u3@test.dev" },
    ]);
    mockSendStreakNudge
      .mockResolvedValueOnce({ id: "op-1", deepLink: "x", unsubscribeUrl: "y" })
      .mockRejectedValueOnce(new Error("ACS 500"))
      .mockResolvedValueOnce({ id: "op-3", deepLink: "x", unsubscribeUrl: "y" });
    const r = await runDigestSweepOnce();
    expect(r).toEqual({ attempted: 3, succeeded: 2, failed: 1 });
    expect(mockMarkStreakNudgeSent).toHaveBeenCalledTimes(2);
    expect(mockMarkStreakNudgeSent).toHaveBeenCalledWith("u-1");
    expect(mockMarkStreakNudgeSent).toHaveBeenCalledWith("u-3");
    // u-2 NOT marked
    expect(mockMarkStreakNudgeSent).not.toHaveBeenCalledWith("u-2");
  });

  it("eligibility-query failure noops with attempted=0", async () => {
    mockSqlUnsafe.mockRejectedValueOnce(new Error("DB down"));
    const r = await runDigestSweepOnce();
    expect(r).toEqual({ attempted: 0, succeeded: 0, failed: 0 });
    expect(mockSendStreakNudge).not.toHaveBeenCalled();
  });
});

describe("runDigestSweepOnce — re-entrancy guard", () => {
  it("a second concurrent invocation noops while the first is in-flight", async () => {
    mockSqlUnsafe.mockResolvedValueOnce([sampleRow]);
    let release: (v: { id: string; deepLink: string; unsubscribeUrl: string }) => void = () => {};
    mockSendStreakNudge.mockReturnValueOnce(
      new Promise((res) => {
        release = res;
      }),
    );
    const first = runDigestSweepOnce();
    // Don't await first yet — kick off a second call that should noop.
    const second = await runDigestSweepOnce();
    expect(second).toEqual({ attempted: 0, succeeded: 0, failed: 0 });
    release({ id: "op-1", deepLink: "x", unsubscribeUrl: "y" });
    await first;
  });
});

describe("nextFireTime / shouldCatchUpOnBoot — timing math", () => {
  it("nextFireTime returns TODAY at 18:00 UTC when called before 18 UTC", () => {
    // 2026-04-28 14:00 UTC — before today's window
    const now = new Date(Date.UTC(2026, 3, 28, 14, 0, 0));
    const next = _testHelpers.nextFireTime(now);
    expect(next.toISOString()).toBe("2026-04-28T18:00:00.000Z");
  });

  it("nextFireTime returns TOMORROW at 18:00 UTC when called at exactly 18 UTC", () => {
    // 2026-04-28 18:00 UTC — at-or-past treats as "today's window passed"
    const now = new Date(Date.UTC(2026, 3, 28, 18, 0, 0));
    const next = _testHelpers.nextFireTime(now);
    expect(next.toISOString()).toBe("2026-04-29T18:00:00.000Z");
  });

  it("nextFireTime returns TOMORROW at 18:00 UTC when called after 18 UTC", () => {
    const now = new Date(Date.UTC(2026, 3, 28, 19, 30, 0));
    const next = _testHelpers.nextFireTime(now);
    expect(next.toISOString()).toBe("2026-04-29T18:00:00.000Z");
  });

  it("shouldCatchUpOnBoot is false when before today's window", () => {
    const now = new Date(Date.UTC(2026, 3, 28, 17, 59, 59));
    expect(_testHelpers.shouldCatchUpOnBoot(now)).toBe(false);
  });

  it("shouldCatchUpOnBoot is true at exactly 18 UTC", () => {
    const now = new Date(Date.UTC(2026, 3, 28, 18, 0, 0));
    expect(_testHelpers.shouldCatchUpOnBoot(now)).toBe(true);
  });

  it("shouldCatchUpOnBoot is true after today's window", () => {
    const now = new Date(Date.UTC(2026, 3, 28, 23, 59, 59));
    expect(_testHelpers.shouldCatchUpOnBoot(now)).toBe(true);
  });
});
