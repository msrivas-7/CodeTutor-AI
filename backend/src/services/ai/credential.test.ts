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

// Phase 22A: defense-in-depth email-confirm gate. Default-true so the
// existing per-user / global cap tests don't have to set this up. The
// dedicated email-confirm-gate test below flips it to false.
vi.mock("../../db/userEmailConfirm.js", () => ({
  isEmailConfirmed: vi.fn(async () => true),
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
  // Phase 27 §3d: anon-side ledger exports. Existing authed-path tests
  // never call resolveAnonAICredential so these defaults aren't read,
  // but credential.ts now imports them at the module boundary —
  // omitting them would crash test imports the moment §3a adds the
  // first anon-path spec. Default 0 so any anon spec that doesn't
  // override behaves like a fresh-IP first-request.
  countPlatformQuestionsOnIpToday: vi.fn(async () => 0),
  countPlatformQuestionsOnIpTodayLocked: vi.fn(async () => 0),
  sumPlatformCostTodayAnonGlobal: vi.fn(async () => 0),
  sumPlatformCostTodayAllSources: vi.fn(async () => 0),
  writeAnonUsageRow: vi.fn(async () => undefined),
}));

// Phase 20-P5: credential.ts now reads caps via effectiveCaps. Default
// mocks return the same values the env-mock above declares, so existing
// tests behave as before. Tests that exercise per-user / project overrides
// override these mocks at the call site.
vi.mock("./effectiveCaps.js", () => ({
  getEffectiveDailyQuestionsCap: vi.fn(async () => 30),
  getEffectiveDailyUsdCapPerUser: vi.fn(async () => 0.10),
  getEffectiveLifetimeUsdCapPerUser: vi.fn(async () => 1.0),
  getEffectiveDailyUsdCap: vi.fn(async () => 2.0),
  getEffectiveFreeTierEnabled: vi.fn(async () => true),
}));

const { getOpenAIKey } = await import("../../db/preferences.js");
const { isDenylisted } = await import("../../db/denylist.js");
const ledger = await import("../../db/usageLedger.js");
const caps = await import("./effectiveCaps.js");
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
  // Phase 20-P5: reset cap resolvers each test so a per-test override
  // doesn't leak. Defaults match the mocked env config above so existing
  // tests behave as before.
  vi.mocked(caps.getEffectiveDailyQuestionsCap).mockReset().mockResolvedValue(30);
  vi.mocked(caps.getEffectiveDailyUsdCapPerUser).mockReset().mockResolvedValue(0.10);
  vi.mocked(caps.getEffectiveLifetimeUsdCapPerUser).mockReset().mockResolvedValue(1.0);
  vi.mocked(caps.getEffectiveDailyUsdCap).mockReset().mockResolvedValue(2.0);
  vi.mocked(caps.getEffectiveFreeTierEnabled).mockReset().mockResolvedValue(true);
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

  it("L4 global $ cap: combined authed + anon spend trips the cap (Phase 27 §3d)", async () => {
    // Watcher/resolver agreement invariant: the L4 check sums BOTH ledger
    // tables. If a future edit removed the anon half of the sum, this test
    // would catch it — authed alone (1.5) is below cap (2.0), anon alone
    // (1.0) is below cap, but together (2.5) they trip the ceiling.
    vi.mocked(ledger.sumPlatformCostTodayGlobal).mockResolvedValueOnce(1.5);
    vi.mocked(ledger.sumPlatformCostTodayAnonGlobal).mockResolvedValueOnce(1.0);
    const c = await resolveAICredential("u-1");
    expect(c.source).toBe("none");
    if (c.source === "none") expect(c.reason).toBe("usd_cap_hit");
  });

  it("L4 global $ cap: anon spend alone can trip the cap on the authed path", async () => {
    // Edge case the prior P0 fix unlocked: even with zero authed spend,
    // a runaway anon faucet must lock out authed users (they share the
    // operator wallet). Authed=0, anon=2.5 → over cap of 2.0.
    vi.mocked(ledger.sumPlatformCostTodayGlobal).mockResolvedValueOnce(0);
    vi.mocked(ledger.sumPlatformCostTodayAnonGlobal).mockResolvedValueOnce(2.5);
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

// Phase 20-P5: cap resolver precedence. The L1/L2/L3/L4/L9 sites in
// credential.ts now read effective caps via effectiveCaps.ts (which
// itself walks per-user override → project override → env). These tests
// verify credential.ts correctly reflects the resolver's answer at each
// site — the actual override → project → env walk is tested in
// effectiveCaps.test.ts.
describe("resolveAICredential — Phase 20-P5 cap overrides", () => {
  it("L1 honors per-user dailyQuestions override (e.g. 200/day instead of 30)", async () => {
    vi.mocked(caps.getEffectiveDailyQuestionsCap).mockResolvedValueOnce(200);
    vi.mocked(ledger.countPlatformQuestionsTodayLocked).mockResolvedValueOnce(150);
    const c = await resolveAICredential("u-1");
    expect(c.source).toBe("platform");
    if (c.source === "platform") {
      expect(c.capToday).toBe(200);
      expect(c.remainingToday).toBe(50);
    }
  });

  it("L1 honors a 0-cap override (effectively denylisted via override)", async () => {
    vi.mocked(caps.getEffectiveDailyQuestionsCap).mockResolvedValueOnce(0);
    const c = await resolveAICredential("u-1");
    expect(c.source).toBe("none");
    if (c.source === "none") expect(c.reason).toBe("free_exhausted");
  });

  it("L4 honors a project-wide global $ cap override", async () => {
    // Override drops global cap to $0.50. Spend at $0.51 trips the brake.
    vi.mocked(caps.getEffectiveDailyUsdCap).mockResolvedValueOnce(0.50);
    vi.mocked(ledger.sumPlatformCostTodayGlobal).mockResolvedValueOnce(0.51);
    const c = await resolveAICredential("u-1");
    expect(c.source).toBe("none");
    if (c.source === "none") expect(c.reason).toBe("usd_cap_hit");
  });

  it("L3 honors per-user lifetime $ override (a high-value beta tester)", async () => {
    // Override raises lifetime cap to $100 for this user; lifetime spend
    // of $5 is well under, so platform path proceeds.
    vi.mocked(caps.getEffectiveLifetimeUsdCapPerUser).mockResolvedValueOnce(100);
    vi.mocked(ledger.sumPlatformCostLifetimeForUser).mockResolvedValueOnce(5);
    const c = await resolveAICredential("u-1");
    expect(c.source).toBe("platform");
  });

  it("L2 honors per-user daily $ override", async () => {
    // Override drops daily $ cap to $0.05; spend at $0.06 trips it.
    vi.mocked(caps.getEffectiveDailyUsdCapPerUser).mockResolvedValueOnce(0.05);
    vi.mocked(ledger.sumPlatformCostTodayForUser).mockResolvedValueOnce(0.06);
    const c = await resolveAICredential("u-1");
    expect(c.source).toBe("none");
    if (c.source === "none") expect(c.reason).toBe("daily_usd_per_user_hit");
  });

  it("L9 honors a project override that disables free tier (admin kill-switch)", async () => {
    vi.mocked(caps.getEffectiveFreeTierEnabled).mockResolvedValueOnce(false);
    const c = await resolveAICredential("u-1");
    expect(c.source).toBe("none");
    // Same user-facing reason as the env-flag-off path so the UI doesn't
    // need to distinguish.
    if (c.source === "none") expect(c.reason).toBe("no_key");
  });

  // Phase 22A: defense-in-depth email-confirm gate.
  it("L5b returns email_not_confirmed when auth.users.email_confirmed_at is null", async () => {
    const emailConfirm = await import("../../db/userEmailConfirm.js");
    vi.mocked(emailConfirm.isEmailConfirmed).mockResolvedValueOnce(false);
    const c = await resolveAICredential("u-1");
    expect(c.source).toBe("none");
    if (c.source === "none") expect(c.reason).toBe("email_not_confirmed");
  });

  it("L5b: BYOK users bypass the email-confirm gate (their key, their bill)", async () => {
    vi.mocked(getOpenAIKey).mockResolvedValueOnce("sk-byok-test");
    const emailConfirm = await import("../../db/userEmailConfirm.js");
    vi.mocked(emailConfirm.isEmailConfirmed).mockResolvedValueOnce(false);
    const c = await resolveAICredential("u-1");
    expect(c.source).toBe("byok");
  });

  it("L5b: denylist check fires BEFORE email-confirm (a denylisted unconfirmed user gets denylisted, not email_not_confirmed)", async () => {
    const denylist = await import("../../db/denylist.js");
    vi.mocked(denylist.isDenylisted).mockResolvedValueOnce(true);
    const emailConfirm = await import("../../db/userEmailConfirm.js");
    vi.mocked(emailConfirm.isEmailConfirmed).mockResolvedValueOnce(false);
    const c = await resolveAICredential("u-1");
    expect(c.source).toBe("none");
    if (c.source === "none") expect(c.reason).toBe("denylisted");
  });
});
