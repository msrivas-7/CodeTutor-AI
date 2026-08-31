import { createHash } from "node:crypto";
import type { TransactionSql } from "postgres";
import { db } from "./client.js";

export type AIReservationRoute = "ask" | "ask_stream" | "summarize";
export type AIReservationState =
  | "reserved"
  | "finalized"
  | "released"
  | "expired";
export type AIReservationLedgerStatus = "finish" | "error" | "aborted";

export type AIAdmissionDeniedReason =
  | "free_exhausted"
  | "daily_usd_per_user_hit"
  | "lifetime_usd_per_user_hit"
  | "usd_cap_hit"
  | "anon_exhausted";

export interface AIReservationCaps {
  globalDailyUsd: number;
  userDailyQuestions?: number;
  userDailyUsd?: number;
  userLifetimeUsd?: number;
  anonDailyQuestions?: number;
  anonDailyUsd?: number;
}

interface ReserveBase {
  requestId: string;
  requestFingerprint: string;
  fundingSource: "platform" | "byok";
  model: string;
  route: AIReservationRoute;
  countsTowardQuota: boolean;
  reservedInputTokens: number;
  reservedOutputTokens: number;
  reservedCostUsd: number;
  priceVersion: number;
  expiresInMs: number;
  contextualEvidenceEpisodeDigest?: string;
  contextualEvidenceDigests?: readonly string[];
}

export type ReserveAIRequestInput =
  | (ReserveBase & {
      actorKind: "user";
      userId: string;
      caps?: AIReservationCaps;
    })
  | (ReserveBase & {
      actorKind: "anonymous";
      ipHash: string;
      caps?: AIReservationCaps;
    });

export type ReserveAIRequestResult =
  | { ok: true; remainingToday: number | null }
  | {
      ok: false;
      kind: "denied";
      reason: AIAdmissionDeniedReason;
    }
  | {
      ok: false;
      kind: "duplicate";
      state: AIReservationState;
    }
  | { ok: false; kind: "evidence_replay" }
  | { ok: false; kind: "conflict" };

interface ReservationRow {
  request_id: string;
  actor_kind: "user" | "anonymous";
  user_id: string | null;
  ip_hash: string | null;
  funding_source: "platform" | "byok";
  model: string;
  route: AIReservationRoute;
  request_fingerprint: string;
  counts_toward_quota: boolean;
  reserved_input_tokens: number;
  reserved_output_tokens: number;
  reserved_cost_usd: string;
  price_version: number;
  state: AIReservationState;
  expires_at: Date;
}

interface UsageTotals {
  question_count: number;
  user_daily_cost: string;
  user_lifetime_cost: string;
  global_daily_cost: string;
  anon_daily_cost: string;
}

const ADMISSION_LOCK_KEY = "codetutor:ai-platform-admission:v1";
const EXPIRY_BATCH = 100;

/** Stable 64-hex digest used to reject request-id reuse with changed input. */
export function fingerprintAIRequest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function startOfUtcDay(now: Date = new Date()): Date {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

async function insertTerminalUsage(
  tx: TransactionSql<Record<string, unknown>>,
  row: ReservationRow,
  inputTokens: number,
  outputTokens: number,
  costUsd: number,
  ledgerStatus: AIReservationLedgerStatus,
  countsTowardQuota: boolean,
): Promise<void> {
  if (row.actor_kind === "user") {
    await tx`
      INSERT INTO public.ai_usage_ledger (
        user_id, model, funding_source, route, counts_toward_quota,
        input_tokens, output_tokens, cost_usd, price_version,
        status, request_id
      ) VALUES (
        ${row.user_id}, ${row.model}, ${row.funding_source}, ${row.route},
        ${countsTowardQuota}, ${inputTokens}, ${outputTokens}, ${costUsd},
        ${row.price_version}, ${ledgerStatus}, ${row.request_id}
      )
    `;
    if (row.funding_source === "platform" && costUsd > 0) {
      await tx`
        INSERT INTO public.user_ai_costs (user_id, lifetime_cost_usd, updated_at)
        VALUES (${row.user_id}, ${costUsd}, now())
        ON CONFLICT (user_id) DO UPDATE
          SET lifetime_cost_usd =
                public.user_ai_costs.lifetime_cost_usd
                + EXCLUDED.lifetime_cost_usd,
              updated_at = now()
      `;
    }
    return;
  }

  await tx`
    INSERT INTO public.ai_anon_usage_ledger (
      ip_hash, model, funding_source, route, counts_toward_quota,
      input_tokens, output_tokens, cost_usd, price_version,
      status, request_id
    ) VALUES (
      ${row.ip_hash}, ${row.model}, 'platform', ${row.route},
      ${countsTowardQuota}, ${inputTokens}, ${outputTokens}, ${costUsd},
      ${row.price_version}, ${ledgerStatus}, ${row.request_id}
    )
  `;
}

/**
 * Crash recovery runs under the same global admission lock as new platform
 * reservations. An expired request may already have reached the provider, so
 * it is charged at its full reservation and never retried under the same key.
 */
async function reconcileExpiredReservations(
  tx: TransactionSql<Record<string, unknown>>,
): Promise<number> {
  const expired = await tx<ReservationRow[]>`
    SELECT request_id, actor_kind, user_id, ip_hash, funding_source, model,
           route, request_fingerprint, counts_toward_quota,
           reserved_input_tokens, reserved_output_tokens,
           reserved_cost_usd::text, price_version, state, expires_at
      FROM public.ai_request_reservations
     WHERE state = 'reserved' AND expires_at <= now()
     ORDER BY expires_at
     LIMIT ${EXPIRY_BATCH}
     FOR UPDATE SKIP LOCKED
  `;

  for (const row of expired) {
    const reservedCost = Number(row.reserved_cost_usd);
    await insertTerminalUsage(
      tx,
      row,
      row.reserved_input_tokens,
      row.reserved_output_tokens,
      reservedCost,
      "aborted",
      false,
    );
    await tx`
      UPDATE public.ai_request_reservations
         SET state = 'expired',
             finalized_at = now(),
             final_input_tokens = reserved_input_tokens,
             final_output_tokens = reserved_output_tokens,
             final_cost_usd = reserved_cost_usd,
             ledger_status = 'aborted',
             provider_outcome_uncertain = true
       WHERE request_id = ${row.request_id} AND state = 'reserved'
    `;
  }
  return expired.length;
}

async function readUsageTotals(
  tx: TransactionSql<Record<string, unknown>>,
  input: ReserveAIRequestInput,
  dayStart: Date,
): Promise<UsageTotals> {
  const userId = input.actorKind === "user" ? input.userId : null;
  const ipHash = input.actorKind === "anonymous" ? input.ipHash : null;
  const rows = await tx<UsageTotals[]>`
    SELECT
      CASE
        WHEN ${input.actorKind}::text = 'user' THEN
          (
            SELECT COUNT(*)::int
              FROM public.ai_usage_ledger
             WHERE funding_source = 'platform'
               AND counts_toward_quota = true
               AND user_id = ${userId}
               AND created_at >= ${dayStart}
          ) + (
            SELECT COUNT(*)::int
              FROM public.ai_request_reservations
             WHERE state = 'reserved'
               AND funding_source = 'platform'
               AND counts_toward_quota = true
               AND user_id = ${userId}
          )
        ELSE
          (
            SELECT COUNT(*)::int
              FROM public.ai_anon_usage_ledger
             WHERE counts_toward_quota = true
               AND ip_hash = ${ipHash}
               AND created_at >= ${dayStart}
          ) + (
            SELECT COUNT(*)::int
              FROM public.ai_request_reservations
             WHERE state = 'reserved'
               AND funding_source = 'platform'
               AND counts_toward_quota = true
               AND ip_hash = ${ipHash}
          )
      END AS question_count,
      COALESCE((
        SELECT SUM(cost_usd)
          FROM public.ai_usage_ledger
         WHERE funding_source = 'platform'
           AND user_id = ${userId}
           AND created_at >= ${dayStart}
      ), 0)::text
      AS user_daily_cost,
      (
        COALESCE((
          SELECT lifetime_cost_usd
            FROM public.user_ai_costs
           WHERE user_id = ${userId}
        ), 0)
        + COALESCE((
          SELECT SUM(reserved_cost_usd)
            FROM public.ai_request_reservations
           WHERE state = 'reserved'
             AND funding_source = 'platform'
             AND user_id = ${userId}
        ), 0)
      )::text AS user_lifetime_cost,
      (
        COALESCE((SELECT SUM(cost_usd) FROM public.ai_usage_ledger
                   WHERE funding_source = 'platform'
                     AND created_at >= ${dayStart}), 0)
        + COALESCE((SELECT SUM(cost_usd) FROM public.ai_anon_usage_ledger
                     WHERE created_at >= ${dayStart}), 0)
        + COALESCE((SELECT SUM(reserved_cost_usd)
                     FROM public.ai_request_reservations
                    WHERE state = 'reserved'
                      AND funding_source = 'platform'), 0)
      )::text AS global_daily_cost,
      (
        COALESCE((SELECT SUM(cost_usd) FROM public.ai_anon_usage_ledger
                   WHERE ip_hash = ${ipHash}
                     AND created_at >= ${dayStart}), 0)
        + COALESCE((SELECT SUM(reserved_cost_usd)
                     FROM public.ai_request_reservations
                    WHERE state = 'reserved'
                      AND funding_source = 'platform'
                      AND ip_hash = ${ipHash}), 0)
      )::text AS anon_daily_cost
  `;
  const totals = rows[0];

  if (input.actorKind === "user") {
    const activeDaily = await tx<Array<{ total: string }>>`
      SELECT COALESCE(SUM(reserved_cost_usd), 0)::text AS total
        FROM public.ai_request_reservations
       WHERE state = 'reserved'
         AND funding_source = 'platform'
         AND user_id = ${input.userId}
    `;
    totals.user_daily_cost = String(
      Number(totals.user_daily_cost) + Number(activeDaily[0]?.total ?? 0),
    );
  }
  return totals;
}

/**
 * Atomically claims one AI action. Every platform-funded admission takes a
 * transaction-scoped global advisory lock; this deliberately favors a simple,
 * auditable wallet boundary over marginal throughput at the current scale.
 */
export async function reserveAIRequest(
  input: ReserveAIRequestInput,
): Promise<ReserveAIRequestResult> {
  if (!Number.isInteger(input.expiresInMs) || input.expiresInMs <= 0 || input.expiresInMs > 60_000) {
    throw new Error(`reservation TTL must be an integer in 1..60000 ms (got ${input.expiresInMs})`);
  }
  const submittedContextualEvidenceDigests = [
    ...(input.contextualEvidenceDigests ?? []),
  ];
  const terminalContextualEvidenceDigest =
    submittedContextualEvidenceDigests.at(-1) ?? null;
  const contextualEvidenceDigests = [...submittedContextualEvidenceDigests].sort();
  const contextualEvidenceEpisodeDigest = input.contextualEvidenceEpisodeDigest ?? null;
  if (
    contextualEvidenceDigests.length > 10 ||
    new Set(contextualEvidenceDigests).size !== contextualEvidenceDigests.length ||
    contextualEvidenceDigests.some((value) => !/^[0-9a-f]{64}$/.test(value))
  ) {
    throw new Error(
      "contextual evidence digests must contain at most 10 unique lowercase SHA-256 values",
    );
  }
  if (
    contextualEvidenceEpisodeDigest !== null &&
    !/^[0-9a-f]{64}$/.test(contextualEvidenceEpisodeDigest)
  ) {
    throw new Error("contextual evidence episode digest must be a lowercase SHA-256 value");
  }
  if (
    (contextualEvidenceDigests.length > 0) !==
    (contextualEvidenceEpisodeDigest !== null)
  ) {
    throw new Error(
      "contextual evidence receipts and their signed episode digest must be claimed together",
    );
  }
  const sql = db();
  return (await sql.begin(async (tx) => {
    if (input.fundingSource === "platform") {
      await tx`SELECT pg_advisory_xact_lock(hashtext(${ADMISSION_LOCK_KEY})::bigint)`;
      await reconcileExpiredReservations(tx);
    }
    // Claim the server-signed episode identity as the primary replay boundary.
    // Receipt claims remain defense-in-depth and preserve compatibility with
    // reservations created before episode-level claims were introduced.
    if (contextualEvidenceEpisodeDigest) {
      await tx`
        SELECT pg_advisory_xact_lock(
          hashtext(${`codetutor:contextual-episode:${contextualEvidenceEpisodeDigest}`})::bigint
        )
      `;
      const episodeClaims = await tx<Array<{ request_id: string }>>`
        SELECT request_id
          FROM public.ai_contextual_episode_claims
         WHERE episode_digest = ${contextualEvidenceEpisodeDigest}
         FOR UPDATE
      `;
      if (episodeClaims.some((claim) => claim.request_id !== input.requestId)) {
        return { ok: false, kind: "evidence_replay" } as const;
      }
    }
    // Claim the complete qualifying chain, not only its terminal receipt.
    // Sorted token-specific locks avoid deadlocks while covering platform and
    // BYOK admission across every backend replica. The claims table primary
    // key remains the final database invariant.
    if (contextualEvidenceDigests.length) {
      for (const digest of contextualEvidenceDigests) {
        await tx`
          SELECT pg_advisory_xact_lock(
            hashtext(${`codetutor:contextual-evidence:${digest}`})::bigint
          )
        `;
      }
      const claims = await tx<Array<{ request_id: string }>>`
        SELECT request_id
          FROM public.ai_contextual_evidence_claims
         WHERE evidence_digest = ANY(${contextualEvidenceDigests}::text[])
         FOR UPDATE
      `;
      if (claims.some((claim) => claim.request_id !== input.requestId)) {
        return { ok: false, kind: "evidence_replay" } as const;
      }
    }

    // Serializes identical BYOK requests too. Without this, two transactions
    // can both observe no row and the loser surfaces a raw unique violation
    // instead of a stable duplicate result.
    await tx`SELECT pg_advisory_xact_lock(hashtext(${input.requestId})::bigint)`;

    await tx`
      DELETE FROM public.ai_request_cancellation_intents
       WHERE request_id = ${input.requestId} AND expires_at <= now()
    `;
    const cancellationIntents = await tx<Array<{
      actor_kind: "user" | "anonymous";
      user_id: string | null;
      ip_hash: string | null;
    }>>`
      SELECT actor_kind, user_id, ip_hash
        FROM public.ai_request_cancellation_intents
       WHERE request_id = ${input.requestId}
       FOR UPDATE
    `;
    const cancellationIntent = cancellationIntents[0];
    if (cancellationIntent) {
      const sameActor =
        cancellationIntent.actor_kind === input.actorKind &&
        (input.actorKind === "user"
          ? cancellationIntent.user_id === input.userId
          : cancellationIntent.ip_hash === input.ipHash);
      if (!sameActor) {
        return { ok: false, kind: "conflict" } as const;
      }
      await tx`
        INSERT INTO public.ai_request_reservations (
          request_id, actor_kind, user_id, ip_hash, funding_source, model,
          route, request_fingerprint, counts_toward_quota,
          reserved_input_tokens, reserved_output_tokens, reserved_cost_usd,
          price_version, state, expires_at, finalized_at,
          final_input_tokens, final_output_tokens, final_cost_usd,
          ledger_status, provider_outcome_uncertain
        ) VALUES (
          ${input.requestId}, ${input.actorKind},
          ${input.actorKind === "user" ? input.userId : null},
          ${input.actorKind === "anonymous" ? input.ipHash : null},
          ${input.fundingSource}, ${input.model}, ${input.route},
          ${input.requestFingerprint}, false,
          ${input.reservedInputTokens}, ${input.reservedOutputTokens},
          ${input.reservedCostUsd}, ${input.priceVersion}, 'released',
          now() + (${input.expiresInMs} * interval '1 millisecond'), now(),
          0, 0, 0, NULL, false
        )
      `;
      await tx`
        DELETE FROM public.ai_request_cancellation_intents
         WHERE request_id = ${input.requestId}
      `;
      return {
        ok: false,
        kind: "duplicate",
        state: "released",
      } as const;
    }

    const existing = await tx<ReservationRow[]>`
      SELECT request_id, actor_kind, user_id, ip_hash, funding_source, model,
             route, request_fingerprint, counts_toward_quota,
             reserved_input_tokens, reserved_output_tokens,
             reserved_cost_usd::text, price_version, state, expires_at
        FROM public.ai_request_reservations
       WHERE request_id = ${input.requestId}
       FOR UPDATE
    `;
    if (existing[0]) {
      const sameActor =
        existing[0].actor_kind === input.actorKind &&
        (input.actorKind === "user"
          ? existing[0].user_id === input.userId
          : existing[0].ip_hash === input.ipHash);
      if (!sameActor) {
        return { ok: false, kind: "conflict" } as const;
      }
      if (existing[0].request_fingerprint !== input.requestFingerprint) {
        return { ok: false, kind: "conflict" } as const;
      }
      return {
        ok: false,
        kind: "duplicate",
        state: existing[0].state,
      } as const;
    }

    let remainingToday: number | null = null;
    if (input.fundingSource === "platform") {
      if (!input.caps) {
        throw new Error("platform reservation requires resolved caps");
      }
      const dayStart = startOfUtcDay();
      const totals = await readUsageTotals(tx, input, dayStart);
      const nextGlobal = Number(totals.global_daily_cost) + input.reservedCostUsd;
      if (nextGlobal > input.caps.globalDailyUsd) {
        return { ok: false, kind: "denied", reason: "usd_cap_hit" } as const;
      }

      if (input.actorKind === "user") {
        const questionCap = input.caps.userDailyQuestions;
        if (questionCap !== undefined && totals.question_count >= questionCap) {
          return {
            ok: false,
            kind: "denied",
            reason: "free_exhausted",
          } as const;
        }
        if (
          input.caps.userDailyUsd !== undefined &&
          Number(totals.user_daily_cost) + input.reservedCostUsd >
            input.caps.userDailyUsd
        ) {
          return {
            ok: false,
            kind: "denied",
            reason: "daily_usd_per_user_hit",
          } as const;
        }
        if (
          input.caps.userLifetimeUsd !== undefined &&
          Number(totals.user_lifetime_cost) + input.reservedCostUsd >
            input.caps.userLifetimeUsd
        ) {
          return {
            ok: false,
            kind: "denied",
            reason: "lifetime_usd_per_user_hit",
          } as const;
        }
        remainingToday =
          questionCap === undefined
            ? null
            : Math.max(
                0,
                questionCap -
                  totals.question_count -
                  (input.countsTowardQuota ? 1 : 0),
              );
      } else {
        const questionCap = input.caps.anonDailyQuestions;
        if (questionCap !== undefined && totals.question_count >= questionCap) {
          return {
            ok: false,
            kind: "denied",
            reason: "anon_exhausted",
          } as const;
        }
        if (
          input.caps.anonDailyUsd !== undefined &&
          Number(totals.anon_daily_cost) + input.reservedCostUsd >
            input.caps.anonDailyUsd
        ) {
          return { ok: false, kind: "denied", reason: "usd_cap_hit" } as const;
        }
        remainingToday =
          questionCap === undefined
            ? null
            : Math.max(
                0,
                questionCap -
                  totals.question_count -
                  (input.countsTowardQuota ? 1 : 0),
              );
      }
    }

    await tx`
      INSERT INTO public.ai_request_reservations (
        request_id, actor_kind, user_id, ip_hash, funding_source, model,
        route, request_fingerprint, contextual_evidence_digest,
        counts_toward_quota,
        reserved_input_tokens, reserved_output_tokens, reserved_cost_usd,
        price_version, expires_at
      ) VALUES (
        ${input.requestId}, ${input.actorKind},
        ${input.actorKind === "user" ? input.userId : null},
        ${input.actorKind === "anonymous" ? input.ipHash : null},
        ${input.fundingSource}, ${input.model}, ${input.route},
        ${input.requestFingerprint}, ${terminalContextualEvidenceDigest},
        ${input.countsTowardQuota},
        ${input.reservedInputTokens}, ${input.reservedOutputTokens},
        ${input.reservedCostUsd}, ${input.priceVersion},
        now() + (${input.expiresInMs} * interval '1 millisecond')
      )
    `;
    for (const digest of contextualEvidenceDigests) {
      await tx`
        INSERT INTO public.ai_contextual_evidence_claims (
          evidence_digest, request_id
        ) VALUES (${digest}, ${input.requestId})
      `;
    }
    if (contextualEvidenceEpisodeDigest) {
      await tx`
        INSERT INTO public.ai_contextual_episode_claims (
          episode_digest, request_id
        ) VALUES (${contextualEvidenceEpisodeDigest}, ${input.requestId})
      `;
    }
    return { ok: true, remainingToday } as const;
  })) as ReserveAIRequestResult;
}

export interface FinalizeAIRequestInput {
  requestId: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  ledgerStatus: AIReservationLedgerStatus;
  countsTowardQuota: boolean;
  providerOutcomeUncertain?: boolean;
  terminalState?: "finalized" | "expired";
}

/** Finalizes usage and the idempotency row in one database transaction. */
export async function finalizeAIRequest(
  input: FinalizeAIRequestInput,
): Promise<AIReservationState> {
  const sql = db();
  return (await sql.begin(async (tx) => {
    const rows = await tx<ReservationRow[]>`
      SELECT request_id, actor_kind, user_id, ip_hash, funding_source, model,
             route, request_fingerprint, counts_toward_quota,
             reserved_input_tokens, reserved_output_tokens,
             reserved_cost_usd::text, price_version, state, expires_at
        FROM public.ai_request_reservations
       WHERE request_id = ${input.requestId}
       FOR UPDATE
    `;
    const row = rows[0];
    if (!row) throw new Error(`reservation not found: ${input.requestId}`);
    if (row.state !== "reserved") return row.state;

    await insertTerminalUsage(
      tx,
      row,
      input.inputTokens,
      input.outputTokens,
      input.costUsd,
      input.ledgerStatus,
      input.countsTowardQuota && row.counts_toward_quota,
    );
    const terminalState = input.terminalState ?? "finalized";
    await tx`
      UPDATE public.ai_request_reservations
         SET state = ${terminalState},
             finalized_at = now(),
             final_input_tokens = ${input.inputTokens},
             final_output_tokens = ${input.outputTokens},
             final_cost_usd = ${input.costUsd},
             ledger_status = ${input.ledgerStatus},
             provider_outcome_uncertain = ${input.providerOutcomeUncertain ?? false}
       WHERE request_id = ${input.requestId} AND state = 'reserved'
    `;
    return terminalState;
  })) as AIReservationState;
}

export type CancelAIRequestActor =
  | { actorKind: "user"; userId: string }
  | { actorKind: "anonymous"; ipHash: string };

export type CancelAIRequestState = AIReservationState | "pending";

/**
 * Marks a learner-discarded request as non-counting without erasing its cost.
 * The reservation row is locked so cancellation and provider finalization are
 * race-safe in either order: a pending finalizer observes the non-counting
 * flag, while a late cancellation refunds an already-written ledger row.
 */
export async function cancelAIRequest(
  requestId: string,
  actor: CancelAIRequestActor,
): Promise<CancelAIRequestState | null> {
  const sql = db();
  return (await sql.begin(async (tx) => {
    // The matching reservation path takes the same request-id lock. This
    // closes the pre-admission race in both directions without holding a
    // transaction open while the provider runs.
    await tx`SELECT pg_advisory_xact_lock(hashtext(${requestId})::bigint)`;
    const rows = await tx<ReservationRow[]>`
      SELECT request_id, actor_kind, user_id, ip_hash, funding_source, model,
             route, request_fingerprint, counts_toward_quota,
             reserved_input_tokens, reserved_output_tokens,
             reserved_cost_usd::text, price_version, state, expires_at
        FROM public.ai_request_reservations
       WHERE request_id = ${requestId}
       FOR UPDATE
    `;
    const row = rows[0];
    if (!row) {
      await tx`
        DELETE FROM public.ai_request_cancellation_intents
         WHERE request_id = ${requestId} AND expires_at <= now()
      `;
      const intents = await tx<Array<{
        actor_kind: "user" | "anonymous";
        user_id: string | null;
        ip_hash: string | null;
      }>>`
        SELECT actor_kind, user_id, ip_hash
          FROM public.ai_request_cancellation_intents
         WHERE request_id = ${requestId}
         FOR UPDATE
      `;
      const intent = intents[0];
      if (intent) {
        const ownsIntent =
          intent.actor_kind === actor.actorKind &&
          (actor.actorKind === "user"
            ? intent.user_id === actor.userId
            : intent.ip_hash === actor.ipHash);
        return ownsIntent ? "pending" : null;
      }
      await tx`
        INSERT INTO public.ai_request_cancellation_intents (
          request_id, actor_kind, user_id, ip_hash
        ) VALUES (
          ${requestId}, ${actor.actorKind},
          ${actor.actorKind === "user" ? actor.userId : null},
          ${actor.actorKind === "anonymous" ? actor.ipHash : null}
        )
      `;
      return "pending";
    }
    const ownsRequest =
      row.actor_kind === actor.actorKind &&
      (actor.actorKind === "user"
        ? row.user_id === actor.userId
        : row.ip_hash === actor.ipHash);
    if (!ownsRequest) return null;

    await tx`
      UPDATE public.ai_request_reservations
         SET counts_toward_quota = false
       WHERE request_id = ${requestId}
    `;
    if (row.actor_kind === "user") {
      await tx`
        UPDATE public.ai_usage_ledger
           SET counts_toward_quota = false
         WHERE request_id = ${requestId}
           AND user_id = ${row.user_id}
      `;
    } else {
      await tx`
        UPDATE public.ai_anon_usage_ledger
           SET counts_toward_quota = false
         WHERE request_id = ${requestId}
           AND ip_hash = ${row.ip_hash}
      `;
    }
    return row.state;
  })) as CancelAIRequestState | null;
}

/** Releases only a reservation known not to have reached the provider. */
export async function releaseAIRequest(requestId: string): Promise<AIReservationState> {
  const sql = db();
  const rows = await sql<Array<{ state: AIReservationState }>>`
    UPDATE public.ai_request_reservations
       SET state = 'released',
           finalized_at = now(),
           final_input_tokens = 0,
           final_output_tokens = 0,
           final_cost_usd = 0,
           ledger_status = NULL,
           provider_outcome_uncertain = false
     WHERE request_id = ${requestId} AND state = 'reserved'
     RETURNING state
  `;
  if (rows[0]) return rows[0].state;
  const existing = await sql<Array<{ state: AIReservationState }>>`
    SELECT state FROM public.ai_request_reservations WHERE request_id = ${requestId}
  `;
  if (!existing[0]) throw new Error(`reservation not found: ${requestId}`);
  return existing[0].state;
}

/** Test/ops hook: reconcile abandoned reservations without admitting a call. */
export async function reconcileExpiredAIRequests(): Promise<number> {
  const sql = db();
  return (await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${ADMISSION_LOCK_KEY})::bigint)`;
    return reconcileExpiredReservations(tx);
  })) as number;
}
