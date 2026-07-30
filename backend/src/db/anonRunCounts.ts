// Phase A — A5 (operational floor): per-IP daily run-count shield for
// POST /api/anon/run.
//
// The execution route is the expensive anon surface (each hit spawns a
// container: cold start + image pull + sidecar boot). Bursts are bounded
// by sessionCreateLimit (30/min/IP), but pre-A5 there was NO daily
// ceiling — a patient single IP could sustain ~43k spawns/UTC-day inside
// the per-minute budget. anon_run_counts (migration 20260507000000)
// persists a per-(ip_hash, day_utc) counter so a backend restart can't
// reset an abuser's tally.
//
// Increment-then-check: the counter increments on every hit, including
// rejected ones. That's intentional — an over-cap IP hammering the route
// keeps advancing its own counter, and the day row records true demand
// (useful when tuning the cap later). The UPSERT is a single round trip
// and atomic under concurrency (ON CONFLICT arbitration).

import { db } from "./client.js";

/**
 * Record one /run hit for this ip_hash today (UTC) and return the
 * post-increment count. Caller compares against the effective cap.
 * Throws on DB failure — the route treats that as fail-open (the
 * per-minute limiter still bounds worst-case) and logs.
 */
export async function incrementAnonRunCount(ipHash: string): Promise<number> {
  const sql = db();
  const rows = await sql<{ count: number }[]>`
    INSERT INTO public.anon_run_counts (ip_hash, day_utc, count)
    VALUES (${ipHash}, (now() AT TIME ZONE 'utc')::date, 1)
    ON CONFLICT (ip_hash, day_utc)
    DO UPDATE SET count = anon_run_counts.count + 1, updated_at = now()
    RETURNING count
  `;
  return rows[0].count;
}
