// Phase 24B P0-1: persistence layer for the ACI cost tracker.
//
// Reads + writes the singleton `aci_cost_state` row. The tracker
// (services/observability/aciCostTracker.ts) hydrates from this row
// at boot and writes back after every state change. Without this,
// a backend restart resets the daily cap to $0 — a launderable bug.

import { db } from "./client.js";

export interface AciCostStateRow {
  completedTodayUsd: number;
  currentDateUtc: string; // YYYY-MM-DD
  activeSessions: Array<{ sessionId: string; startedAt: number }>;
}

interface RawRow {
  completed_today_usd: string; // numeric → string in pg.js
  current_date_utc: string;
  active_sessions: unknown;
}

/**
 * Hydrate the cost-state singleton at backend boot. Returns a fresh
 * empty state if the row is somehow missing (defensive — the migration
 * seeds it, so this branch should never fire in prod).
 */
export async function loadAciCostState(): Promise<AciCostStateRow> {
  const sql = db();
  const rows = await sql<RawRow[]>`
    SELECT completed_today_usd, current_date_utc, active_sessions
      FROM public.aci_cost_state
     WHERE id = 'current'
  `;
  if (rows.length === 0) {
    // Migration didn't run, or singleton row was wiped. Return zero
    // state + today's UTC date. saveAciCostState below uses INSERT ON
    // CONFLICT so the next save recreates the row regardless of why
    // it's missing.
    return {
      completedTodayUsd: 0,
      currentDateUtc: new Date().toISOString().slice(0, 10),
      activeSessions: [],
    };
  }
  const r = rows[0];
  // Postgres `numeric` arrives as a string in postgres.js; parseFloat
  // loses precision past 15 digits but our values are bounded to a
  // handful of dollars per day — safe.
  const completedTodayUsd = parseFloat(r.completed_today_usd);
  const activeSessions = Array.isArray(r.active_sessions)
    ? (r.active_sessions as Array<{ sessionId: string; startedAt: number }>)
    : [];
  return {
    completedTodayUsd: Number.isFinite(completedTodayUsd) ? completedTodayUsd : 0,
    currentDateUtc: r.current_date_utc,
    activeSessions,
  };
}

/**
 * Persist the singleton row. Called by the tracker on every state
 * change (recordSessionStart, recordSessionEnd, maybeRollover). One
 * upsert per call — Postgres handles 1000s/s of single-row upserts
 * with no measurable latency impact at our scale.
 *
 * The DB is the durable view; the in-memory tracker is the runtime
 * authority. Brief drift (DB lags in-memory by a few ms) is acceptable
 * because the failure mode is "lose 1-2 seconds of cap accounting on
 * crash" — strictly safer than overestimating.
 */
export async function saveAciCostState(state: AciCostStateRow): Promise<void> {
  const sql = db();
  // INSERT ON CONFLICT keeps the save path correct even if the singleton
  // row was wiped manually (or the migration never seeded it). A plain
  // UPDATE would silently no-op in that case, leaving the tracker
  // believing it was persisting while the DB stayed empty.
  await sql`
    INSERT INTO public.aci_cost_state
      (id, completed_today_usd, current_date_utc, active_sessions, updated_at)
    VALUES
      ('current', ${state.completedTodayUsd}, ${state.currentDateUtc},
       ${sql.json(state.activeSessions)}, now())
    ON CONFLICT (id) DO UPDATE
      SET completed_today_usd = EXCLUDED.completed_today_usd,
          current_date_utc    = EXCLUDED.current_date_utc,
          active_sessions     = EXCLUDED.active_sessions,
          updated_at          = EXCLUDED.updated_at
  `;
}
