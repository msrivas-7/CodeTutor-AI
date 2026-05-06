// Phase 24B P0-1: persistence layer for AciCostTracker.
//
// The cost tracker was previously in-process only — a SIGTERM/OOM/deploy
// would zero `completedTodayUsd` and forget every active session, so
// the daily cap could be laundered to $0 by triggering a restart. These
// tests cover the four shapes of the new persist contract:
//   1. init() hydrates from a non-empty row.
//   2. init() handles a DB-unreachable error without throwing.
//   3. State changes after init() write through to saveAciCostState.
//   4. Bursts coalesce — N rapid changes don't fan out to N writes.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../db/aciCostState.js", () => {
  return {
    loadAciCostState: vi.fn(),
    saveAciCostState: vi.fn(),
  };
});

const { loadAciCostState, saveAciCostState } = await import(
  "../../db/aciCostState.js"
);
const { aciCostTracker, ACI_COST_RATE_USD_PER_SESSION_HOUR } = await import(
  "./aciCostTracker.js"
);

const SEC_MS = 1000;

describe("AciCostTracker — Postgres persistence (P0-1)", () => {
  beforeEach(() => {
    vi.mocked(loadAciCostState).mockReset();
    vi.mocked(saveAciCostState).mockReset();
    aciCostTracker.__forceForTests({
      completedTodayUsd: 0,
      currentDateUtc: "2026-04-30",
      activeSessions: [],
      persistEnabled: false,
    });
  });

  afterEach(() => {
    aciCostTracker.__forceForTests({
      completedTodayUsd: 0,
      currentDateUtc: "2026-04-30",
      activeSessions: [],
      persistEnabled: false,
    });
  });

  it("init() hydrates state from the persisted row + rolls active orphans to completed", async () => {
    // Sessions in `active_sessions` from the DB are by definition orphaned
    // post-restart — no in-process handle exists for them. init() rolls
    // their accrued time into completedTodayUsd so the tracker doesn't
    // keep billing them as if they were still running.
    vi.mocked(loadAciCostState).mockResolvedValue({
      completedTodayUsd: 1.234,
      currentDateUtc: "2026-04-30",
      activeSessions: [
        { sessionId: "s-warm-1", startedAt: Date.parse("2026-04-30T11:00:00Z") },
      ],
    });

    const now = Date.parse("2026-04-30T12:00:00Z");
    await aciCostTracker.init(now);

    // Completed = previous completed + orphan's 1-hour duration.
    // Active is 0 because all hydrated sessions were rolled to completed.
    expect(aciCostTracker.spentTodayUsd(now)).toBeCloseTo(
      1.234 + ACI_COST_RATE_USD_PER_SESSION_HOUR,
      6,
    );
    expect(aciCostTracker.getStatus(now).activeSessions).toBe(0);
  });

  it("init() flips to degraded state when load throws (DB unreachable)", async () => {
    vi.mocked(loadAciCostState).mockRejectedValue(new Error("ECONNREFUSED"));

    const now = Date.parse("2026-04-30T12:00:00Z");
    await aciCostTracker.init(now);

    expect(aciCostTracker.spentTodayUsd(now)).toBe(0);
    expect(aciCostTracker.getHydrationState()).toBe("degraded");
    // Persistence stays OFF — recordSessionStart must not blast a failing DB.
    aciCostTracker.recordSessionStart("s1", now);
    aciCostTracker.recordSessionEnd("s1", now + 5 * SEC_MS);
    // No write was attempted because persistEnabled remained false.
    expect(saveAciCostState).not.toHaveBeenCalled();
  });

  it("P0-2: degraded state fails CLOSED — exceedsDailyCap returns true even at $0 spend", async () => {
    vi.mocked(loadAciCostState).mockRejectedValue(new Error("DB down"));
    const now = Date.parse("2026-04-30T12:00:00Z");
    await aciCostTracker.init(now);

    // Pre-fix: $0 spend < $20 cap → false (kill switch open). Fix: degraded
    // state forces fail-closed regardless of spend.
    expect(aciCostTracker.exceedsDailyCap(20, now)).toBe(true);
    // tryReserve refuses too, so cold-start + warm spawns both turn into
    // ARM no-ops on a DB outage — bounded blast radius.
    expect(aciCostTracker.tryReserve(60 * 60 * 1000, 20, now)).toBe(null);
  });

  it("P1-6: cross-day restart credits orphan only for post-midnight portion", async () => {
    // Orphan started at 23:00 UTC yesterday. Restart happens at 02:00
    // UTC today (3 hours after start, but only 2 hours of which fall
    // within today's bucket). Pre-fix: full 3 h × $0.053 = $0.159 added
    // to today AND row.completedTodayUsd ($5) preserved THEN zeroed by
    // rollover, losing both. Fix: today's bucket starts at 0
    // (rollover semantics), orphan bills only the 2 hours since today's
    // midnight = 2 × $0.053 = $0.106. Persisted yesterday-completed
    // ($5) is correctly NOT carried over.
    const yesterday23 = Date.parse("2026-04-30T23:00:00Z");
    const today02 = Date.parse("2026-05-01T02:00:00Z");
    vi.mocked(loadAciCostState).mockResolvedValue({
      completedTodayUsd: 5.0, // yesterday's accrued — irrelevant after rollover
      currentDateUtc: "2026-04-30",
      activeSessions: [{ sessionId: "s-cross", startedAt: yesterday23 }],
    });
    vi.mocked(saveAciCostState).mockResolvedValue();

    await aciCostTracker.init(today02);

    // Today's bucket should reflect 2 hours of post-midnight orphan
    // time only — yesterday's $5 has rolled away.
    expect(aciCostTracker.spentTodayUsd(today02)).toBeCloseTo(
      2 * ACI_COST_RATE_USD_PER_SESSION_HOUR,
      6,
    );
    expect(aciCostTracker.getStatus(today02).currentDateUtc).toBe("2026-05-01");
  });

  it("P1-6: same-day restart preserves persisted completedTodayUsd + bills full orphan duration", async () => {
    // Restart at 14:00 UTC, with a row from 12:00 UTC same day. Orphan
    // started at 13:00 UTC. Today's bucket should retain the persisted
    // $1.234 AND credit the orphan's full 1-hour duration (1 × rate).
    const t13 = Date.parse("2026-04-30T13:00:00Z");
    const t14 = Date.parse("2026-04-30T14:00:00Z");
    vi.mocked(loadAciCostState).mockResolvedValue({
      completedTodayUsd: 1.234,
      currentDateUtc: "2026-04-30",
      activeSessions: [{ sessionId: "s-same", startedAt: t13 }],
    });
    vi.mocked(saveAciCostState).mockResolvedValue();

    await aciCostTracker.init(t14);

    expect(aciCostTracker.spentTodayUsd(t14)).toBeCloseTo(
      1.234 + ACI_COST_RATE_USD_PER_SESSION_HOUR,
      6,
    );
    expect(aciCostTracker.getStatus(t14).currentDateUtc).toBe("2026-04-30");
  });

  it("P0-2: hydrated state allows reservations + cap evaluation as normal", async () => {
    vi.mocked(loadAciCostState).mockResolvedValue({
      completedTodayUsd: 0,
      currentDateUtc: "2026-04-30",
      activeSessions: [],
    });
    vi.mocked(saveAciCostState).mockResolvedValue();
    const now = Date.parse("2026-04-30T12:00:00Z");
    await aciCostTracker.init(now);

    expect(aciCostTracker.getHydrationState()).toBe("hydrated");
    expect(aciCostTracker.exceedsDailyCap(20, now)).toBe(false);
    expect(aciCostTracker.tryReserve(60 * 60 * 1000, 20, now)).not.toBe(null);
  });

  it("recordSessionStart + recordSessionEnd write through to the DB", async () => {
    vi.mocked(loadAciCostState).mockResolvedValue({
      completedTodayUsd: 0,
      currentDateUtc: "2026-04-30",
      activeSessions: [],
    });
    vi.mocked(saveAciCostState).mockResolvedValue();

    const t0 = Date.parse("2026-04-30T12:00:00Z");
    await aciCostTracker.init(t0);

    aciCostTracker.recordSessionStart("s1", t0);
    aciCostTracker.recordSessionEnd("s1", t0 + 30 * SEC_MS);

    // Flush the microtask queue so the in-flight + follow-up writes settle.
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    expect(saveAciCostState).toHaveBeenCalled();
    const last = vi.mocked(saveAciCostState).mock.calls.at(-1)?.[0];
    expect(last?.completedTodayUsd).toBeCloseTo(
      ACI_COST_RATE_USD_PER_SESSION_HOUR * (30 / 3600),
      6,
    );
    expect(last?.activeSessions).toEqual([]);
    expect(last?.currentDateUtc).toBe("2026-04-30");
  });

  it("burst writes coalesce — at most 2 saves per burst regardless of size", async () => {
    vi.mocked(loadAciCostState).mockResolvedValue({
      completedTodayUsd: 0,
      currentDateUtc: "2026-04-30",
      activeSessions: [],
    });
    let resolveFirst: () => void = () => {};
    const firstWriteGate = new Promise<void>((r) => {
      resolveFirst = r;
    });
    // First save is blocked; subsequent saves coalesce into a single follow-up.
    let callCount = 0;
    vi.mocked(saveAciCostState).mockImplementation(async () => {
      callCount += 1;
      if (callCount === 1) await firstWriteGate;
    });

    const t0 = Date.parse("2026-04-30T12:00:00Z");
    await aciCostTracker.init(t0);

    // 10 rapid state changes while the first persist is in flight.
    for (let i = 0; i < 10; i++) {
      aciCostTracker.recordSessionStart(`s${i}`, t0 + i);
    }
    // Release the first write — the coalesced follow-up should fire.
    resolveFirst();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    // 1 in-flight write + 1 coalesced follow-up = 2 writes total, not 10.
    expect(saveAciCostState).toHaveBeenCalledTimes(2);
  });

  it("rollover at UTC midnight triggers a write so yesterday's bucket isn't replayed", async () => {
    vi.mocked(loadAciCostState).mockResolvedValue({
      completedTodayUsd: 5.0,
      currentDateUtc: "2026-04-30",
      activeSessions: [],
    });
    vi.mocked(saveAciCostState).mockResolvedValue();

    const yesterday = Date.parse("2026-04-30T23:59:00Z");
    await aciCostTracker.init(yesterday);
    vi.mocked(saveAciCostState).mockClear();

    // Cross UTC midnight — any public call triggers rollover.
    const today = Date.parse("2026-05-01T00:01:00Z");
    aciCostTracker.spentTodayUsd(today);

    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    expect(saveAciCostState).toHaveBeenCalled();
    const last = vi.mocked(saveAciCostState).mock.calls.at(-1)?.[0];
    expect(last?.completedTodayUsd).toBe(0);
    expect(last?.currentDateUtc).toBe("2026-05-01");
  });

  it("save failure logs but does not throw out of recordSessionEnd", async () => {
    vi.mocked(loadAciCostState).mockResolvedValue({
      completedTodayUsd: 0,
      currentDateUtc: "2026-04-30",
      activeSessions: [],
    });
    vi.mocked(saveAciCostState).mockRejectedValue(new Error("DB write failed"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const t0 = Date.parse("2026-04-30T12:00:00Z");
    await aciCostTracker.init(t0);
    aciCostTracker.recordSessionStart("s1", t0);
    aciCostTracker.recordSessionEnd("s1", t0 + 5 * SEC_MS);

    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    // In-memory state is still correct even though DB write failed.
    expect(aciCostTracker.spentTodayUsd(t0 + 5 * SEC_MS)).toBeCloseTo(
      ACI_COST_RATE_USD_PER_SESSION_HOUR * (5 / 3600),
      6,
    );
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
