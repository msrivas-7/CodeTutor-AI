// Phase 20-P4: ai_usage_ledger reads + writes. Every finished AI call writes
// exactly one row via `writeUsageRow`. The credential resolver reads three
// aggregates from this same table: today's platform question count (L1),
// today's per-user platform $ (L2), lifetime per-user platform $ (L3), and
// today's global platform $ (L4). Partial indexes in the migration keep all
// four paths cheap (funding_source='platform' is the only labeled subset we
// query aggregates over).

import { db } from "./client.js";

export interface WriteUsageRow {
  userId: string;
  model: string;
  fundingSource: "byok" | "platform";
  route: "ask" | "ask_stream" | "summarize";
  countsTowardQuota: boolean;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  priceVersion: number;
  status: "finish" | "error" | "aborted";
  requestId: string;
}

export async function writeUsageRow(row: WriteUsageRow): Promise<void> {
  const sql = db();
  await sql`
    INSERT INTO public.ai_usage_ledger (
      user_id, model, funding_source, route, counts_toward_quota,
      input_tokens, output_tokens, cost_usd, price_version,
      status, request_id
    ) VALUES (
      ${row.userId}, ${row.model}, ${row.fundingSource}, ${row.route},
      ${row.countsTowardQuota}, ${row.inputTokens}, ${row.outputTokens},
      ${row.costUsd}, ${row.priceVersion}, ${row.status}, ${row.requestId}
    )
  `;
}

// UTC day boundary. We normalize to midnight UTC so the daily quota counter
// resets at the same instant for every user globally — operator-friendly
// rather than per-timezone, which would mean tracking a tz column per user.
export function startOfUtcDay(now: Date = new Date()): Date {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

// L1: platform questions counted toward the learner-visible 30/day counter.
// /summarize writes rows with counts_toward_quota=false, so this count is
// stable against unseen summarize calls.
//
// H-2 serialization: the caller wraps this inside a transaction that takes
// `pg_advisory_xact_lock(hashtext(user_id)::bigint)` so two concurrent
// resolveAICredential calls for the same user (multi-tab race) observe a
// consistent count. Without the lock, tab A reads 29 just before tab B
// reads 29, both proceed, and both write rows → user consumes 31/30. The
// lock is per-user so cross-user throughput is unaffected.
export async function countPlatformQuestionsTodayLocked(
  userId: string,
  since: Date,
): Promise<number> {
  const sql = db();
  // sql.begin executes inside a transaction; pg_advisory_xact_lock is
  // automatically released at COMMIT/ROLLBACK so no explicit release needed.
  const result = await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${userId})::bigint)`;
    const rows = await tx<Array<{ n: number }>>`
      SELECT COUNT(*)::int AS n
        FROM public.ai_usage_ledger
       WHERE funding_source = 'platform'
         AND counts_toward_quota = true
         AND user_id = ${userId}
         AND created_at >= ${since}
    `;
    return rows[0]?.n ?? 0;
  });
  return result as number;
}

// Unlocked variant retained for tests + non-cap-enforcing callers that
// just need a quick read. The cap-enforcement path MUST use the locked
// variant — a stale count here bypasses the per-user cap.
export async function countPlatformQuestionsToday(
  userId: string,
  since: Date,
): Promise<number> {
  const sql = db();
  const rows = await sql<Array<{ n: number }>>`
    SELECT COUNT(*)::int AS n
      FROM public.ai_usage_ledger
     WHERE funding_source = 'platform'
       AND counts_toward_quota = true
       AND user_id = ${userId}
       AND created_at >= ${since}
  `;
  return rows[0]?.n ?? 0;
}

// L2: per-user daily platform $ spend across ALL routes (including /summarize).
export async function sumPlatformCostTodayForUser(
  userId: string,
  since: Date,
): Promise<number> {
  const sql = db();
  const rows = await sql<Array<{ total: string | null }>>`
    SELECT SUM(cost_usd)::text AS total
      FROM public.ai_usage_ledger
     WHERE funding_source = 'platform'
       AND user_id = ${userId}
       AND created_at >= ${since}
  `;
  return Number(rows[0]?.total ?? 0);
}

// L3: per-user lifetime platform $ spend across ALL routes.
export async function sumPlatformCostLifetimeForUser(
  userId: string,
): Promise<number> {
  const sql = db();
  const rows = await sql<Array<{ total: string | null }>>`
    SELECT SUM(cost_usd)::text AS total
      FROM public.ai_usage_ledger
     WHERE funding_source = 'platform'
       AND user_id = ${userId}
  `;
  return Number(rows[0]?.total ?? 0);
}

// L4: global daily platform $ spend across ALL users + routes.
export async function sumPlatformCostTodayGlobal(since: Date): Promise<number> {
  const sql = db();
  const rows = await sql<Array<{ total: string | null }>>`
    SELECT SUM(cost_usd)::text AS total
      FROM public.ai_usage_ledger
     WHERE funding_source = 'platform'
       AND created_at >= ${since}
  `;
  return Number(rows[0]?.total ?? 0);
}
