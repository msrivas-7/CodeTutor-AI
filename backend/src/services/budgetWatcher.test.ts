import { describe, expect, it, beforeEach, vi } from "vitest";

// Phase 22A: budgetWatcher contract tests.
// We mock the spend query (sumPlatformCostTodayGlobal), the effective-cap
// resolver (getEffectiveDailyUsdCap), and the email send (acsClient
// .sendEmail), then assert:
//   - 50/80/100% transitions fire exactly once each
//   - same threshold doesn't re-fire same day
//   - lower threshold doesn't fire after higher one already did today
//   - email failure on a transient error doesn't dedup (next cycle retries)
//   - EmailNotConfiguredError is treated as "logged, dedup applied"
//   - cap change mid-day resets the dedup ladder (audit fix #3)
//   - re-entrancy guard prevents overlapping ticks (audit fix #8)

const mockSumPlatform = vi.fn();
const mockSendEmail = vi.fn();
const mockGetEffectiveDailyUsdCap = vi.fn();

// Phase 27 §3d: budgetWatcher now reads `sumPlatformCostTodayAllSources`
// (sum of authed + anon ledgers). Same mock semantics — the test fakes
// the unified "today total" — so we route both export names through
// the same `mockSumPlatform` to preserve every existing assertion
// without rewriting the suite. `sumPlatformCostTodayGlobal` is kept
// as a no-op stub in case any helper still imports it.
vi.mock("../db/usageLedger.js", () => ({
  sumPlatformCostTodayGlobal: (...args: unknown[]) => mockSumPlatform(...args),
  sumPlatformCostTodayAllSources: (...args: unknown[]) => mockSumPlatform(...args),
}));

vi.mock("./email/acsClient.js", () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
  EmailNotConfiguredError: class EmailNotConfiguredError extends Error {
    name = "EmailNotConfiguredError";
  },
}));

vi.mock("./ai/effectiveCaps.js", () => ({
  getEffectiveDailyUsdCap: () => mockGetEffectiveDailyUsdCap(),
}));

vi.mock("../config.js", () => ({
  config: {
    freeTier: {
      dailyUsdCap: 10, // disaster-recovery fallback if effectiveCaps throws
    },
    email: {
      operatorAlertEmail: "ops@example.com",
    },
  },
}));

import {
  watchBudgetOnce,
  startBudgetWatcher,
  stopBudgetWatcher,
  _resetBudgetWatcherForTests,
} from "./budgetWatcher.js";
import { EmailNotConfiguredError } from "./email/acsClient.js";

beforeEach(() => {
  _resetBudgetWatcherForTests();
  mockSumPlatform.mockReset();
  mockSendEmail.mockReset();
  mockGetEffectiveDailyUsdCap.mockReset();
  // Default: effectiveCaps returns $10 (50%=$5, 80%=$8, 100%=$10).
  mockGetEffectiveDailyUsdCap.mockResolvedValue(10);
  mockSendEmail.mockResolvedValue({ id: "op-fake" });
});

describe("watchBudgetOnce", () => {
  it("fires nothing when spend is below 50%", async () => {
    mockSumPlatform.mockResolvedValue(2.0); // 20%
    const r = await watchBudgetOnce();
    expect(r.fired).toBe(null);
    expect(r.reason).toBe("below-50");
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("fires 50% threshold and sends an email at the right shape", async () => {
    mockSumPlatform.mockResolvedValue(5.0); // exactly 50%
    const r = await watchBudgetOnce();
    expect(r.fired).toBe(0.5);
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    const arg = mockSendEmail.mock.calls[0][0];
    expect(arg.to).toBe("ops@example.com");
    expect(arg.subject).toContain("50%");
    expect(arg.subject).toContain("$5.00");
    expect(arg.subject).toContain("$10.00");
    expect(arg.text).toContain("Free-tier");
  });

  it("does NOT re-fire 50% on the same day", async () => {
    mockSumPlatform.mockResolvedValue(5.0);
    await watchBudgetOnce();
    mockSumPlatform.mockResolvedValue(6.0); // still in 50% band
    const r = await watchBudgetOnce();
    expect(r.fired).toBe(null);
    expect(r.reason).toBe("already-fired-today");
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
  });

  it("escalates 50% → 80% → 100% across cycles, one email per threshold", async () => {
    mockSumPlatform.mockResolvedValue(5.0);
    await watchBudgetOnce(); // 50% fires

    mockSumPlatform.mockResolvedValue(8.5); // crosses 80%
    const r80 = await watchBudgetOnce();
    expect(r80.fired).toBe(0.8);

    mockSumPlatform.mockResolvedValue(10.5); // crosses 100%
    const r100 = await watchBudgetOnce();
    expect(r100.fired).toBe(1.0);

    expect(mockSendEmail).toHaveBeenCalledTimes(3);
    expect(mockSendEmail.mock.calls[2][0].subject).toContain("REACHED");
  });

  it("after 100% fires, lower thresholds (50/80) do NOT re-fire", async () => {
    mockSumPlatform.mockResolvedValue(10.5);
    await watchBudgetOnce(); // 100% fires
    expect(mockSendEmail).toHaveBeenCalledTimes(1);

    // Spend dips below 100% for some reason (refund, ledger correction).
    // Watcher should not re-fire 50% / 80% the same day.
    mockSumPlatform.mockResolvedValue(8.5);
    const r = await watchBudgetOnce();
    expect(r.fired).toBe(null);
    expect(r.reason).toBe("lower-threshold-skipped");

    mockSumPlatform.mockResolvedValue(5.0);
    const r2 = await watchBudgetOnce();
    expect(r2.fired).toBe(null);
    expect(r2.reason).toBe("lower-threshold-skipped");

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
  });

  it("retries the SAME threshold next cycle if email send throws transient error", async () => {
    mockSumPlatform.mockResolvedValue(5.0);
    mockSendEmail.mockRejectedValueOnce(new Error("ACS 503 transient"));
    const r1 = await watchBudgetOnce();
    expect(r1.fired).toBe(null);
    expect(r1.reason).toBe("email-error");

    // Second cycle, ACS recovered — same threshold should re-attempt.
    mockSendEmail.mockResolvedValueOnce({ id: "op-retry" });
    mockSumPlatform.mockResolvedValue(5.0);
    const r2 = await watchBudgetOnce();
    expect(r2.fired).toBe(0.5);
    expect(mockSendEmail).toHaveBeenCalledTimes(2);
  });

  it("treats EmailNotConfigured as 'dedup applied' (no log spam every minute)", async () => {
    mockSumPlatform.mockResolvedValue(5.0);
    mockSendEmail.mockRejectedValueOnce(new EmailNotConfiguredError("no acs"));
    const r1 = await watchBudgetOnce();
    expect(r1.fired).toBe(null);
    expect(r1.reason).toBe("email-unconfigured");

    // Next cycle, still no ACS — must NOT re-attempt + spam.
    mockSendEmail.mockRejectedValueOnce(new EmailNotConfiguredError("no acs"));
    mockSumPlatform.mockResolvedValue(5.0);
    const r2 = await watchBudgetOnce();
    expect(r2.fired).toBe(null);
    expect(r2.reason).toBe("already-fired-today");
    // Email was attempted only once across the two ticks.
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
  });

  it("returns gracefully when DB read throws", async () => {
    mockSumPlatform.mockRejectedValue(new Error("conn refused"));
    const r = await watchBudgetOnce();
    expect(r.fired).toBe(null);
    expect(r.reason).toBe("db-error");
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("returns 'cap-invalid' when effective cap is 0", async () => {
    mockGetEffectiveDailyUsdCap.mockResolvedValueOnce(0);
    const r = await watchBudgetOnce();
    expect(r.fired).toBe(null);
    expect(r.reason).toBe("cap-invalid");
  });

  it("uses the effective cap (not the env default) for threshold math", async () => {
    // Effective cap = $20; env default is mocked at $10. 50% of $20 is $10.
    mockGetEffectiveDailyUsdCap.mockResolvedValue(20);
    mockSumPlatform.mockResolvedValue(10);
    const r = await watchBudgetOnce();
    expect(r.fired).toBe(0.5);
    expect(r.capUsd).toBe(20);
    expect(mockSendEmail.mock.calls[0][0].subject).toContain("$20.00");
  });

  it("falls back to env cap when effectiveCaps throws (Supabase blip)", async () => {
    mockGetEffectiveDailyUsdCap.mockRejectedValue(new Error("supabase down"));
    mockSumPlatform.mockResolvedValue(5);
    const r = await watchBudgetOnce();
    expect(r.fired).toBe(0.5);
    expect(r.capUsd).toBe(10); // env default
  });

  it("cap change after 100% trip resets the ladder (audit fix #3)", async () => {
    // Day starts at $10 cap, we trip 100%.
    mockGetEffectiveDailyUsdCap.mockResolvedValue(10);
    mockSumPlatform.mockResolvedValue(10.5);
    const r1 = await watchBudgetOnce();
    expect(r1.fired).toBe(1.0);
    expect(mockSendEmail).toHaveBeenCalledTimes(1);

    // Operator raises cap to $50 in admin panel. Spend is still $10.5.
    // Ratio is now 0.21 → no trip. Watcher must NOT keep saying "100%
    // already fired" — different cap, different ladder.
    mockGetEffectiveDailyUsdCap.mockResolvedValue(50);
    mockSumPlatform.mockResolvedValue(10.5);
    const r2 = await watchBudgetOnce();
    expect(r2.fired).toBe(null);
    expect(r2.reason).toBe("below-50");

    // Spend climbs to $25 → 50% of new $50 cap. Must fire fresh 50% email.
    mockSumPlatform.mockResolvedValue(25);
    const r3 = await watchBudgetOnce();
    expect(r3.fired).toBe(0.5);
    expect(mockSendEmail).toHaveBeenCalledTimes(2);
    expect(mockSendEmail.mock.calls[1][0].subject).toContain("$50.00");
  });
});

describe("startBudgetWatcher re-entrancy guard (audit fix #8)", () => {
  it("skips overlapping ticks while a previous one is still in-flight", async () => {
    vi.useFakeTimers();
    // Make the spend query slow — simulates ACS poll latency.
    let release: (() => void) | null = null;
    mockSumPlatform.mockImplementation(
      () =>
        new Promise<number>((resolve) => {
          release = () => resolve(5.0);
        }),
    );

    startBudgetWatcher(); // fires once immediately
    // Advance past two 60s intervals — both interval ticks should see
    // `running === true` and bail out without calling sumPlatform.
    await vi.advanceTimersByTimeAsync(60_000);
    await vi.advanceTimersByTimeAsync(60_000);

    // Only the first invocation (immediate boot tick) hit sumPlatform;
    // the next two interval ticks were guarded.
    expect(mockSumPlatform).toHaveBeenCalledTimes(1);

    // Stop the watcher BEFORE releasing so we don't loop forever on the
    // test cleanup. The release allows the in-flight tick to settle.
    stopBudgetWatcher();
    release!();
    // Yield to microtasks so the in-flight tick's .then() handlers run.
    await Promise.resolve();
    await Promise.resolve();
    vi.useRealTimers();
  });
});
