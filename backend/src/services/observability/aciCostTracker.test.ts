// Phase 24B: AciCostTracker — event-based per-session cost accounting.
//
// Validates the math against Azure's per-second billing model: every
// scenario below uses synthetic time so the assertions are exact, not
// "close enough."

import { beforeEach, describe, expect, it } from "vitest";
import {
  aciCostTracker,
  ACI_COST_RATE_USD_PER_SESSION_HOUR,
} from "./aciCostTracker.js";

const HOUR_MS = 60 * 60 * 1000;
const MIN_MS = 60 * 1000;
const SEC_MS = 1000;

describe("AciCostTracker", () => {
  beforeEach(() => {
    aciCostTracker.__forceForTests({
      completedTodayUsd: 0,
      currentDateUtc: "2026-04-30",
      activeSessions: [],
    });
  });

  it("rate constant matches Azure ACI's per-session-hour pricing", () => {
    // Azure Standard tier eastus2: 1 vCPU $0.0405/hr + 0.5 GB × $0.00445/hr
    // = $0.042725/hr; rounded to $0.0427 in the constant. Verified against
    // the Azure Retail Prices API (2026-05-06).
    expect(ACI_COST_RATE_USD_PER_SESSION_HOUR).toBe(0.0427);
  });

  it("a 15-second session bills rate × 15/3600 at end", () => {
    const t0 = Date.parse("2026-04-30T12:00:00Z");
    aciCostTracker.recordSessionStart("s1", t0);
    aciCostTracker.recordSessionEnd("s1", t0 + 15 * SEC_MS);
    expect(aciCostTracker.spentTodayUsd(t0 + 15 * SEC_MS)).toBeCloseTo(
      ACI_COST_RATE_USD_PER_SESSION_HOUR * (15 / 3600),
      6,
    );
  });

  it("a 5-minute session bills rate × 300/3600", () => {
    const t0 = Date.parse("2026-04-30T12:00:00Z");
    aciCostTracker.recordSessionStart("s1", t0);
    aciCostTracker.recordSessionEnd("s1", t0 + 5 * MIN_MS);
    expect(aciCostTracker.spentTodayUsd(t0 + 5 * MIN_MS)).toBeCloseTo(
      ACI_COST_RATE_USD_PER_SESSION_HOUR * (300 / 3600),
      6,
    );
  });

  it("two concurrent sessions for 1 hour bills 2× rate — sum is correct", () => {
    const t0 = Date.parse("2026-04-30T12:00:00Z");
    aciCostTracker.recordSessionStart("s1", t0);
    aciCostTracker.recordSessionStart("s2", t0);
    aciCostTracker.recordSessionEnd("s1", t0 + HOUR_MS);
    aciCostTracker.recordSessionEnd("s2", t0 + HOUR_MS);
    expect(aciCostTracker.spentTodayUsd(t0 + HOUR_MS)).toBeCloseTo(
      2 * ACI_COST_RATE_USD_PER_SESSION_HOUR,
      4,
    );
  });

  it("in-flight sessions are billed up to the moment of the read", () => {
    // This is the property that defends against the prior sample-based
    // implementation's drift: a long-running session counts NOW even
    // before its end is recorded.
    const t0 = Date.parse("2026-04-30T12:00:00Z");
    aciCostTracker.recordSessionStart("s1", t0);
    // 30 minutes in — session still running.
    expect(aciCostTracker.spentTodayUsd(t0 + 30 * MIN_MS)).toBeCloseTo(
      ACI_COST_RATE_USD_PER_SESSION_HOUR / 2,
      4,
    );
    // 1 hour in — still running.
    expect(aciCostTracker.spentTodayUsd(t0 + HOUR_MS)).toBeCloseTo(
      ACI_COST_RATE_USD_PER_SESSION_HOUR,
      4,
    );
  });

  it("recordSessionEnd before recordSessionStart is a silent no-op", () => {
    aciCostTracker.recordSessionEnd("ghost"); // never started
    expect(aciCostTracker.spentTodayUsd()).toBe(0);
  });

  it("double-end is idempotent — second call does not double-bill", () => {
    const t0 = Date.parse("2026-04-30T12:00:00Z");
    aciCostTracker.recordSessionStart("s1", t0);
    aciCostTracker.recordSessionEnd("s1", t0 + HOUR_MS);
    aciCostTracker.recordSessionEnd("s1", t0 + HOUR_MS); // duplicate
    expect(aciCostTracker.spentTodayUsd(t0 + HOUR_MS)).toBeCloseTo(
      ACI_COST_RATE_USD_PER_SESSION_HOUR,
      4,
    );
  });

  it("clock skew clamps duration to >= 0 (negative interval → no spend)", () => {
    const t0 = Date.parse("2026-04-30T12:00:00Z");
    aciCostTracker.recordSessionStart("s1", t0);
    // End time before start time — clamps to 0.
    aciCostTracker.recordSessionEnd("s1", t0 - SEC_MS);
    expect(aciCostTracker.spentTodayUsd(t0)).toBe(0);
  });

  it("UTC midnight rollover zeros today's completed bucket", () => {
    aciCostTracker.__forceForTests({
      completedTodayUsd: 5.0,
      currentDateUtc: "2026-04-29",
      activeSessions: [],
    });
    // First read on the new day pivots the date + zeros the bucket.
    expect(
      aciCostTracker.spentTodayUsd(Date.parse("2026-04-30T00:01:00Z")),
    ).toBe(0);
  });

  it("cross-midnight sessions rebase to midnight — yesterday's seconds don't bill today", () => {
    // Session started 6 hours BEFORE midnight, still running 1 minute
    // after. Yesterday's 6 hours stay on yesterday; today should bill
    // only the 1 minute past midnight.
    const yesterdayStart = Date.parse("2026-04-29T18:00:00Z"); // 6h pre-midnight
    aciCostTracker.__forceForTests({
      completedTodayUsd: 0,
      currentDateUtc: "2026-04-29",
      activeSessions: [["long-runner", yesterdayStart]],
    });
    const oneMinPastMidnight = Date.parse("2026-04-30T00:01:00Z");
    // After the rollover, today's spend should be ~1 minute × rate.
    expect(aciCostTracker.spentTodayUsd(oneMinPastMidnight)).toBeCloseTo(
      ACI_COST_RATE_USD_PER_SESSION_HOUR * (1 / 60),
      4,
    );
    expect(aciCostTracker.spentTodayUsd(oneMinPastMidnight)).toBeLessThan(0.001);
  });

  it("exceedsDailyCap fires only when spent ≥ cap", () => {
    const t0 = Date.parse("2026-04-30T12:00:00Z");
    aciCostTracker.recordSessionStart("s1", t0);
    // 1 minute in: spent ~$0.000883 — well under any sane cap.
    expect(aciCostTracker.exceedsDailyCap(20, t0 + MIN_MS)).toBe(false);

    // Force the bucket above the cap to confirm the comparison works.
    // Pass an explicit `now` so maybeRollover doesn't zero completedTodayUsd
    // when the wall-clock date has moved past the forced currentDateUtc.
    aciCostTracker.__forceForTests({ completedTodayUsd: 20.01 });
    expect(aciCostTracker.exceedsDailyCap(20, t0 + MIN_MS)).toBe(true);
  });

  it("getStatus reports activeSessions, hourly burn, and spent today", () => {
    const t0 = Date.parse("2026-04-30T12:00:00Z");
    aciCostTracker.recordSessionStart("a", t0);
    aciCostTracker.recordSessionStart("b", t0);
    aciCostTracker.recordSessionStart("c", t0);
    const s = aciCostTracker.getStatus(t0 + 30 * MIN_MS);
    expect(s.activeSessions).toBe(3);
    // 3 sessions × rate = instantaneous burn rate
    expect(s.hourlyBurnRateUsd).toBeCloseTo(
      3 * ACI_COST_RATE_USD_PER_SESSION_HOUR,
      4,
    );
    // 3 sessions × 30 min × rate
    expect(s.spentTodayUsd).toBeCloseTo(
      3 * (ACI_COST_RATE_USD_PER_SESSION_HOUR / 2),
      4,
    );
  });

  // ── P0-2: atomic cost reservation ─────────────────────────────────

  describe("tryReserve / cancelReservation (P0-2)", () => {
    // Reservation amount per spawn = 1 hour × rate (the worst-case
    // session lifetime ceiling). Tests size their seed values relative
    // to this so rate changes don't require manual cap arithmetic.
    const RESERVE_USD = ACI_COST_RATE_USD_PER_SESSION_HOUR;

    it("returns null when projected spend would exceed the cap", () => {
      const t0 = Date.parse("2026-04-30T12:00:00Z");
      // Seed = 20 - 0.5 × reserve → seed + reserve > 20.
      aciCostTracker.__forceForTests({ completedTodayUsd: 20 - 0.5 * RESERVE_USD });
      expect(aciCostTracker.tryReserve(60 * 60 * 1000, 20, t0)).toBe(null);
    });

    it("returns a token + bumps projectedSpentTodayUsd by the reserved amount", () => {
      const t0 = Date.parse("2026-04-30T12:00:00Z");
      const id = aciCostTracker.tryReserve(60 * 60 * 1000, 100, t0);
      expect(id).not.toBe(null);
      // Reservation visible in projected (kill-switch view) but NOT in
      // operator-facing spentTodayUsd (display view). This is the split
      // that fixes operator-confusing $-jumps during cold-start churn.
      expect(aciCostTracker.projectedSpentTodayUsd(t0)).toBeCloseTo(RESERVE_USD, 6);
      expect(aciCostTracker.spentTodayUsd(t0)).toBeCloseTo(0, 6);
    });

    it("two concurrent reserves see each other — second sees first's pending charge", () => {
      const t0 = Date.parse("2026-04-30T12:00:00Z");
      // Seed = 20 - 1.5 × reserve → first fits (seed + 1×reserve < 20),
      // second doesn't (seed + 2×reserve > 20).
      aciCostTracker.__forceForTests({ completedTodayUsd: 20 - 1.5 * RESERVE_USD });
      const a = aciCostTracker.tryReserve(60 * 60 * 1000, 20, t0);
      const b = aciCostTracker.tryReserve(60 * 60 * 1000, 20, t0);
      expect(a).not.toBe(null);
      expect(b).toBe(null);
    });

    it("cancelReservation releases the budget for subsequent attempts", () => {
      const t0 = Date.parse("2026-04-30T12:00:00Z");
      aciCostTracker.__forceForTests({ completedTodayUsd: 20 - 1.5 * RESERVE_USD });
      const a = aciCostTracker.tryReserve(60 * 60 * 1000, 20, t0)!;
      expect(aciCostTracker.tryReserve(60 * 60 * 1000, 20, t0)).toBe(null);
      aciCostTracker.cancelReservation(a);
      // After release, headroom is back — next reserve should succeed.
      const c = aciCostTracker.tryReserve(60 * 60 * 1000, 20, t0);
      expect(c).not.toBe(null);
    });

    it("recordSessionStart consumes the reservation atomically (no double-count)", () => {
      const t0 = Date.parse("2026-04-30T12:00:00Z");
      const id = aciCostTracker.tryReserve(60 * 60 * 1000, 100, t0)!;
      // Pre-consume: reservation contributes RESERVE_USD to PROJECTED
      // (kill-switch) view; spentTodayUsd (display) shows $0.
      expect(aciCostTracker.projectedSpentTodayUsd(t0)).toBeCloseTo(RESERVE_USD, 6);
      expect(aciCostTracker.spentTodayUsd(t0)).toBeCloseTo(0, 6);
      aciCostTracker.recordSessionStart("s1", t0, id);
      // Post-consume: reservation gone, session started but 0ms elapsed
      // — both views read 0.
      expect(aciCostTracker.projectedSpentTodayUsd(t0)).toBeCloseTo(0, 6);
      expect(aciCostTracker.spentTodayUsd(t0)).toBeCloseTo(0, 6);
    });

    it("cancelReservation is idempotent on unknown ids", () => {
      // Should not throw — silent no-op.
      expect(() => aciCostTracker.cancelReservation("never-issued")).not.toThrow();
    });
  });
});
