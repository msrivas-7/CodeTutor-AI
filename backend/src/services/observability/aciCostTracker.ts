// Phase 24B: ACI cost tracker — per-session event-based accounting.
//
// Azure ACI bills by the second, with the rate ($0.053/hour) just an
// accounting unit. A 15-second session costs $0.000221; a 5-minute
// session costs $0.0044. The tracker has to match that precision so
// the daily-cap kill switch agrees with Azure's invoice.
//
// Algorithm:
//
//   recordSessionStart(id, now)  → active.set(id, now)
//   recordSessionEnd(id, now)    → completed += (now - start) × rate
//                                  active.delete(id)
//   spentTodayUsd(now)           = completed + Σ_active (now - start) × rate
//
// In-flight sessions are billed up to the moment of the read, which is
// exactly what Azure does — there's no "we'll true-up later" gap.
// Completed sessions are summed once at end; the daily accumulator is
// the only growing number.
//
// UTC midnight rollover is handled by `maybeRollover`: today's completed
// total resets to 0, AND any cross-midnight active sessions have their
// start times rebased to midnight so we don't credit yesterday's seconds
// to today's bucket.

const ACI_RATE_USD_PER_SESSION_HOUR = 0.053;

class AciCostTracker {
  // Cumulative cost from sessions that have already ended today (UTC).
  private completedTodayUsd = 0;
  // Currently-running sessions: sessionId → startTimeMs. Multi-day
  // sessions stay in the map across midnight; their start times get
  // rebased on rollover so today's bucket only contains today's seconds.
  private readonly active = new Map<string, number>();
  // YYYY-MM-DD (UTC) of the last activity. Detection at every public
  // entry point, so no separate timer drifts the rollover.
  private currentDateUtc = nowUtcDate();

  /**
   * A session has just become billable. Call this AFTER createSession
   * succeeds (cold start finished, agent reachable). A failed spawn
   * should NOT be recorded — Azure may have billed for the partial
   * spawn, but at <1 minute per failed cold start that's bounded by the
   * coldStartTimeoutMs config and not worth a separate bookkeeping path.
   */
  recordSessionStart(sessionId: string, now: number = Date.now()): void {
    this.maybeRollover(now);
    this.active.set(sessionId, now);
  }

  /**
   * A session is being destroyed. Records its full duration into today's
   * completed bucket (clamped to ≥0 against clock skew). Idempotent —
   * a missing sessionId is a silent no-op (e.g., destroy was called
   * twice, or recordSessionStart was never called for this handle).
   */
  recordSessionEnd(sessionId: string, now: number = Date.now()): void {
    this.maybeRollover(now);
    const startedAt = this.active.get(sessionId);
    if (startedAt === undefined) return;
    this.active.delete(sessionId);
    const durationMs = Math.max(0, now - startedAt);
    this.completedTodayUsd +=
      (durationMs / 3_600_000) * ACI_RATE_USD_PER_SESSION_HOUR;
  }

  /**
   * Total cost incurred so far today (UTC). Includes:
   *   - sum of all sessions that ENDED today
   *   - sum of all sessions still RUNNING, billed up to `now`
   * Read on every kill-switch check + every hourly emission.
   */
  spentTodayUsd(now: number = Date.now()): number {
    this.maybeRollover(now);
    let inProgressUsd = 0;
    for (const startedAt of this.active.values()) {
      const durationMs = Math.max(0, now - startedAt);
      inProgressUsd +=
        (durationMs / 3_600_000) * ACI_RATE_USD_PER_SESSION_HOUR;
    }
    return this.completedTodayUsd + inProgressUsd;
  }

  /** True iff today's spend has hit or exceeded the configured daily cap. */
  exceedsDailyCap(dailyCapUsd: number, now: number = Date.now()): boolean {
    return this.spentTodayUsd(now) >= dailyCapUsd;
  }

  /**
   * Read-only snapshot for the hourly sampler emission + metric collection.
   *   - spentTodayUsd:    cumulative cost incurred today, including in-flight
   *   - hourlyBurnRateUsd: instantaneous burn at this moment = active × rate
   *   - activeSessions:   currently-running session count
   *   - currentDateUtc:   the UTC calendar day the tracker is accumulating into
   */
  getStatus(now: number = Date.now()): {
    spentTodayUsd: number;
    hourlyBurnRateUsd: number;
    activeSessions: number;
    currentDateUtc: string;
  } {
    return {
      spentTodayUsd: this.spentTodayUsd(now),
      hourlyBurnRateUsd: this.active.size * ACI_RATE_USD_PER_SESSION_HOUR,
      activeSessions: this.active.size,
      currentDateUtc: this.currentDateUtc,
    };
  }

  private maybeRollover(now: number): void {
    const today = nowUtcDate(now);
    if (today === this.currentDateUtc) return;

    // UTC midnight has rolled over (could be one or several days; we
    // treat the gap as a single rollover since cap is daily).
    this.completedTodayUsd = 0;
    this.currentDateUtc = today;

    // Cross-midnight sessions: rebase their start times to today's
    // midnight so the next spentTodayUsd read only credits today's
    // seconds. Without this, a session that's been running for 30
    // hours would suddenly bill 30h to today's bucket and trip the cap.
    const midnightMs = Date.UTC(
      new Date(now).getUTCFullYear(),
      new Date(now).getUTCMonth(),
      new Date(now).getUTCDate(),
    );
    for (const [id, startedAt] of this.active) {
      if (startedAt < midnightMs) {
        this.active.set(id, midnightMs);
      }
    }
  }

  /** Test-only: force the accumulator state. Never call in prod code. */
  __forceForTests(state: {
    completedTodayUsd?: number;
    currentDateUtc?: string;
    activeSessions?: Array<[string, number]>;
  }): void {
    if (state.completedTodayUsd !== undefined) {
      this.completedTodayUsd = state.completedTodayUsd;
    }
    if (state.currentDateUtc !== undefined) {
      this.currentDateUtc = state.currentDateUtc;
    }
    if (state.activeSessions !== undefined) {
      this.active.clear();
      for (const [id, t] of state.activeSessions) {
        this.active.set(id, t);
      }
    }
  }
}

function nowUtcDate(now: number = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

// Process-wide singleton — single-tenant Express backend, no benefit to
// passing through every layer. Imported by AciExecutionBackend (record
// session lifecycle), HybridBackend's factory wire (kill-switch check),
// and aciCostSampler (hourly emit).
export const aciCostTracker = new AciCostTracker();

export const ACI_COST_RATE_USD_PER_SESSION_HOUR = ACI_RATE_USD_PER_SESSION_HOUR;
