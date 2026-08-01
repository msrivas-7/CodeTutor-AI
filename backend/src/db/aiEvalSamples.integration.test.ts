import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { closeDb, db, withRlsContext } from "./client.js";
import {
  deleteEvalSamplesForSubjectToken,
  insertEvalSample,
  linkEvalSamplesToUser,
  listAdminEvalSamples,
  listEvalSynthesisQueue,
  listUserEvalSamples,
  queueDisagreedEvalSamples,
  upsertEvalSampleReview,
} from "./aiEvalSamples.js";
import {
  AI_EVAL_CONSENT_VERSION,
  hashEvalSubjectToken,
  projectEvalSample,
} from "../services/ai/evalSampling.js";

let reachable = false;
const users = new Set<string>();
const subjectTokens = new Set<string>();

async function createUser(): Promise<string> {
  const id = randomUUID();
  await db()`
    INSERT INTO auth.users (
      id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at
    ) VALUES (
      ${id}, 'authenticated', 'authenticated', ${`b8-${id}@test.local`},
      '{}'::jsonb, '{}'::jsonb, now(), now()
    )
  `;
  users.add(id);
  return id;
}

function createToken(seed: string): string {
  const token = seed.repeat(43).slice(0, 43);
  subjectTokens.add(token);
  return token;
}

const PATTERN_MARKER_BY_TOKEN: Record<string, string> = {
  a: "about",
  b: "after",
  c: "again",
  d: "already",
  e: "another",
  f: "before",
  g: "between",
  h: "both",
  i: "because",
  j: "check",
  k: "could",
  l: "correct",
};

function sample(
  token: string,
  requestId = randomUUID(),
  patternMarker = PATTERN_MARKER_BY_TOKEN[token[0] ?? ""] ?? "because",
) {
  return projectEvalSample({
    requestId,
    consent: { version: AI_EVAL_CONSENT_VERSION, subjectToken: token },
    model: "gpt-4.1-nano",
    language: "python",
    courseId: "python-fundamentals",
    lessonId: "hello-world",
    intent: "socratic",
    tutorStage: "clarify",
    question: `Maya, why does \`private_value\` not work? maya@example.com ${patternMarker}`,
    files: [{ path: "private/Maya.py", content: "PRIVATE_SOURCE_SENTINEL" }],
    history: [{ role: "user", content: "PRIVATE_HISTORY_SENTINEL" }],
    lastRun: { errorType: "runtime" },
    sections: {
      intent: "socratic",
      checkQuestions: ["What result did you expect, Maya?"],
    },
  });
}

beforeAll(async () => {
  try {
    await db()`SELECT 1 FROM public.ai_eval_samples LIMIT 0`;
    reachable = true;
  } catch {
    reachable = false;
  }
});

afterAll(async () => {
  if (reachable) {
    if (subjectTokens.size > 0) {
      const hashes = [...subjectTokens].map(hashEvalSubjectToken);
      await db()`DELETE FROM public.ai_eval_samples WHERE subject_token_hash = ANY(${hashes}::text[])`;
    }
    if (users.size > 0) {
      await db()`DELETE FROM auth.users WHERE id = ANY(${[...users]}::uuid[])`;
    }
  }
  await closeDb();
});

describe("B8 governed eval samples (real Postgres)", () => {
  it("stores only the bounded projection and is idempotent by request", async () => {
    if (!reachable) return;
    const token = createToken("a");
    const projected = sample(token);
    expect(await insertEvalSample(projected)).toBe(true);
    expect(await insertEvalSample(projected)).toBe(false);
    const rows = await db()<Array<Record<string, unknown>>>`
      SELECT * FROM public.ai_eval_samples WHERE request_id = ${projected.requestId}
    `;
    expect(rows).toHaveLength(1);
    const serialized = JSON.stringify(rows[0]);
    expect(serialized).not.toContain(token);
    expect(serialized).not.toContain("Maya");
    expect(serialized).not.toContain("maya@example.com");
    expect(serialized).not.toContain("PRIVATE_SOURCE_SENTINEL");
    expect(serialized).not.toContain("PRIVATE_HISTORY_SENTINEL");
  });

  it("retains only one copy of the same post-redaction quality pattern", async () => {
    if (!reachable) return;
    const firstToken = createToken("g");
    const secondToken = createToken("h");
    const first = sample(firstToken, randomUUID(), "between");
    const duplicatePattern = sample(secondToken, randomUUID(), "between");
    expect(first.contentFingerprint).toBe(duplicatePattern.contentFingerprint);
    expect(await insertEvalSample(first)).toBe(true);
    expect(await insertEvalSample(duplicatePattern)).toBe(false);
    const rows = await db()<Array<{ count: number }>>`
      SELECT count(*)::integer AS count
        FROM public.ai_eval_samples
       WHERE content_fingerprint = ${first.contentFingerprint}
    `;
    expect(rows[0]?.count).toBe(1);
  });

  it("keeps Data API roles denied even after a sample links to its user", async () => {
    if (!reachable) return;
    const userId = await createUser();
    const token = createToken("b");
    await insertEvalSample(sample(token));
    expect(await linkEvalSamplesToUser(token, userId)).toBe(1);
    await expect(
      withRlsContext(userId, (tx) => tx`
        SELECT id FROM public.ai_eval_samples WHERE user_id = ${userId}
      `),
    ).rejects.toThrow(/permission denied/i);
    const grants = await db()<Array<{
      anon_samples: boolean;
      authenticated_samples: boolean;
      anon_reviews: boolean;
      authenticated_queue: boolean;
    }>>`
      SELECT
        has_table_privilege('anon', 'public.ai_eval_samples', 'SELECT') AS anon_samples,
        has_table_privilege('authenticated', 'public.ai_eval_samples', 'SELECT') AS authenticated_samples,
        has_table_privilege('anon', 'public.ai_eval_sample_reviews', 'SELECT') AS anon_reviews,
        has_table_privilege('authenticated', 'public.ai_eval_synthesis_queue', 'SELECT') AS authenticated_queue
    `;
    expect(grants).toEqual([{
      anon_samples: false,
      authenticated_samples: false,
      anon_reviews: false,
      authenticated_queue: false,
    }]);
  });

  it("exports linked redacted rows and account deletion cascades them", async () => {
    if (!reachable) return;
    const userId = await createUser();
    const token = createToken("c");
    const projected = sample(token);
    await insertEvalSample(projected);
    await linkEvalSamplesToUser(token, userId);
    const exported = await listUserEvalSamples(userId);
    expect(exported).toHaveLength(1);
    expect(JSON.stringify(exported)).toContain("question_redacted");
    await db()`DELETE FROM auth.users WHERE id = ${userId}`;
    users.delete(userId);
    const remaining = await db()<Array<{ count: number }>>`
      SELECT count(*)::integer AS count
        FROM public.ai_eval_samples
       WHERE request_id = ${projected.requestId}
    `;
    expect(remaining[0]?.count).toBe(0);
  });

  it("deletes every retained sample for the anonymous capability", async () => {
    if (!reachable) return;
    const token = createToken("d");
    await insertEvalSample(sample(token, randomUUID(), "already"));
    await insertEvalSample(sample(token, randomUUID(), "another"));
    expect(await deleteEvalSamplesForSubjectToken(token)).toBe(2);
    expect(await deleteEvalSamplesForSubjectToken(token)).toBe(0);
  });

  it("queues only disagreement from two distinct reviewers", async () => {
    if (!reachable) return;
    const reviewerA = await createUser();
    const reviewerB = await createUser();
    const token = createToken("e");
    const projected = sample(token);
    await insertEvalSample(projected);
    const sampleRows = await db()<Array<{ id: string }>>`
      SELECT id FROM public.ai_eval_samples WHERE request_id = ${projected.requestId}
    `;
    const sampleId = sampleRows[0]!.id;
    expect(await upsertEvalSampleReview({
      sampleId,
      reviewerId: reviewerA,
      verdict: "pass",
      issueCodes: [],
    })).toBe(true);
    expect(await queueDisagreedEvalSamples()).toBe(0);
    expect(await upsertEvalSampleReview({
      sampleId,
      reviewerId: reviewerB,
      verdict: "fail",
      issueCodes: ["factual_error"],
    })).toBe(true);
    expect(await queueDisagreedEvalSamples()).toBe(1);
    expect(await queueDisagreedEvalSamples()).toBe(0);
    const queue = await listEvalSynthesisQueue();
    expect(queue.find((item) => item.sampleId === sampleId)).toMatchObject({
      reviewCount: 2,
      distinctVerdictCount: 2,
      state: "pending_synthesis",
      syntheticCaseId: null,
    });
  });

  it("caps review at two people and closes consensus without synthesis", async () => {
    if (!reachable) return;
    const reviewerA = await createUser();
    const reviewerB = await createUser();
    const reviewerC = await createUser();
    const token = createToken("i");
    const projected = sample(token);
    await insertEvalSample(projected);
    const sampleRows = await db()<Array<{ id: string }>>`
      SELECT id FROM public.ai_eval_samples WHERE request_id = ${projected.requestId}
    `;
    const sampleId = sampleRows[0]!.id;
    for (const reviewerId of [reviewerA, reviewerB]) {
      expect(await upsertEvalSampleReview({
        sampleId,
        reviewerId,
        verdict: "pass",
        issueCodes: [],
      })).toBe(true);
    }
    expect(await upsertEvalSampleReview({
      sampleId,
      reviewerId: reviewerC,
      verdict: "fail",
      issueCodes: ["factual_error"],
    })).toBe(false);
    expect(await queueDisagreedEvalSamples()).toBe(0);
    const rows = await db()<Array<{ disposition: string }>>`
      SELECT disposition FROM public.ai_eval_samples WHERE id = ${sampleId}
    `;
    expect(rows).toEqual([{ disposition: "review_complete" }]);
  });

  it("does not offer a pending sample to the same reviewer twice", async () => {
    if (!reachable) return;
    const reviewerA = await createUser();
    const reviewerB = await createUser();
    const token = createToken("k");
    const projected = sample(token);
    await insertEvalSample(projected);
    const sampleRows = await db()<Array<{ id: string }>>`
      SELECT id FROM public.ai_eval_samples WHERE request_id = ${projected.requestId}
    `;
    const sampleId = sampleRows[0]!.id;

    expect((await listAdminEvalSamples({
      disposition: "pending_review",
      reviewerId: reviewerA,
    })).samples.some((item) => item.id === sampleId)).toBe(true);
    expect(await upsertEvalSampleReview({
      sampleId,
      reviewerId: reviewerA,
      verdict: "pass",
      issueCodes: [],
    })).toBe(true);
    expect((await listAdminEvalSamples({
      disposition: "pending_review",
      reviewerId: reviewerA,
    })).samples.some((item) => item.id === sampleId)).toBe(false);
    expect((await listAdminEvalSamples({
      disposition: "pending_review",
      reviewerId: reviewerB,
    })).samples.some((item) => item.id === sampleId)).toBe(true);
  });

  it("enforces the two-reviewer cap under concurrent submissions", async () => {
    if (!reachable) return;
    const reviewers = await Promise.all([createUser(), createUser(), createUser()]);
    const token = createToken("l");
    const projected = sample(token);
    await insertEvalSample(projected);
    const sampleRows = await db()<Array<{ id: string }>>`
      SELECT id FROM public.ai_eval_samples WHERE request_id = ${projected.requestId}
    `;
    const sampleId = sampleRows[0]!.id;

    const results = await Promise.all(reviewers.map((reviewerId) =>
      upsertEvalSampleReview({
        sampleId,
        reviewerId,
        verdict: "pass",
        issueCodes: [],
      })
    ));
    expect(results.filter(Boolean)).toHaveLength(2);
    expect(await queueDisagreedEvalSamples()).toBe(0);
    const rows = await db()<Array<{ disposition: string; review_count: number }>>`
      SELECT samples.disposition,
             count(reviews.id)::integer AS review_count
        FROM public.ai_eval_samples AS samples
        LEFT JOIN public.ai_eval_sample_reviews AS reviews
          ON reviews.sample_id = samples.id
       WHERE samples.id = ${sampleId}
       GROUP BY samples.id
    `;
    expect(rows).toEqual([{ disposition: "review_complete", review_count: 2 }]);
  });

  it("deletes a sample immediately when a reviewer finds a privacy defect", async () => {
    if (!reachable) return;
    const reviewer = await createUser();
    const token = createToken("j");
    const projected = sample(token);
    await insertEvalSample(projected);
    const sampleRows = await db()<Array<{ id: string }>>`
      SELECT id FROM public.ai_eval_samples WHERE request_id = ${projected.requestId}
    `;
    const sampleId = sampleRows[0]!.id;
    expect(await upsertEvalSampleReview({
      sampleId,
      reviewerId: reviewer,
      verdict: "reject_privacy",
      issueCodes: ["redaction_concern"],
    })).toBe(true);
    const rows = await db()<Array<{ count: number }>>`
      SELECT count(*)::integer AS count FROM public.ai_eval_samples WHERE id = ${sampleId}
    `;
    expect(rows[0]?.count).toBe(0);
  });

  it("enforces expiry and installs the hourly and weekly cron jobs", async () => {
    if (!reachable) return;
    const token = createToken("f");
    const projected = sample(token);
    await insertEvalSample(projected);
    await expect(db()`
      UPDATE public.ai_eval_samples
         SET expires_at = created_at + interval '30 days 1 second'
       WHERE request_id = ${projected.requestId}
    `).rejects.toThrow(/ai_eval_samples_retention_ck/);
    await db()`
      UPDATE public.ai_eval_samples
         SET created_at = now() - interval '31 days',
             expires_at = now() - interval '1 day'
       WHERE request_id = ${projected.requestId}
    `;
    const sweep = await db()<Array<{ deleted: number }>>`
      SELECT private.delete_expired_ai_eval_samples(100) AS deleted
    `;
    expect(sweep[0]?.deleted).toBeGreaterThanOrEqual(1);
    const jobs = await db()<Array<{ jobname: string; schedule: string }>>`
      SELECT jobname, schedule
        FROM cron.job
       WHERE jobname IN (
         'b8-delete-expired-ai-eval-samples',
         'b8-queue-disagreed-ai-eval-samples'
       )
       ORDER BY jobname
    `;
    expect(jobs).toEqual([
      { jobname: "b8-delete-expired-ai-eval-samples", schedule: "17 * * * *" },
      { jobname: "b8-queue-disagreed-ai-eval-samples", schedule: "23 8 * * 1" },
    ]);
  });
});
