// Phase 20-P4: credential resolver coverage. Mocks the three DB touchpoints
// (BYOK lookup, denylist, ledger aggregates) so the test can exercise every
// resolution branch without a real postgres. The cache invalidation helper
// resets module state between specs.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../config.js", () => ({
  config: {
    freeTier: {
      enabled: true,
      dailyQuestions: 30,
      dailyUsdPerUser: 0.10,
      lifetimeUsdPerUser: 1.0,
      dailyUsdCap: 2.0,
      platformOpenaiApiKey: "sk-platform-test",
    },
  },
}));

vi.mock("../../db/preferences.js", () => ({
  getOpenAIKey: vi.fn(async () => null),
}));

vi.mock("../../db/denylist.js", () => ({
  isDenylisted: vi.fn(async () => false),
}));

vi.mock("../../db/usageLedger.js", () => ({
  startOfUtcDay: () => {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    return d;
  },
  countPlatformQuestionsToday: vi.fn(async () => 0),
  countPlatformQuestionsTodayLocked: vi.fn(async () => 0),
  sumPlatformCostTodayForUser: vi.fn(async () => 0),
  sumPlatformCostLifetimeForUser: vi.fn(async () => 0),
  sumPlatformCostTodayGlobal: vi.fn(async () => 0),
}));

const { getOpenAIKey } = await import("../../db/preferences.js");
const { isDenylisted } = await import("../../db/denylist.js");
const ledger = await import("../../db/usageLedger.js");
const {
  resolveAICredential,
  markPlatformAuthFailed,
  __resetCredentialCachesForTests,
} = await import("./credential.js");

beforeEach(() => {
  __resetCredentialCachesForTests();
  vi.mocked(getOpenAIKey).mockReset().mockResolvedValue(null);
  vi.mocked(isDenylisted).mockReset().mockResolvedValue(false);
  vi.mocked(ledger.countPlatformQuestionsToday).mockReset().mockResolvedValue(0);
  vi.mocked(ledger.countPlatformQuestionsTodayLocked).mockReset().mockResolvedValue(0);
  vi.mocked(ledger.sumPlatformCostTodayForUser).mockReset().mockResolvedValue(0);
  vi.mocked(ledger.sumPlatformCostLifetimeForUser).mockReset().mockResolvedValue(0);
  vi.mocked(ledger.sumPlatformCostTodayGlobal).mockReset().mockResolvedValue(0);
});

describe("resolveAICredential", () => {
  it("L0 BYOK: returns byok source when the user has a stored key", async () => {
    vi.mocked(getOpenAIKey).mockResolvedValueOnce("sk-byok-abc");
    const c = await resolveAICredential("u-1");
    expect(c.source).toBe("byok");
    if (c.source === "byok") expect(c.key).toBe("sk-byok-abc");
  });

  it("L5 denylist: platform route blocked, reason=denylisted", async () => {
    vi.mocked(isDenylisted).mockResolvedValueOnce(true);
    const c = await resolveAICredential("u-1");
    expect(c.source).toBe("none");
    if (c.source === "none") expect(c.reason).toBe("denylisted");
  });

  it("L5 denylist + BYOK: BYOK always wins, denylist never checked", async () => {
    // Even a denylisted user can recover by pasting their own key — that's
    // the escape hatch the plan calls out explicitly.
    vi.mocked(getOpenAIKey).mockResolvedValueOnce("sk-byok-self-paid");
    vi.mocked(isDenylisted).mockResolvedValueOnce(true);
    const c = await resolveAICredential("u-1");
    expect(c.source).toBe("byok");
  });

  it("L4 global $ cap: all users locked out once global daily spend hits the cap", async () => {
    vi.mocked(ledger.sumPlatformCostTodayGlobal).mockResolvedValueOnce(2.0);
    const c = await resolveAICredential("u-1");
    expect(c.source).toBe("none");
    if (c.source === "none") expect(c.reason).toBe("usd_cap_hit");
  });

  it("L3 lifetime $ per user: one user locked out but doesn't affect others", async () => {
    vi.mocked(ledger.sumPlatformCostLifetimeForUser).mockResolvedValueOnce(1.0);
    const c = await resolveAICredential("u-1");
    expect(c.source).toBe("none");
    if (c.source === "none") expect(c.reason).toBe("lifetime_usd_per_user_hit");
  });

  it("L2 daily $ per user: trips before the question counter if an abuse path mints cost without counting", async () => {
    vi.mocked(ledger.sumPlatformCostTodayForUser).mockResolvedValueOnce(0.10);
    const c = await resolveAICredential("u-1");
    expect(c.source).toBe("none");
    if (c.source === "none") expect(c.reason).toBe("daily_usd_per_user_hit");
  });

  it("L1 free_exhausted: user past the daily question counter", async () => {
    vi.mocked(ledger.countPlatformQuestionsTodayLocked).mockResolvedValueOnce(30);
    const c = await resolveAICredential("u-1");
    expect(c.source).toBe("none");
    if (c.source === "none") expect(c.reason).toBe("free_exhausted");
  });

  it("success: returns platform source with remainingToday computed from questions", async () => {
    vi.mocked(ledger.countPlatformQuestionsTodayLocked).mockResolvedValueOnce(3);
    const c = await resolveAICredential("u-1");
    expect(c.source).toBe("platform");
    if (c.source === "platform") {
      expect(c.remainingToday).toBe(27);
      expect(c.capToday).toBe(30);
      expect(c.allowedModels).toEqual(["gpt-4.1-nano"]);
      expect(c.key).toBe("sk-platform-test");
      expect(c.resetAtUtc).toBeInstanceOf(Date);
    }
  });

  it("provider auth failure short-circuits until test-only reset", async () => {
    markPlatformAuthFailed();
    const c = await resolveAICredential("u-1");
    expect(c.source).toBe("none");
    if (c.source === "none") expect(c.reason).toBe("provider_auth_failed");
  });
});

describe("UTC day rollover", () => {
  // Audit gap #6 (hazy-wishing-wren bucket 10): when wall-clock crosses
  // midnight UTC the daily counter must reset cleanly — the ledger is
  // queried with the NEW dayStart, not a module-cached stale one. A
  // regression here would either (a) let a user skip the cap by waiting
  // for midnight + getting the stale `dayStart` anyway, or (b) keep the
  // cap tripped into a new day. We can't mess with the real ledger from
  // a unit test, so we fake the wall clock with vi.setSystemTime and mock
  // the count-by-`since` branch to simulate "yesterday had 30 rows,
  // today has 0".

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resetAtUtc on an exhausted user at 23:59:30Z points at the next midnight", async () => {
    vi.setSystemTime(new Date("2026-04-22T23:59:30Z"));
    vi.mocked(ledger.countPlatformQuestionsTodayLocked).mockResolvedValueOnce(30);
    const c = await resolveAICredential("u-1");
    expect(c.source).toBe("none");
    if (c.source === "none") {
      expect(c.reason).toBe("free_exhausted");
      // resetAtUtc is endOfUtcDay(startOfUtcDay(now)) → 2026-04-23 00:00:00Z.
      expect(c.resetAtUtc?.toISOString()).toBe("2026-04-23T00:00:00.000Z");
    }
  });

  it("crossing midnight UTC re-reads ledger with the new dayStart; exhausted → fresh", async () => {
    // Drive the ledger mock off the `since` arg so the same state transition
    // that would happen in postgres (created_at >= new dayStart → 0 rows)
    // happens here: yesterday counts 30, today counts 0.
    vi.mocked(ledger.countPlatformQuestionsTodayLocked).mockImplementation(
      async (_userId, since) => {
        const day = since.toISOString().slice(0, 10);
        if (day === "2026-04-22") return 30;
        if (day === "2026-04-23") return 0;
        return 0;
      },
    );

    vi.setSystemTime(new Date("2026-04-22T23:59:59Z"));
    const before = await resolveAICredential("u-1");
    expect(before.source).toBe("none");
    if (before.source === "none") expect(before.reason).toBe("free_exhausted");

    // Tick past midnight. Invalidate the $ caches to mirror what
    // invalidateUsageCaches() does post-write — the rollover test is
    // about L1, not the L2/L3/L4 60s TTL behavior.
    __resetCredentialCachesForTests();
    vi.setSystemTime(new Date("2026-04-23T00:01:00Z"));

    const after = await resolveAICredential("u-1");
    expect(after.source).toBe("platform");
    if (after.source === "platform") {
      expect(after.remainingToday).toBe(30);
      expect(after.capToday).toBe(30);
      // New resetAtUtc is the following midnight (Apr 24), proving the
      // resolver picked up the new dayStart.
      expect(after.resetAtUtc.toISOString()).toBe("2026-04-24T00:00:00.000Z");
    }
  });

  it("user clock manipulation can't bypass the cap — the query `since` is derived live each call", async () => {
    // Belt-and-suspenders: if a learner spoofs their device clock forward,
    // the backend still uses its own wall clock. Simulate: we call the
    // resolver twice within the same UTC day (23:00 then 23:05); both calls
    // must pass the SAME dayStart to the ledger. Regression would be reading
    // a client-supplied timestamp or caching `dayStart` at a stale earlier
    // value.
    const sinceArgs: string[] = [];
    vi.mocked(ledger.countPlatformQuestionsTodayLocked).mockImplementation(
      async (_userId, since) => {
        sinceArgs.push(since.toISOString());
        return 5;
      },
    );

    vi.setSystemTime(new Date("2026-04-22T23:00:00Z"));
    await resolveAICredential("u-1");
    // TTL: no cache on L1, so this call definitely re-queries.
    vi.setSystemTime(new Date("2026-04-22T23:05:00Z"));
    await resolveAICredential("u-1");

    expect(sinceArgs).toEqual([
      "2026-04-22T00:00:00.000Z",
      "2026-04-22T00:00:00.000Z",
    ]);
  });
});
