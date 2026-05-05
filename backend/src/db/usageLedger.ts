// Phase 20-P4: ai_usage_ledger reads + writes. Every finished AI call writes
// exactly one row via `writeUsageRow`. The credential resolver reads three
// aggregates from this same table: today's platform question count (L1),
// today's per-user platform $ (L2), lifetime per-user platform $ (L3), and
// today's global platform $ (L4). Partial indexes in the migration keep all
// four paths cheap (funding_source='platform' is the only labeled subset we
// query aggregates over).
//
// P-H1 (adversarial audit, bucket 4b): L3 no longer scans the full per-user
// ledger history. Every platform row also bumps public.user_ai_costs in the
// same transaction, and sumPlatformCostLifetimeForUser reads the denorm
// directly. The ledger remains the durable source of truth — the denorm is
// always reconstructable from SUM(cost_usd) WHERE funding_source='platform'
// if anything ever drifts.
//
// Phase 27 §3d: anonymous (signed-out) traffic writes to a SECOND ledger
// table — public.ai_anon_usage_ledger — keyed by ip_hash instead of
// user_id. The anon helpers live at the bottom of this file. The L4
// global $ cap is the one observer that must combine BOTH tables: the
// resolver enforces the cap by summing them, so every observability
// surface (budgetWatcher alert ladder, admin dashboard "today spend"
// tile, hourly platformCostSampler marker) MUST call
// `sumPlatformCostTodayAllSources` rather than the per-table helpers.
// Diverging would break the watcher/resolver agreement: the alert
// ladder would show $X while the resolver enforces $X+anon.

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
  // P-H1: wrap the ledger INSERT and the user_ai_costs UPSERT in one tx so
  // the denorm can never be ahead of the ledger (or vice versa). Only
  // platform rows contribute to L3, so BYOK + zero-cost rows skip the
  // denorm update — writing 0 would still bump updated_at for no reason.
  await sql.begin(async (tx) => {
    await tx`
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
    if (row.fundingSource === "platform" && row.costUsd > 0) {
      await tx`
        INSERT INTO public.user_ai_costs (user_id, lifetime_cost_usd, updated_at)
        VALUES (${row.userId}, ${row.costUsd}, now())
        ON CONFLICT (user_id) DO UPDATE
          SET lifetime_cost_usd =
                public.user_ai_costs.lifetime_cost_usd + EXCLUDED.lifetime_cost_usd,
              updated_at        = now()
      `;
    }
  });
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

// L3: per-user lifetime platform $ spend across ALL routes. P-H1: served
// from the denorm table user_ai_costs, which writeUsageRow updates in the
// same tx as every platform ledger row. New users with no ledger rows have
// no denorm row either, so a missing row reads as $0 (not an error).
export async function sumPlatformCostLifetimeForUser(
  userId: string,
): Promise<number> {
  const sql = db();
  const rows = await sql<Array<{ total: string | null }>>`
    SELECT lifetime_cost_usd::text AS total
      FROM public.user_ai_costs
     WHERE user_id = ${userId}
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

// =============================================================================
// Phase 27 §3d — anonymous AI usage ledger.
//
// Anonymous traffic has no auth.users.id, so it can't write to the authed
// ledger (FK + NOT NULL). The migration adds public.ai_anon_usage_ledger
// keyed by ip_hash. The helpers below mirror the authed ones:
//   - writeAnonUsageRow            mirrors writeUsageRow
//   - countPlatformQuestionsOnIpTodayLocked  mirrors countPlatformQuestionsTodayLocked (L_anon)
//   - sumPlatformCostTodayAnonGlobal mirrors sumPlatformCostTodayGlobal (L4 anon spend)
//
// Anon traffic does NOT bump user_ai_costs (no user_id to denorm against)
// and does NOT have a lifetime cap (L3 doesn't apply — we don't track per-IP
// across days; ip can rotate and we'd be over-blocking honest reuse). The
// daily count cap (L_anon) plus the GLOBAL $ cap (L4, summed across both
// tables) plus the per-request output-token clamp + deadline (Phase 27 §3b)
// are the bounded-cost envelope.
// =============================================================================

export interface WriteAnonUsageRow {
  ipHash: string;
  model: string;
  // Anon never uses BYOK — fundingSource is implicit "platform". Kept as
  // a field name parity with WriteUsageRow so the call sites read alike.
  route: "ask" | "ask_stream";
  countsTowardQuota: boolean;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  priceVersion: number;
  status: "finish" | "error" | "aborted";
  requestId: string;
}

export async function writeAnonUsageRow(row: WriteAnonUsageRow): Promise<void> {
  const sql = db();
  await sql`
    INSERT INTO public.ai_anon_usage_ledger (
      ip_hash, model, funding_source, route, counts_toward_quota,
      input_tokens, output_tokens, cost_usd, price_version,
      status, request_id
    ) VALUES (
      ${row.ipHash}, ${row.model}, 'platform', ${row.route},
      ${row.countsTowardQuota}, ${row.inputTokens}, ${row.outputTokens},
      ${row.costUsd}, ${row.priceVersion}, ${row.status}, ${row.requestId}
    )
  `;
}

// L_anon: per-IP-hash daily question count, used to gate anon AI calls.
// Same advisory-lock pattern as countPlatformQuestionsTodayLocked so two
// concurrent anon requests from the same IP can't both observe a pre-
// insert count and bypass the cap. Lock key uses hashtext of the
// already-hashed IP (no FK or PK type mismatch with the authed lock).
export async function countPlatformQuestionsOnIpTodayLocked(
  ipHash: string,
  since: Date,
): Promise<number> {
  const sql = db();
  const result = await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${ipHash})::bigint)`;
    const rows = await tx<Array<{ n: number }>>`
      SELECT COUNT(*)::int AS n
        FROM public.ai_anon_usage_ledger
       WHERE counts_toward_quota = true
         AND ip_hash = ${ipHash}
         AND created_at >= ${since}
    `;
    return rows[0]?.n ?? 0;
  });
  return result as number;
}

// Unlocked variant for tests + non-cap-enforcing readers (e.g., a future
// /admin/anon-stats panel). Cap-enforcement path MUST use the locked
// variant.
export async function countPlatformQuestionsOnIpToday(
  ipHash: string,
  since: Date,
): Promise<number> {
  const sql = db();
  const rows = await sql<Array<{ n: number }>>`
    SELECT COUNT(*)::int AS n
      FROM public.ai_anon_usage_ledger
     WHERE counts_toward_quota = true
       AND ip_hash = ${ipHash}
       AND created_at >= ${since}
  `;
  return rows[0]?.n ?? 0;
}

// L4 anon contribution: global daily $ across ALL anon traffic. Caller
// adds this to sumPlatformCostTodayGlobal() before comparing to the
// global cap so anon spend counts toward the same ceiling — anon
// can't blow past the cap by virtue of writing to a different table.
export async function sumPlatformCostTodayAnonGlobal(since: Date): Promise<number> {
  const sql = db();
  const rows = await sql<Array<{ total: string | null }>>`
    SELECT SUM(cost_usd)::text AS total
      FROM public.ai_anon_usage_ledger
     WHERE created_at >= ${since}
  `;
  return Number(rows[0]?.total ?? 0);
}

// Phase 27 §3d: unified L4 view. Returns today's global platform $ spend
// across BOTH the authed ledger AND the anon ledger. Every observability
// surface (budgetWatcher 50/80/100% alert ladder, admin dashboard
// "today spend" tile, hourly platformCostSampler log marker that drives
// the "$30 in 1 hour" page-oncall alert) MUST use this — the resolver's
// L4 hard-cap check uses the same combined sum, so blind any single
// observer and the operator sees a different "today spend" than the
// resolver enforces. That divergence violates the "watcher and resolver
// always agree on what the cap is" invariant called out in the
// budgetWatcher header. Two queries, two indexed scans — cheap.
export async function sumPlatformCostTodayAllSources(since: Date): Promise<number> {
  const [authed, anon] = await Promise.all([
    sumPlatformCostTodayGlobal(since),
    sumPlatformCostTodayAnonGlobal(since),
  ]);
  return authed + anon;
}
