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
  },
}));

const { getSystemConfig } = await import("../../db/systemConfig.js");
const {
  getAciOperationalConfig,
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
    // Three callers, but only one set of DB reads (4 keys × 1 batch = 4
    // — added `aci_warm_pool_enabled` in slice 8.5).
    expect(vi.mocked(getSystemConfig)).toHaveBeenCalledTimes(4);
  });
});
