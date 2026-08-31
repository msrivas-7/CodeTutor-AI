import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db, closeDb } from "./client.js";
import {
  cancelAIRequest,
  finalizeAIRequest,
  fingerprintAIRequest,
  reconcileExpiredAIRequests,
  reserveAIRequest,
} from "./aiReservations.js";

const enabled = Boolean(process.env.AI_RESERVATION_TEST_DATABASE_URL);
const integrationDescribe = enabled ? describe : describe.skip;
const ipHash = "a".repeat(64);
const otherIpHash = "b".repeat(64);

function reservation(
  requestId: string,
  overrides: Partial<Parameters<typeof reserveAIRequest>[0]> = {},
): Parameters<typeof reserveAIRequest>[0] {
  return {
    actorKind: "anonymous",
    ipHash,
    requestId,
    requestFingerprint: fingerprintAIRequest({ requestId }),
    fundingSource: "platform",
    model: "gpt-4.1-nano",
    route: "ask_stream",
    countsTowardQuota: true,
    reservedInputTokens: 1_000,
    reservedOutputTokens: 500,
    reservedCostUsd: 0.01,
    priceVersion: 1,
    expiresInMs: 30_000,
    caps: {
      globalDailyUsd: 100,
      anonDailyQuestions: 100,
      anonDailyUsd: 100,
    },
    ...overrides,
  } as Parameters<typeof reserveAIRequest>[0];
}

integrationDescribe("AI request reservations (real Postgres)", () => {
  beforeEach(async () => {
    await db()`DELETE FROM public.ai_request_cancellation_intents WHERE ip_hash IN (${ipHash}, ${otherIpHash})`;
    await db()`DELETE FROM public.ai_request_reservations WHERE ip_hash IN (${ipHash}, ${otherIpHash})`;
    await db()`DELETE FROM public.ai_anon_usage_ledger WHERE ip_hash IN (${ipHash}, ${otherIpHash})`;
  });

  afterAll(async () => {
    if (!enabled) return;
    await db()`DELETE FROM public.ai_request_cancellation_intents WHERE ip_hash IN (${ipHash}, ${otherIpHash})`;
    await db()`DELETE FROM public.ai_request_reservations WHERE ip_hash IN (${ipHash}, ${otherIpHash})`;
    await db()`DELETE FROM public.ai_anon_usage_ledger WHERE ip_hash IN (${ipHash}, ${otherIpHash})`;
    await closeDb();
  });

  it("admits only the remaining request at a concurrent question boundary", async () => {
    const caps = {
      globalDailyUsd: 100,
      anonDailyQuestions: 1,
      anonDailyUsd: 100,
    };
    const results = await Promise.all([
      reserveAIRequest(reservation(randomUUID(), { caps })),
      reserveAIRequest(reservation(randomUUID(), { caps })),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results).toContainEqual({
      ok: false,
      kind: "denied",
      reason: "anon_exhausted",
    });
  });

  it("serializes two simultaneous uses of the same idempotency key", async () => {
    const requestId = randomUUID();
    const input = reservation(requestId);
    const results = await Promise.all([
      reserveAIRequest(input),
      reserveAIRequest(input),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results).toContainEqual({
      ok: false,
      kind: "duplicate",
      state: "reserved",
    });
  });

  it("atomically rejects overlapping contextual evidence chains across request IDs", async () => {
    const first = "c".repeat(64);
    const overlap = "d".repeat(64);
    const latest = "e".repeat(64);
    const results = await Promise.all([
      reserveAIRequest(reservation(randomUUID(), {
        contextualEvidenceDigests: [first, overlap],
      })),
      reserveAIRequest(reservation(randomUUID(), {
        contextualEvidenceDigests: [overlap, latest],
      })),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results).toContainEqual({ ok: false, kind: "evidence_replay" });
  });

  it("keeps anonymous dollar caps isolated between IP identities", async () => {
    const caps = {
      globalDailyUsd: 100,
      anonDailyQuestions: 100,
      anonDailyUsd: 0.015,
    };
    const [first, second] = await Promise.all([
      reserveAIRequest(reservation(randomUUID(), { caps, ipHash })),
      reserveAIRequest(reservation(randomUUID(), { caps, ipHash: otherIpHash })),
    ]);
    expect(first).toMatchObject({ ok: true });
    expect(second).toMatchObject({ ok: true });
  });

  it("writes exactly one ledger row under concurrent finalization", async () => {
    const requestId = randomUUID();
    expect(await reserveAIRequest(reservation(requestId))).toMatchObject({ ok: true });
    const terminal = {
      requestId,
      inputTokens: 800,
      outputTokens: 200,
      costUsd: 0.001,
      ledgerStatus: "finish" as const,
      countsTowardQuota: true,
    };
    await Promise.all([
      finalizeAIRequest(terminal),
      finalizeAIRequest(terminal),
    ]);
    const rows = await db()<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count
        FROM public.ai_anon_usage_ledger
       WHERE request_id = ${requestId}
    `;
    expect(rows[0]?.count).toBe(1);
  });

  it("refunds quota when cancellation wins the finalization race", async () => {
    const requestId = randomUUID();
    expect(await reserveAIRequest(reservation(requestId))).toMatchObject({ ok: true });
    expect(await cancelAIRequest(requestId, { actorKind: "anonymous", ipHash })).toBe("reserved");
    await finalizeAIRequest({
      requestId,
      inputTokens: 800,
      outputTokens: 200,
      costUsd: 0.001,
      ledgerStatus: "finish",
      countsTowardQuota: true,
    });
    const rows = await db()<Array<{ counts_toward_quota: boolean; cost_usd: string }>>`
      SELECT counts_toward_quota, cost_usd::text
        FROM public.ai_anon_usage_ledger
       WHERE request_id = ${requestId}
    `;
    expect(rows[0]).toEqual({ counts_toward_quota: false, cost_usd: "0.001000" });
  });

  it("prevents admission when cancellation arrives before the reservation", async () => {
    const requestId = randomUUID();
    expect(
      await cancelAIRequest(requestId, { actorKind: "anonymous", ipHash }),
    ).toBe("pending");
    expect(await reserveAIRequest(reservation(requestId))).toEqual({
      ok: false,
      kind: "duplicate",
      state: "released",
    });
    const rows = await db()<Array<{
      state: string;
      counts_toward_quota: boolean;
      ledger_count: number;
      intent_count: number;
    }>>`
      SELECT r.state,
             r.counts_toward_quota,
             (SELECT COUNT(*)::int
                FROM public.ai_anon_usage_ledger l
               WHERE l.request_id = r.request_id::text) AS ledger_count,
             (SELECT COUNT(*)::int
                FROM public.ai_request_cancellation_intents c
               WHERE c.request_id = r.request_id) AS intent_count
        FROM public.ai_request_reservations r
       WHERE r.request_id = ${requestId}
    `;
    expect(rows[0]).toEqual({
      state: "released",
      counts_toward_quota: false,
      ledger_count: 0,
      intent_count: 0,
    });
  });

  it("keeps a pre-admission cancellation bound to its anonymous actor", async () => {
    const requestId = randomUUID();
    expect(
      await cancelAIRequest(requestId, {
        actorKind: "anonymous",
        ipHash: otherIpHash,
      }),
    ).toBe("pending");
    expect(await reserveAIRequest(reservation(requestId))).toEqual({
      ok: false,
      kind: "conflict",
    });
  });

  it("refunds quota when provider finalization wins the cancellation race", async () => {
    const requestId = randomUUID();
    expect(await reserveAIRequest(reservation(requestId))).toMatchObject({ ok: true });
    await finalizeAIRequest({
      requestId,
      inputTokens: 800,
      outputTokens: 200,
      costUsd: 0.001,
      ledgerStatus: "finish",
      countsTowardQuota: true,
    });
    expect(await cancelAIRequest(requestId, { actorKind: "anonymous", ipHash })).toBe("finalized");
    const rows = await db()<Array<{ counts_toward_quota: boolean; cost_usd: string }>>`
      SELECT counts_toward_quota, cost_usd::text
        FROM public.ai_anon_usage_ledger
       WHERE request_id = ${requestId}
    `;
    expect(rows[0]).toEqual({ counts_toward_quota: false, cost_usd: "0.001000" });
  });

  it("conservatively charges and expires an abandoned reservation", async () => {
    const requestId = randomUUID();
    expect(
      await reserveAIRequest(reservation(requestId, { expiresInMs: 10 })),
    ).toMatchObject({ ok: true });
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(await reconcileExpiredAIRequests()).toBeGreaterThanOrEqual(1);
    const rows = await db()<Array<{
      state: string;
      provider_outcome_uncertain: boolean;
      final_cost_usd: string;
    }>>`
      SELECT state, provider_outcome_uncertain, final_cost_usd::text
        FROM public.ai_request_reservations
       WHERE request_id = ${requestId}
    `;
    expect(rows[0]).toMatchObject({
      state: "expired",
      provider_outcome_uncertain: true,
      final_cost_usd: "0.010000",
    });
  });
});
