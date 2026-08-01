import { db } from "./client.js";
import {
  hashEvalSubjectToken,
  type ProjectedEvalSample,
} from "../services/ai/evalSampling.js";

export type EvalReviewVerdict = "pass" | "fail" | "ambiguous" | "reject_privacy";
export type EvalQueueResolution = "synthetic_case_authored" | "rejected";

export interface AdminEvalSample {
  id: string;
  model: string;
  language: string;
  courseId: string;
  lessonId: string;
  intent: string;
  tutorStage: string;
  questionRedacted: string;
  responseRedacted: string;
  contentFingerprint: string;
  fileCount: number;
  sourceBytesBucket: string;
  historyTurnCount: number;
  hadRunResult: boolean;
  runErrorType: string | null;
  sectionKeys: string[];
  redactionCounts: { code: number; sensitive: number; identifiers: number };
  disposition: string;
  reviewCount: number;
  distinctVerdictCount: number;
  createdAt: string;
  expiresAt: string;
}

export interface EvalSynthesisQueueItem {
  id: string;
  sampleId: string;
  sourceFingerprint: string;
  reviewCount: number;
  distinctVerdictCount: number;
  state: string;
  syntheticCaseId: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export async function insertEvalSample(sample: ProjectedEvalSample): Promise<boolean> {
  const sql = db();
  return (await sql.begin(async (tx) => {
    await tx`
      SELECT pg_advisory_xact_lock(hashtextextended(${sample.subjectTokenHash}, 0))
    `;
    const revoked = await tx<Array<{ revoked: boolean }>>`
      SELECT EXISTS (
        SELECT 1
          FROM private.ai_eval_sampling_revocations
         WHERE subject_token_hash = ${sample.subjectTokenHash}
           AND expires_at > now()
      ) AS revoked
    `;
    if (revoked[0]?.revoked) return false;

    const rows = await tx<Array<{ inserted: boolean }>>`
      INSERT INTO public.ai_eval_samples (
        request_id,
        subject_token_hash,
        consent_version,
        sampling_policy_version,
        redaction_version,
        model,
        language,
        course_id,
        lesson_id,
        intent,
        tutor_stage,
        question_redacted,
        response_redacted,
        content_fingerprint,
        file_count,
        source_bytes_bucket,
        history_turn_count,
        had_run_result,
        run_error_type,
        section_keys,
        code_redaction_count,
        sensitive_redaction_count,
        identifier_redaction_count
      ) VALUES (
        ${sample.requestId},
        ${sample.subjectTokenHash},
        ${sample.consentVersion},
        ${sample.samplingPolicyVersion},
        ${sample.redactionVersion},
        ${sample.model},
        ${sample.language},
        ${sample.courseId},
        ${sample.lessonId},
        ${sample.intent},
        ${sample.tutorStage},
        ${sample.questionRedacted},
        ${sample.responseRedacted},
        ${sample.contentFingerprint},
        ${sample.fileCount},
        ${sample.sourceBytesBucket},
        ${sample.historyTurnCount},
        ${sample.hadRunResult},
        ${sample.runErrorType},
        ${sample.sectionKeys},
        ${sample.codeRedactionCount},
        ${sample.sensitiveRedactionCount},
        ${sample.identifierRedactionCount}
      )
      ON CONFLICT DO NOTHING
      RETURNING true AS inserted
    `;
    return rows.length === 1;
  })) as boolean;
}

export async function deleteEvalSamplesForSubjectToken(token: string): Promise<number> {
  const sql = db();
  const hash = hashEvalSubjectToken(token);
  return (await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${hash}, 0))`;
    await tx`
      INSERT INTO private.ai_eval_sampling_revocations (
        subject_token_hash,
        revoked_at,
        expires_at
      ) VALUES (
        ${hash},
        now(),
        now() + interval '31 days'
      )
      ON CONFLICT (subject_token_hash) DO UPDATE
        SET revoked_at = EXCLUDED.revoked_at,
            expires_at = EXCLUDED.expires_at
    `;
    const rows = await tx<Array<{ id: string }>>`
      DELETE FROM public.ai_eval_samples
       WHERE subject_token_hash = ${hash}
      RETURNING id
    `;
    return rows.length;
  })) as number;
}

export async function linkEvalSamplesToUser(token: string, userId: string): Promise<number> {
  const sql = db();
  const hash = hashEvalSubjectToken(token);
  const rows = await sql<Array<{ id: string }>>`
    UPDATE public.ai_eval_samples
       SET user_id = ${userId}
     WHERE subject_token_hash = ${hash}
       AND (user_id IS NULL OR user_id = ${userId})
    RETURNING id
  `;
  return rows.length;
}

export async function listUserEvalSamples(
  userId: string,
): Promise<Array<Record<string, unknown>>> {
  const sql = db();
  const rows = await sql`
    SELECT model, language, course_id, lesson_id, intent, tutor_stage,
           question_redacted, response_redacted, section_keys, disposition,
           created_at, expires_at
      FROM public.ai_eval_samples
     WHERE user_id = ${userId}
     ORDER BY created_at DESC
  `;
  return rows as Array<Record<string, unknown>>;
}

export async function listAdminEvalSamples(opts: {
  limit?: number;
  cursor?: string | null;
  disposition?: "pending_review" | "review_complete" | "synthesis_queued" | "rejected" | null;
  reviewerId?: string | null;
} = {}): Promise<{ samples: AdminEvalSample[]; nextCursor: string | null }> {
  const sql = db();
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  const cursorClause = opts.cursor
    ? sql`AND samples.created_at > ${opts.cursor}`
    : sql``;
  const dispositionClause = opts.disposition
    ? sql`AND samples.disposition = ${opts.disposition}`
    : sql``;
  const independentReviewClause =
    opts.disposition === "pending_review" && opts.reviewerId
      ? sql`AND NOT EXISTS (
          SELECT 1
            FROM public.ai_eval_sample_reviews AS own_review
           WHERE own_review.sample_id = samples.id
             AND own_review.reviewer_id = ${opts.reviewerId}
        )`
      : sql``;
  const reviewCapacityClause = opts.disposition === "pending_review"
    ? sql`HAVING count(DISTINCT reviews.reviewer_id) < 2`
    : sql``;
  const rows = await sql<Array<{
    id: string;
    model: string;
    language: string;
    course_id: string;
    lesson_id: string;
    intent: string;
    tutor_stage: string;
    question_redacted: string;
    response_redacted: string;
    content_fingerprint: string;
    file_count: number;
    source_bytes_bucket: string;
    history_turn_count: number;
    had_run_result: boolean;
    run_error_type: string | null;
    section_keys: string[];
    code_redaction_count: number;
    sensitive_redaction_count: number;
    identifier_redaction_count: number;
    disposition: string;
    review_count: number;
    distinct_verdict_count: number;
    created_at: Date;
    expires_at: Date;
  }>>`
    SELECT
      samples.id,
      samples.model,
      samples.language,
      samples.course_id,
      samples.lesson_id,
      samples.intent,
      samples.tutor_stage,
      samples.question_redacted,
      samples.response_redacted,
      samples.content_fingerprint,
      samples.file_count,
      samples.source_bytes_bucket,
      samples.history_turn_count,
      samples.had_run_result,
      samples.run_error_type,
      samples.section_keys,
      samples.code_redaction_count,
      samples.sensitive_redaction_count,
      samples.identifier_redaction_count,
      samples.disposition,
      count(DISTINCT reviews.reviewer_id)::integer AS review_count,
      count(DISTINCT reviews.verdict)::integer AS distinct_verdict_count,
      samples.created_at,
      samples.expires_at
    FROM public.ai_eval_samples AS samples
    LEFT JOIN public.ai_eval_sample_reviews AS reviews
      ON reviews.sample_id = samples.id
    WHERE samples.expires_at > now()
      ${cursorClause}
      ${dispositionClause}
      ${independentReviewClause}
    GROUP BY samples.id
    ${reviewCapacityClause}
    ORDER BY samples.created_at ASC
    LIMIT ${limit + 1}
  `;
  const hasMore = rows.length > limit;
  const slice = hasMore ? rows.slice(0, limit) : rows;
  return {
    samples: slice.map((row) => ({
      id: row.id,
      model: row.model,
      language: row.language,
      courseId: row.course_id,
      lessonId: row.lesson_id,
      intent: row.intent,
      tutorStage: row.tutor_stage,
      questionRedacted: row.question_redacted,
      responseRedacted: row.response_redacted,
      contentFingerprint: row.content_fingerprint,
      fileCount: row.file_count,
      sourceBytesBucket: row.source_bytes_bucket,
      historyTurnCount: row.history_turn_count,
      hadRunResult: row.had_run_result,
      runErrorType: row.run_error_type,
      sectionKeys: row.section_keys,
      redactionCounts: {
        code: row.code_redaction_count,
        sensitive: row.sensitive_redaction_count,
        identifiers: row.identifier_redaction_count,
      },
      disposition: row.disposition,
      reviewCount: row.review_count,
      distinctVerdictCount: row.distinct_verdict_count,
      createdAt: row.created_at.toISOString(),
      expiresAt: row.expires_at.toISOString(),
    })),
    nextCursor: hasMore && slice.length > 0
      ? slice[slice.length - 1].created_at.toISOString()
      : null,
  };
}

export async function upsertEvalSampleReview(input: {
  sampleId: string;
  reviewerId: string;
  verdict: EvalReviewVerdict;
  issueCodes: string[];
  note?: string | null;
}): Promise<boolean> {
  const sql = db();
  return (await sql.begin(async (tx) => {
    // Serialize the reviewer-cap decision for this sample. A row lock inside
    // the same SELECT is not sufficient under READ COMMITTED when multiple
    // statements take their snapshots before waiting on that row.
    await tx`
      SELECT pg_advisory_xact_lock(hashtextextended(${input.sampleId}, 0))
    `;
    const rows = await tx<Array<{ id: string }>>`
      WITH candidate AS (
        SELECT samples.id
          FROM public.ai_eval_samples AS samples
         WHERE samples.id = ${input.sampleId}
           AND samples.expires_at > now()
           AND samples.disposition = 'pending_review'
           AND (
             EXISTS (
               SELECT 1
                 FROM public.ai_eval_sample_reviews AS own_review
                WHERE own_review.sample_id = samples.id
                  AND own_review.reviewer_id = ${input.reviewerId}
             )
             OR (
               SELECT count(DISTINCT existing.reviewer_id)
                 FROM public.ai_eval_sample_reviews AS existing
                WHERE existing.sample_id = samples.id
             ) < 2
           )
         FOR UPDATE
      )
      INSERT INTO public.ai_eval_sample_reviews (
        sample_id, reviewer_id, verdict, issue_codes, note
      )
      SELECT
        candidate.id,
        ${input.reviewerId},
        ${input.verdict},
        ${input.issueCodes},
        ${input.note ?? null}
      FROM candidate
      ON CONFLICT (sample_id, reviewer_id) DO UPDATE
        SET verdict = EXCLUDED.verdict,
            issue_codes = EXCLUDED.issue_codes,
            note = EXCLUDED.note,
            updated_at = now()
      RETURNING sample_id AS id
    `;
    if (rows.length !== 1) return false;

    if (input.verdict === "reject_privacy") {
      await tx`
        DELETE FROM public.ai_eval_samples
         WHERE id = ${input.sampleId}
      `;
    }
    return true;
  })) as boolean;
}

export async function listEvalSynthesisQueue(
  limitInput = 50,
): Promise<EvalSynthesisQueueItem[]> {
  const sql = db();
  const limit = Math.min(Math.max(limitInput, 1), 100);
  const rows = await sql<Array<{
    id: string;
    sample_id: string;
    source_fingerprint: string;
    review_count: number;
    distinct_verdict_count: number;
    state: string;
    synthetic_case_id: string | null;
    created_at: Date;
    resolved_at: Date | null;
  }>>`
    SELECT id, sample_id, source_fingerprint, review_count,
           distinct_verdict_count, state, synthetic_case_id,
           created_at, resolved_at
      FROM public.ai_eval_synthesis_queue
     ORDER BY (state = 'pending_synthesis') DESC,
              CASE WHEN state = 'pending_synthesis' THEN created_at END ASC,
              created_at DESC
     LIMIT ${limit}
  `;
  return rows.map((row) => ({
    id: row.id,
    sampleId: row.sample_id,
    sourceFingerprint: row.source_fingerprint,
    reviewCount: row.review_count,
    distinctVerdictCount: row.distinct_verdict_count,
    state: row.state,
    syntheticCaseId: row.synthetic_case_id,
    createdAt: row.created_at.toISOString(),
    resolvedAt: row.resolved_at?.toISOString() ?? null,
  }));
}

export async function resolveEvalSynthesisQueue(input: {
  queueId: string;
  state: EvalQueueResolution;
  syntheticCaseId?: string | null;
}): Promise<boolean> {
  const sql = db();
  const rows = await sql<Array<{ id: string }>>`
    UPDATE public.ai_eval_synthesis_queue
       SET state = ${input.state},
           synthetic_case_id = ${input.state === "synthetic_case_authored"
             ? input.syntheticCaseId ?? null
             : null},
           resolved_at = now()
     WHERE id = ${input.queueId}
       AND state = 'pending_synthesis'
    RETURNING id
  `;
  return rows.length === 1;
}

export async function queueDisagreedEvalSamples(batchSize = 1000): Promise<number> {
  const sql = db();
  const rows = await sql<Array<{ queued: number }>>`
    SELECT private.queue_disagreed_ai_eval_samples(${batchSize}) AS queued
  `;
  return rows[0]?.queued ?? 0;
}
