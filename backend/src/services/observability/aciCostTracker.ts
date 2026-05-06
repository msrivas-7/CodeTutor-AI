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
//
// === P0-2 (audit fix): atomic cost reservation ======================
//
// Without reservations, two concurrent spawns both call exceedsDailyCap()
// before either has registered its session — both see "still under cap"
// and both spawn. Repeated under load, this lets the cap be punched
// through by ~N × hourly_rate × max_session_duration before the next
// recordSessionStart fires.
//
// Fix: tryReserve(estimatedDurationMs, dailyCapUsd) atomically projects
// the spend INCLUDING this hypothetical session. If it would exceed the
// cap, returns null. Otherwise it returns a token; spentTodayUsd() now
// includes the reservation amount, so the next concurrent attempt sees
// the reduced headroom. The caller MUST follow up with either:
//   - recordSessionStart(sessionId, now, reservationId)  — consumes it
//   - cancelReservation(id)                              — releases it
//
// Reservations are deliberately in-memory only (not persisted). Their
// scope is "between cap-check and recordSessionStart" — at most a few
// seconds of cold-start. On crash, dangling reservations vanish; the
// orphan reaper (P0-3) cleans up any partially-spawned containers, so
// the bookkeeping drift is bounded to whatever survived the crash window.
//
// === P0-1 (audit fix): Postgres persistence =========================
//
// Originally the tracker was in-process only — a SIGTERM/OOM/deploy/
// restart would zero `completedTodayUsd` and forget every active
// session. An attacker (or any routine deploy at 23:55 UTC) could
// trigger a restart to launder the daily cap to $0 and continue
// spawning ACI containers past the intended ceiling.
//
// Fix: persist `{completedTodayUsd, currentDateUtc, activeSessions}`
// to a singleton Postgres row (`aci_cost_state`, see migration
// 20260430050000_aci_cost_state.sql). The tracker hydrates from this
// row on `init()` at backend boot and writes back after every state-
// changing call (start/end/rollover). The DB is the durable view;
// in-memory remains the runtime authority. Brief drift (DB lags
// in-memory by ms) is acceptable because the failure mode is "lose
// 1-2 seconds of cap accounting on crash" — strictly safer than
// overestimating.

import {
  loadAciCostState,
  saveAciCostState,
  type AciCostStateRow,
} from "../../db/aciCostState.js";

// ACI rate for 1 vCPU + 0.5 GB in eastus2, Standard tier. Source: Azure
// Retail Prices API (2026-05-06 verification):
//   vCPU:   $0.0405/hr × 1 = $0.0405
//   memory: $0.00445/GB-hr × 0.5 = $0.002225
//   total:  $0.042725/hour
// Was $0.053 pre-2026-05-06 — that constant inflated displayed spend by
// ~24% vs Azure's actual invoice (kill switch fired earlier than needed).
// Daily-cap kill switch is still safety-side conservative because of the
// per-spawn 1-hour reservation projection in tryReserve.
const ACI_RATE_USD_PER_SESSION_HOUR = 0.0427;

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
  // P0-1: DB persistence. `persistEnabled` defaults false (env-tests
  // don't have a DB). `init()` flips it on after a successful hydrate.
  // Tests can pass `__skipPersistence` to keep the tracker fully in-memory.
  private persistEnabled = false;
  // Coalesce concurrent persist calls — only the latest snapshot
  // matters. Holds the most recent persist-in-flight promise.
  private persistInFlight: Promise<void> | null = null;
  // Marks "another change happened while a persist was in-flight" so
  // we trigger a follow-up write with the newer state.
  private persistDirty = false;
  // P0-2: reservation_id → estimatedUsd. Held between tryReserve() and
  // recordSessionStart() / cancelReservation(). Counted into spentTodayUsd
  // so concurrent spawn attempts see each other's pending charges.
  private readonly reservations = new Map<string, number>();
  private reservationCounter = 0;
  // P0-2 (second-audit fix): track whether init() has successfully
  // hydrated from the persisted singleton row. When `degraded`, the
  // accumulator is volatile-only — a backend that crashed mid-day
  // would have its non-persisted in-flight spend wiped on restart,
  // leaving the kill switch trivially bypassable. Cap-evaluation
  // returns true (fail-closed) in this state. Default `hydrated` so
  // unit tests using __forceForTests don't all start refusing spawn
  // (production path forces this flag via init()).
  private hydrationState: "hydrated" | "degraded" = "hydrated";

  /**
   * Hydrate from the persisted singleton row + enable write-through
   * persistence on subsequent state changes. Call once at backend
   * boot, BEFORE any session lifecycle calls — a second call would
   * clobber any in-memory recordSessionStart() entries that hadn't
   * been persisted yet, since we clear-and-repopulate `active` from
   * the DB row. Reservations are not in the DB and not cleared, but
   * those are bound to in-flight createSession calls anyway.
   *
   * Safe against DB unreachable: logs + leaves the tracker in zeroed
   * state, persistEnabled stays false so we don't blast the DB with
   * failing writes.
   */
  async init(now: number = Date.now()): Promise<void> {
    let row: AciCostStateRow;
    try {
      row = await loadAciCostState();
    } catch (err) {
      // DB unreachable at boot — log loudly + flip to degraded state
      // so cap-evaluation fails closed. P0-2 (second-audit fix): pre-
      // fix this returned silently with a $0 accumulator, leaving
      // exceedsDailyCap to evaluate `0 >= 20 = false` and let
      // overflow spawn unbounded against a zeroed cap until DB
      // recovered. Now the kill switch refuses every spawn until
      // init() succeeds (which requires a backend restart since
      // init() is one-shot at boot).
      this.hydrationState = "degraded";
      console.error(
        JSON.stringify({
          level: "error",
          evt: "aci_cost_tracker_init_failed",
          err: (err as Error).message,
        }),
      );
      return;
    }

    // Apply hydrated state.
    //
    // P1-6 (second-audit fix): handle cross-day restart correctly.
    // Pre-fix init() loaded `row.currentDateUtc` (yesterday) + added
    // FULL orphan-elapsed time into `completedTodayUsd`, then called
    // maybeRollover which zeroed it. Result: legitimately-yesterday-
    // accrued time was double-counted briefly then lost to zero. AND:
    // the orphan-bill for the pre-midnight portion was discarded
    // along with the rollover, the post-midnight portion was lost
    // too. Now we explicitly:
    //   1. Advance currentDateUtc to today.
    //   2. Reset completedTodayUsd to 0 if the persisted row was for
    //      a different day (rollover semantics).
    //   3. Bill ONLY the post-midnight portion of each orphan's
    //      elapsed time into today's bucket.
    const today = nowUtcDate(now);
    const isCrossDay = row.currentDateUtc !== today;
    this.completedTodayUsd = isCrossDay ? 0 : row.completedTodayUsd;
    this.currentDateUtc = today;
    this.active.clear();

    // P0-1 (first-audit review fix): hydrated `active` entries from
    // DB are ORPHANED by definition — we just restarted, so no
    // in-process handle exists for them. The boot-time orphan reaper
    // in AciExecutionBackend will delete the Azure-side containers
    // shortly. Roll their TODAY-PORTION accrued time into
    // completedTodayUsd here so spentTodayUsd doesn't keep growing
    // forever as if they were still running.
    const todayMidnightMs = Date.UTC(
      new Date(now).getUTCFullYear(),
      new Date(now).getUTCMonth(),
      new Date(now).getUTCDate(),
    );
    let orphanedSessions = 0;
    let orphanedUsd = 0;
    for (const entry of row.activeSessions) {
      // Bill only the portion of the orphan's lifetime within today.
      // For same-day restarts this is `now - entry.startedAt`. For
      // cross-day restarts, `entry.startedAt` is clamped to midnight
      // so pre-midnight time is correctly attributed to yesterday's
      // (closed) bucket and not leaked into today.
      const billableStart = Math.max(entry.startedAt, todayMidnightMs);
      const durationMs = Math.max(0, now - billableStart);
      orphanedUsd +=
        (durationMs / 3_600_000) * ACI_RATE_USD_PER_SESSION_HOUR;
      orphanedSessions += 1;
    }
    this.completedTodayUsd += orphanedUsd;
    this.persistEnabled = true;
    this.hydrationState = "hydrated";
    // No maybeRollover here — we already advanced currentDateUtc above
    // and rebased orphan time into today's bucket. Calling rollover
    // would re-zero completedTodayUsd if isCrossDay, undoing the
    // orphan rollup we just did.

    console.log(
      JSON.stringify({
        level: "info",
        evt: "aci_cost_tracker_hydrated",
        completedTodayUsd: this.completedTodayUsd,
        currentDateUtc: this.currentDateUtc,
        orphanedSessions,
        orphanedUsd,
      }),
    );

    // Persist the rolled-over state immediately so the next read
    // doesn't re-hydrate the orphans on a re-init or a fresh boot.
    this.schedulePersist();
  }

  /**
   * A session has just become billable. Call this AFTER createSession
   * succeeds (cold start finished, agent reachable). A failed spawn
   * should NOT be recorded — Azure may have billed for the partial
   * spawn, but at <1 minute per failed cold start that's bounded by the
   * coldStartTimeoutMs config and not worth a separate bookkeeping path.
   *
   * P0-2: if `reservationId` is provided, it is consumed atomically with
   * adding the active-session entry. This avoids a brief window where
   * both the reservation AND the in-flight session bill, which would
   * over-trip the cap kill switch.
   */
  recordSessionStart(
    sessionId: string,
    now: number = Date.now(),
    reservationId?: string,
  ): void {
    this.maybeRollover(now);
    if (reservationId !== undefined) {
      this.reservations.delete(reservationId);
    }
    this.active.set(sessionId, now);
    this.schedulePersist();
  }

  /**
   * P0-2: atomic cost-cap check + budget reservation. Returns null if
   * granting this spawn would put projected spend over `dailyCapUsd`,
   * otherwise a token to be passed back via `recordSessionStart()` (on
   * spawn success) or `cancelReservation()` (on spawn failure).
   *
   * The race we're closing: many concurrent spawn attempts all read
   * `exceedsDailyCap()` and all see "under cap" because none have called
   * recordSessionStart yet. tryReserve increments the projected spend
   * synchronously, so the second concurrent caller sees the first's
   * pending charge.
   *
   * `estimatedDurationMs` should be a conservative upper bound on the
   * session's billable lifetime. Reserving too small lets bursts past
   * the cap; reserving too large refuses spawns that would have fit.
   * A 1-hour estimate ($0.053) is the typical session ceiling.
   */
  tryReserve(
    estimatedDurationMs: number,
    dailyCapUsd: number,
    now: number = Date.now(),
  ): string | null {
    // P0-2 (second-audit fix): refuse all reservations when degraded.
    // Mirrors exceedsDailyCap's fail-closed posture so cold-start +
    // warm-spawn paths both turn into ARM no-ops on a DB outage.
    if (this.hydrationState === "degraded") return null;
    this.maybeRollover(now);
    const estimatedUsd =
      (Math.max(0, estimatedDurationMs) / 3_600_000) *
      ACI_RATE_USD_PER_SESSION_HOUR;
    const projected = this.computeSpentTodayUsd(now) + estimatedUsd;
    if (projected > dailyCapUsd) return null;
    const id = `r-${++this.reservationCounter}-${now}`;
    this.reservations.set(id, estimatedUsd);
    // No persist for reservations — they're transient (cold-start window
    // only). On crash they vanish; orphan reaper handles partial spawns.
    return id;
  }

  /**
   * P0-2: release a reservation that didn't end up producing a session
   * (spawn failed before recordSessionStart was called). Idempotent —
   * unknown ids silently no-op so a double-cancel can't blow up the
   * caller's error-handling path.
   */
  cancelReservation(id: string): void {
    this.reservations.delete(id);
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
    this.schedulePersist();
  }

  /**
   * Operator-facing total spend today (UTC) — what shows in the admin
   * dashboard "ACI spent today". Includes:
   *   - sum of all sessions that ENDED today
   *   - sum of all sessions still RUNNING, billed up to `now`
   *
   * Does NOT include pending reservations — those are kill-switch
   * accounting only. Pre-2026-05-06 this method DID include reservations,
   * which led to confusing operator UX: a 1-hour worst-case reservation
   * per in-flight spawn ($0.0427 each) made the displayed spend jump
   * during cold-start churn and "drop" when reservations released, even
   * though no real money was being un-spent. Reservations are a control-
   * plane construct — they belong in projectedSpentTodayUsd, not here.
   */
  spentTodayUsd(now: number = Date.now()): number {
    this.maybeRollover(now);
    return this.completedTodayUsd + this.activeSpendUsd(now);
  }

  /**
   * Kill-switch-facing projection. Includes everything spentTodayUsd
   * counts, PLUS the worst-case-1-hour reservations held by in-flight
   * spawns. Used by tryReserve + exceedsDailyCap so concurrent spawn
   * attempts see each other's pending charges and the daily cap can't
   * be punched through during cold-start windows.
   */
  projectedSpentTodayUsd(now: number = Date.now()): number {
    this.maybeRollover(now);
    return this.computeSpentTodayUsd(now);
  }

  private activeSpendUsd(now: number): number {
    let usd = 0;
    for (const startedAt of this.active.values()) {
      const durationMs = Math.max(0, now - startedAt);
      usd += (durationMs / 3_600_000) * ACI_RATE_USD_PER_SESSION_HOUR;
    }
    return usd;
  }

  private computeSpentTodayUsd(now: number): number {
    let reservedUsd = 0;
    for (const r of this.reservations.values()) reservedUsd += r;
    return this.completedTodayUsd + this.activeSpendUsd(now) + reservedUsd;
  }

  /**
   * True iff today's spend has hit or exceeded the configured daily cap,
   * OR the tracker is degraded (init() failed, accumulator is volatile).
   * P0-2 (second-audit fix): fail-closed when degraded — a $0 accumulator
   * with the gate open lets overflow spawn unbounded until DB recovers.
   */
  exceedsDailyCap(dailyCapUsd: number, now: number = Date.now()): boolean {
    if (this.hydrationState === "degraded") return true;
    // Use projected (reservations-included) here — kill switch must see
    // in-flight spawns' worst-case budget so concurrent callers can't
    // collectively punch through the cap during cold-start windows.
    return this.projectedSpentTodayUsd(now) >= dailyCapUsd;
  }

  /**
   * P0-2: hydration-state surface for deep-health and metrics.
   *   "hydrated" — init() successfully loaded the persisted row.
   *   "degraded" — init() was attempted but the DB read threw.
   * Default in unit tests is "hydrated" because tests bypass init();
   * production sets this via init() at boot.
   */
  getHydrationState(): "hydrated" | "degraded" {
    return this.hydrationState;
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
    // Rollover changed state — push to DB so a midnight-crossing
    // crash doesn't replay yesterday's bucket.
    this.schedulePersist();
  }

  /**
   * Schedule a write-through to the persisted state. Coalesces bursts:
   * if a write is already in flight, mark dirty so the in-flight one's
   * completion handler triggers a follow-up. This bounds DB load at
   * ~2 writes per state-change burst regardless of burst size.
   *
   * Persistence is fire-and-forget from the caller's perspective —
   * `recordSessionStart/End` return synchronously. The DB is best-effort
   * durable; in-memory is authoritative. A failed write logs but does
   * not propagate up (we'd rather under-record than block the hot path).
   */
  private schedulePersist(): void {
    if (!this.persistEnabled) return;
    if (this.persistInFlight) {
      this.persistDirty = true;
      return;
    }
    this.persistInFlight = this.persistNow().finally(() => {
      this.persistInFlight = null;
      if (this.persistDirty) {
        this.persistDirty = false;
        this.schedulePersist();
      }
    });
  }

  private async persistNow(): Promise<void> {
    const snapshot: AciCostStateRow = {
      completedTodayUsd: this.completedTodayUsd,
      currentDateUtc: this.currentDateUtc,
      activeSessions: Array.from(this.active.entries()).map(
        ([sessionId, startedAt]) => ({ sessionId, startedAt }),
      ),
    };
    try {
      await saveAciCostState(snapshot);
    } catch (err) {
      console.error(
        JSON.stringify({
          level: "error",
          evt: "aci_cost_tracker_persist_failed",
          err: (err as Error).message,
        }),
      );
    }
  }

  /**
   * Test-only: force the accumulator state. Skips persistence by
   * default (test would otherwise hit the DB). Tests that want to
   * exercise the persist path can use `init()` against a real DB
   * mock instead.
   */
  __forceForTests(state: {
    completedTodayUsd?: number;
    currentDateUtc?: string;
    activeSessions?: Array<[string, number]>;
    persistEnabled?: boolean;
    hydrationState?: "hydrated" | "degraded";
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
    if (state.persistEnabled !== undefined) {
      this.persistEnabled = state.persistEnabled;
    }
    if (state.hydrationState !== undefined) {
      this.hydrationState = state.hydrationState;
    } else {
      // Default to "hydrated" for tests not specifically asserting the
      // degraded fail-closed path. Without this, every existing cap
      // test would need to explicitly set hydrationState.
      this.hydrationState = "hydrated";
    }
    // P0-2: reservations are transient and should never survive a test
    // reset — leaks from one test would contaminate another's cap math.
    this.reservations.clear();
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
