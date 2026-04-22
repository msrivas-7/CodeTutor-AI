// Phase 20-P4: credential resolver coverage. Mocks the three DB touchpoints
// (BYOK lookup, denylist, ledger aggregates) so the test can exercise every
// resolution branch without a real postgres. The cache invalidation helper
// resets module state between specs.

import { beforeEach, describe, expect, it, vi } from "vitest";

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
