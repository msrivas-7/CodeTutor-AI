// Phase 24B Slice 6.5: aciOperationalConfig synchronous mirror.
//
// The mirror sits between the async system_config DB read and the
// synchronous HybridBackend kill-switch / cap callbacks. These tests
// validate (a) safe defaults, (b) refresh against a mocked DB, and
// (c) graceful fallback when the DB read throws.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the DB layer BEFORE importing the module under test — its module
// init reads config + nothing else, but we want clean control over the
// `getSystemConfig` calls fired by `refreshOnce()`.
vi.mock("../../db/systemConfig.js", () => {
  return {
    KNOWN_KEYS: ["aci_overflow_enabled", "aci_daily_usd_cap", "aci_max_overflow"],
    getSystemConfig: vi.fn(),
  };
});

// Mock config so module-load defaults are predictable.
vi.mock("../../config.js", () => ({
  config: {
    aci: {
      enabled: true,
      dailyUsdCap: 20,
      maxOverflow: 36,
    },
    // Phase 24B-resize: warmHigh/Low watermark defaults now derive from
    // session.maxGlobal so they scale with SKU. Mock cap of 14 (B2ms-era
    // value) keeps existing test expectations aligned with their
    // previously-hardcoded 12/10 watermarks (high=13, low=7 with new
    // formula; tests that assert specific defaults set them via
    // __forceAciOperationalConfigForTests so the exact cap value below
    // doesn't load-bear).
    session: { maxGlobal: 14 },
  },
}));

const { getSystemConfig } = await import("../../db/systemConfig.js");
const {
  getAciOperationalConfig,
  getAciOperationalConfigRefreshAgeMs,
  awaitFirstRefresh,
  invalidateAciOperationalConfig,
  __forceAciOperationalConfigForTests,
} = await import("./aciOperationalConfig.js");

describe("AciOperationalConfig — synchronous mirror", () => {
  beforeEach(() => {
    vi.mocked(getSystemConfig).mockReset();
    // Reset the module's cache to env defaults before every test.
    __forceAciOperationalConfigForTests({
      enabled: true,
      dailyUsdCap: 20,
      maxOverflow: 36,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns env defaults at module load — no DB read required", () => {
    const cfg = getAciOperationalConfig();
    expect(cfg.enabled).toBe(true);
    expect(cfg.dailyUsdCap).toBe(20);
    expect(cfg.maxOverflow).toBe(36);
  });

  it("invalidate refresh picks up DB-set values for all three keys", async () => {
    vi.mocked(getSystemConfig).mockImplementation(async (key) => {
      if (key === "aci_overflow_enabled")
        return { key, value: false, setBy: "u1", setAt: "", reason: "kill" };
      if (key === "aci_daily_usd_cap")
        return { key, value: 50, setBy: "u1", setAt: "", reason: "raise cap" };
      if (key === "aci_max_overflow")
        return { key, value: 60, setBy: "u1", setAt: "", reason: "spike" };
      return null;
    });
    await invalidateAciOperationalConfig();
    const cfg = getAciOperationalConfig();
    expect(cfg.enabled).toBe(false);
    expect(cfg.dailyUsdCap).toBe(50);
    expect(cfg.maxOverflow).toBe(60);
  });

  it("falls back to env defaults when a DB row is absent", async () => {
    // Only the cap is set; enabled + maxOverflow rows are missing.
    vi.mocked(getSystemConfig).mockImplementation(async (key) => {
      if (key === "aci_daily_usd_cap")
        return { key, value: 30, setBy: null, setAt: "", reason: null };
      return null;
    });
    await invalidateAciOperationalConfig();
    const cfg = getAciOperationalConfig();
    expect(cfg.dailyUsdCap).toBe(30);
    // Env defaults preserved for the other keys.
    expect(cfg.enabled).toBe(true);
    expect(cfg.maxOverflow).toBe(36);
  });

  it("ignores non-matching value types (e.g. number where boolean expected)", async () => {
    // Defensive: a malformed DB row should not corrupt the cache. The
    // mirror keeps the previous (env) value for that key.
    vi.mocked(getSystemConfig).mockImplementation(async (key) => {
      if (key === "aci_overflow_enabled")
        return { key, value: 42 as never, setBy: null, setAt: "", reason: null };
      return null;
    });
    await invalidateAciOperationalConfig();
    expect(getAciOperationalConfig().enabled).toBe(true); // env default preserved
  });

  it("preserves the previous cached values when the DB read throws", async () => {
    // Seed a known cached state, then simulate a DB outage.
    __forceAciOperationalConfigForTests({
      enabled: false,
      dailyUsdCap: 10,
      maxOverflow: 5,
    });
    vi.mocked(getSystemConfig).mockRejectedValue(new Error("db unreachable"));
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    await invalidateAciOperationalConfig();
    consoleErr.mockRestore();
    // Cache stays at the last-good values, NOT reset to env defaults
    // and NOT zeroed.
    const cfg = getAciOperationalConfig();
    expect(cfg.enabled).toBe(false);
    expect(cfg.dailyUsdCap).toBe(10);
    expect(cfg.maxOverflow).toBe(5);
  });

  // ── P0-4: await first refresh + watchdog + age telemetry ─────────

  it("awaitFirstRefresh resolves ok=true when first refresh succeeds within budget", async () => {
    // Reset to "no refresh has ever succeeded" by passing null timestamp.
    __forceAciOperationalConfigForTests({ lastSuccessfulRefreshAt: null });
    vi.mocked(getSystemConfig).mockImplementation(async (key) => {
      if (key === "aci_overflow_enabled")
        return { key, value: false, setBy: null, setAt: "", reason: null };
      return null;
    });
    const result = await awaitFirstRefresh(2_000);
    expect(result.ok).toBe(true);
    expect(getAciOperationalConfig().enabled).toBe(false);
  });

  it("awaitFirstRefresh resolves ok=false when DB stays down past the budget", async () => {
    __forceAciOperationalConfigForTests({ lastSuccessfulRefreshAt: null });
    vi.mocked(getSystemConfig).mockRejectedValue(new Error("ECONNREFUSED"));
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await awaitFirstRefresh(50);
    consoleErr.mockRestore();
    expect(result.ok).toBe(false);
  });

  it("watchdog forces enabled=false when no refresh has ever succeeded", () => {
    __forceAciOperationalConfigForTests({
      enabled: true,
      lastSuccessfulRefreshAt: null,
    });
    // Even though the cache says enabled=true, the read MUST surface
    // false until DB confirms the operator's intent.
    expect(getAciOperationalConfig().enabled).toBe(false);
  });

  it("watchdog forces enabled=false when last refresh is older than 5× interval", () => {
    const stale = Date.now() - 6 * 30_000; // 180 s old > 150 s threshold
    __forceAciOperationalConfigForTests({
      enabled: true,
      lastSuccessfulRefreshAt: stale,
    });
    expect(getAciOperationalConfig().enabled).toBe(false);
  });

  it("P1-4: refreshOnce hard-times out so a wedged DB doesn't pin inFlightRefresh", async () => {
    // Pre-fix, a stuck getSystemConfig left inFlightRefresh non-null
    // forever. Subsequent invalidateAciOperationalConfig() calls would
    // block on the same wedged promise. The hard timeout ensures the
    // in-flight slot clears so the next caller can retry.
    vi.useFakeTimers();
    let firstCallNeverResolves: (() => void) | null = null;
    vi.mocked(getSystemConfig).mockImplementationOnce(
      () =>
        new Promise(() => {
          firstCallNeverResolves = () => {}; // never resolved
        }),
    );
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});

    const refreshPromise = invalidateAciOperationalConfig();
    // Advance past the 8 s hard timeout in the module.
    await vi.advanceTimersByTimeAsync(9_000);
    await refreshPromise;
    consoleErr.mockRestore();

    // The wedged getSystemConfig call hangs forever, but the in-flight
    // slot is cleared so the operator's emergency-kill flow can retry
    // on a subsequent call. Verify by issuing a new invalidate that
    // resolves on its own DB mock.
    vi.mocked(getSystemConfig).mockImplementation(async (key) => {
      if (key === "aci_overflow_enabled")
        return { key, value: false, setBy: null, setAt: "", reason: null };
      return null;
    });
    vi.useRealTimers();
    await invalidateAciOperationalConfig();
    expect(getAciOperationalConfig().enabled).toBe(false);
    void firstCallNeverResolves;
  });

  it("P1-3: watchdog zeros dailyUsdCap and maxOverflow alongside enabled", () => {
    // Pre-fix only `enabled` was forced false; `dailyUsdCap` and
    // `maxOverflow` stayed at last-cached, so the cost sampler emitted
    // a stale cap and the factory's effectiveCap reported a stale max.
    // Now all three knobs are zeroed under stale conditions.
    const stale = Date.now() - 6 * 30_000;
    __forceAciOperationalConfigForTests({
      enabled: true,
      dailyUsdCap: 50,
      maxOverflow: 36,
      lastSuccessfulRefreshAt: stale,
    });
    const cfg = getAciOperationalConfig();
    expect(cfg.enabled).toBe(false);
    expect(cfg.dailyUsdCap).toBe(0);
    expect(cfg.maxOverflow).toBe(0);
  });

  it("watchdog leaves cache untouched when refresh is fresh", () => {
    __forceAciOperationalConfigForTests({
      enabled: true,
      dailyUsdCap: 50,
      lastSuccessfulRefreshAt: Date.now(),
    });
    const cfg = getAciOperationalConfig();
    expect(cfg.enabled).toBe(true);
    expect(cfg.dailyUsdCap).toBe(50);
  });

  it("getAciOperationalConfigRefreshAgeMs returns null before first refresh", () => {
    __forceAciOperationalConfigForTests({ lastSuccessfulRefreshAt: null });
    expect(getAciOperationalConfigRefreshAgeMs()).toBe(null);
  });

  it("getAciOperationalConfigRefreshAgeMs returns ms since last success", () => {
    const t = Date.now() - 12_345;
    __forceAciOperationalConfigForTests({ lastSuccessfulRefreshAt: t });
    const age = getAciOperationalConfigRefreshAgeMs();
    expect(age).not.toBe(null);
    expect(age!).toBeGreaterThanOrEqual(12_345);
    expect(age!).toBeLessThan(13_000);
  });

  it("concurrent invalidate calls share one DB roundtrip", async () => {
    vi.mocked(getSystemConfig).mockImplementation(async (key) => {
      // Slow-ish to expose the race.
      await new Promise((r) => setTimeout(r, 5));
      if (key === "aci_overflow_enabled")
        return { key, value: false, setBy: null, setAt: "", reason: null };
      return null;
    });
    await Promise.all([
      invalidateAciOperationalConfig(),
      invalidateAciOperationalConfig(),
      invalidateAciOperationalConfig(),
    ]);
    // Three callers, but only one set of DB reads. Batch size = 7
    // (P2-2 added warmHigh/warmLow/warmMaxPoolSize on top of the
    // original enabled/dailyUsdCap/maxOverflow/warmPoolEnabled).
    expect(vi.mocked(getSystemConfig)).toHaveBeenCalledTimes(7);
  });
});
