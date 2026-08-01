-- Phase B8: governed anonymous tutor sampling for eval-set growth.
--
-- This is deliberately NOT a conversation archive. Only successful,
-- explicitly-consented, platform-funded anonymous turns may reach this table,
-- and application code projects them through the v1 pre-insert redactor.
-- Source files, selections, stdin, stdout/stderr, raw history, IP addresses,
-- and BYOK content have no columns here. Traffic candidates remain separate
-- from the repository-owned golden holdout: disagreement enters a synthesis
-- queue, never the golden set directly.

CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE public.ai_eval_samples (
  id                         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id                 uuid        NOT NULL UNIQUE,
  subject_token_hash         text        NOT NULL,
  user_id                    uuid        REFERENCES auth.users(id) ON DELETE CASCADE,
  cohort                     text        NOT NULL DEFAULT 'anonymous',
  funding_source             text        NOT NULL DEFAULT 'platform',
  consent_version            integer     NOT NULL,
  sampling_policy_version    integer     NOT NULL,
  redaction_version          integer     NOT NULL,
  dataset_lane               text        NOT NULL DEFAULT 'traffic_candidate',
  model                      text        NOT NULL,
  language                   text        NOT NULL,
  course_id                  text        NOT NULL,
  lesson_id                  text        NOT NULL,
  intent                     text        NOT NULL,
  tutor_stage                text        NOT NULL,
  question_redacted          text        NOT NULL,
  response_redacted          text        NOT NULL,
  content_fingerprint        text        NOT NULL,
  file_count                 integer     NOT NULL,
  source_bytes_bucket        text        NOT NULL,
  history_turn_count         integer     NOT NULL,
  had_run_result             boolean     NOT NULL,
  run_error_type             text,
  section_keys               text[]      NOT NULL DEFAULT '{}',
  code_redaction_count       integer     NOT NULL DEFAULT 0,
  sensitive_redaction_count  integer     NOT NULL DEFAULT 0,
  identifier_redaction_count integer     NOT NULL DEFAULT 0,
  disposition                text        NOT NULL DEFAULT 'pending_review',
  created_at                 timestamptz NOT NULL DEFAULT now(),
  expires_at                 timestamptz NOT NULL DEFAULT (now() + interval '30 days'),

  CONSTRAINT ai_eval_samples_subject_hash_ck CHECK (
    subject_token_hash ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT ai_eval_samples_cohort_ck CHECK (cohort = 'anonymous'),
  CONSTRAINT ai_eval_samples_funding_ck CHECK (funding_source = 'platform'),
  CONSTRAINT ai_eval_samples_versions_ck CHECK (
    consent_version = 1
    AND sampling_policy_version = 1
    AND redaction_version = 1
  ),
  CONSTRAINT ai_eval_samples_lane_ck CHECK (dataset_lane = 'traffic_candidate'),
  CONSTRAINT ai_eval_samples_identity_bounds_ck CHECK (
    length(model) BETWEEN 1 AND 64
    AND length(language) BETWEEN 1 AND 32
    AND length(course_id) BETWEEN 1 AND 64
    AND length(lesson_id) BETWEEN 1 AND 64
  ),
  CONSTRAINT ai_eval_samples_intent_ck CHECK (
    intent IN ('socratic', 'debug', 'concept', 'howto', 'walkthrough', 'checkin')
  ),
  CONSTRAINT ai_eval_samples_stage_ck CHECK (tutor_stage IN ('clarify', 'approach')),
  CONSTRAINT ai_eval_samples_text_bounds_ck CHECK (
    length(question_redacted) BETWEEN 1 AND 2000
    AND length(response_redacted) BETWEEN 1 AND 6000
  ),
  CONSTRAINT ai_eval_samples_fingerprint_ck CHECK (
    content_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT ai_eval_samples_projection_bounds_ck CHECK (
    file_count BETWEEN 0 AND 10
    AND source_bytes_bucket IN ('0', '1-1024', '1025-4096', '4097-16384', '16385+')
    AND history_turn_count BETWEEN 0 AND 100
    AND (run_error_type IS NULL OR run_error_type IN ('none', 'compile', 'runtime', 'timeout', 'system'))
    AND cardinality(section_keys) BETWEEN 0 AND 20
    AND code_redaction_count BETWEEN 0 AND 10000
    AND sensitive_redaction_count BETWEEN 0 AND 10000
    AND identifier_redaction_count BETWEEN 0 AND 10000
  ),
  CONSTRAINT ai_eval_samples_disposition_ck CHECK (
    disposition IN ('pending_review', 'synthesis_queued', 'rejected')
  ),
  CONSTRAINT ai_eval_samples_retention_ck CHECK (
    expires_at > created_at
    AND expires_at <= created_at + interval '30 days 5 minutes'
  )
);

CREATE INDEX idx_ai_eval_samples_subject_delete
  ON public.ai_eval_samples (subject_token_hash);
CREATE INDEX idx_ai_eval_samples_user_delete
  ON public.ai_eval_samples (user_id)
  WHERE user_id IS NOT NULL;
CREATE INDEX idx_ai_eval_samples_review_queue
  ON public.ai_eval_samples (disposition, created_at)
  WHERE disposition = 'pending_review';
CREATE INDEX idx_ai_eval_samples_expiry
  ON public.ai_eval_samples (expires_at);
CREATE INDEX idx_ai_eval_samples_content_dedupe
  ON public.ai_eval_samples (content_fingerprint);

CREATE TABLE public.ai_eval_sample_reviews (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  sample_id   uuid        NOT NULL REFERENCES public.ai_eval_samples(id) ON DELETE CASCADE,
  reviewer_id uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  verdict     text        NOT NULL,
  issue_codes text[]      NOT NULL DEFAULT '{}',
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ai_eval_sample_reviews_unique_reviewer UNIQUE (sample_id, reviewer_id),
  CONSTRAINT ai_eval_sample_reviews_verdict_ck CHECK (
    verdict IN ('pass', 'fail', 'ambiguous', 'reject_privacy')
  ),
  CONSTRAINT ai_eval_sample_reviews_issue_bounds_ck CHECK (
    cardinality(issue_codes) BETWEEN 0 AND 12
    AND (note IS NULL OR length(note) BETWEEN 1 AND 500)
  )
);

CREATE INDEX idx_ai_eval_sample_reviews_sample
  ON public.ai_eval_sample_reviews (sample_id, created_at);

CREATE TABLE public.ai_eval_synthesis_queue (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  sample_id              uuid        NOT NULL UNIQUE REFERENCES public.ai_eval_samples(id) ON DELETE CASCADE,
  source_fingerprint     text        NOT NULL,
  review_count           integer     NOT NULL,
  distinct_verdict_count integer     NOT NULL,
  state                  text        NOT NULL DEFAULT 'pending_synthesis',
  synthetic_case_id      text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  resolved_at            timestamptz,

  CONSTRAINT ai_eval_synthesis_queue_fingerprint_ck CHECK (
    source_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT ai_eval_synthesis_queue_review_ck CHECK (
    review_count >= 2 AND distinct_verdict_count >= 2
  ),
  CONSTRAINT ai_eval_synthesis_queue_state_ck CHECK (
    state IN ('pending_synthesis', 'synthetic_case_authored', 'rejected')
  ),
  CONSTRAINT ai_eval_synthesis_queue_resolution_ck CHECK (
    (state = 'pending_synthesis' AND resolved_at IS NULL AND synthetic_case_id IS NULL)
    OR (
      state = 'synthetic_case_authored'
      AND resolved_at IS NOT NULL
      AND synthetic_case_id ~ '^[a-z0-9][a-z0-9_-]{2,79}$'
    )
    OR (state = 'rejected' AND resolved_at IS NOT NULL AND synthetic_case_id IS NULL)
  )
);

CREATE INDEX idx_ai_eval_synthesis_queue_pending
  ON public.ai_eval_synthesis_queue (created_at)
  WHERE state = 'pending_synthesis';

-- All B8 tables are backend-only even though they live in the exposed public
-- schema. RLS is enabled and there are intentionally no anon/authenticated
-- policies. Explicit revokes make the Data API posture obvious in a privilege
-- audit; the backend's privileged pool is the only application access path.
ALTER TABLE public.ai_eval_samples ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_eval_sample_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_eval_synthesis_queue ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.ai_eval_samples FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.ai_eval_sample_reviews FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.ai_eval_synthesis_queue FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.delete_expired_ai_eval_samples(
  batch_size integer DEFAULT 5000
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  deleted_count integer;
BEGIN
  IF batch_size < 1 OR batch_size > 50000 THEN
    RAISE EXCEPTION 'batch_size must be between 1 and 50000';
  END IF;

  WITH expired AS (
    SELECT id
      FROM public.ai_eval_samples
     WHERE expires_at <= now()
     ORDER BY expires_at
     LIMIT batch_size
     FOR UPDATE SKIP LOCKED
  )
  DELETE FROM public.ai_eval_samples AS samples
   USING expired
   WHERE samples.id = expired.id;

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

CREATE OR REPLACE FUNCTION private.queue_disagreed_ai_eval_samples(
  batch_size integer DEFAULT 1000
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  queued_count integer;
BEGIN
  IF batch_size < 1 OR batch_size > 10000 THEN
    RAISE EXCEPTION 'batch_size must be between 1 and 10000';
  END IF;

  WITH disagreements AS (
    SELECT
      samples.id AS sample_id,
      count(DISTINCT reviews.reviewer_id)::integer AS review_count,
      count(DISTINCT reviews.verdict)::integer AS distinct_verdict_count
    FROM public.ai_eval_samples AS samples
    JOIN public.ai_eval_sample_reviews AS reviews
      ON reviews.sample_id = samples.id
    WHERE samples.disposition = 'pending_review'
      AND samples.expires_at > now()
    GROUP BY samples.id
    HAVING count(DISTINCT reviews.reviewer_id) >= 2
       AND count(DISTINCT reviews.verdict) >= 2
  ), candidates AS (
    SELECT
      samples.id AS sample_id,
      samples.content_fingerprint,
      disagreements.review_count,
      disagreements.distinct_verdict_count
    FROM public.ai_eval_samples AS samples
    JOIN disagreements ON disagreements.sample_id = samples.id
    WHERE samples.disposition = 'pending_review'
      AND samples.expires_at > now()
    ORDER BY samples.created_at
    LIMIT batch_size
    FOR UPDATE SKIP LOCKED
  ), inserted AS (
    INSERT INTO public.ai_eval_synthesis_queue (
      sample_id,
      source_fingerprint,
      review_count,
      distinct_verdict_count
    )
    SELECT
      sample_id,
      content_fingerprint,
      review_count,
      distinct_verdict_count
    FROM candidates
    ON CONFLICT (sample_id) DO NOTHING
    RETURNING sample_id
  )
  UPDATE public.ai_eval_samples AS samples
     SET disposition = 'synthesis_queued'
   WHERE samples.id IN (SELECT sample_id FROM inserted);

  GET DIAGNOSTICS queued_count = ROW_COUNT;
  RETURN queued_count;
END;
$$;

REVOKE ALL ON FUNCTION private.delete_expired_ai_eval_samples(integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.queue_disagreed_ai_eval_samples(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.delete_expired_ai_eval_samples(integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION private.queue_disagreed_ai_eval_samples(integer)
  TO service_role;

-- Supabase Cron is pg_cron. These jobs make retention and the weekly review
-- intake executable rather than a runbook promise. Re-applying the migration
-- replaces same-name jobs instead of accumulating duplicates.
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
DECLARE
  existing_job_id bigint;
BEGIN
  SELECT jobid INTO existing_job_id
    FROM cron.job
   WHERE jobname = 'b8-delete-expired-ai-eval-samples';
  IF existing_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(existing_job_id);
  END IF;

  PERFORM cron.schedule(
    'b8-delete-expired-ai-eval-samples',
    '17 * * * *',
    'SELECT private.delete_expired_ai_eval_samples(5000)'
  );

  SELECT jobid INTO existing_job_id
    FROM cron.job
   WHERE jobname = 'b8-queue-disagreed-ai-eval-samples';
  IF existing_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(existing_job_id);
  END IF;

  PERFORM cron.schedule(
    'b8-queue-disagreed-ai-eval-samples',
    '23 8 * * 1',
    'SELECT private.queue_disagreed_ai_eval_samples(1000)'
  );
END $$;

-- Reviewer reads and decisions are sensitive admin actions. Keep the event
-- type allowlist synchronized with backend/src/db/adminAuditLog.ts.
ALTER TABLE public.admin_audit_log
  DROP CONSTRAINT IF EXISTS admin_audit_log_event_type_check;

ALTER TABLE public.admin_audit_log
  ADD CONSTRAINT admin_audit_log_event_type_check
  CHECK (event_type IN (
    'user_override_set',
    'user_override_cleared',
    'system_config_set',
    'system_config_cleared',
    'denylist_added',
    'denylist_removed',
    'tab_opened',
    'rejected_attempt',
    'session_terminated',
    'session_terminated_bulk',
    'user_frozen',
    'user_unfrozen',
    'budget_watcher_reset',
    'platform_auth_unstick',
    'user_force_signout',
    'eval_sample_viewed',
    'eval_sample_reviewed',
    'eval_sample_queue_resolved'
  ));

COMMENT ON TABLE public.ai_eval_samples IS
  'B8 explicitly-consented, pre-insert-redacted anonymous platform tutor traffic; 30-day maximum retention; never a golden holdout lane.';
COMMENT ON TABLE public.ai_eval_synthesis_queue IS
  'B8 high-disagreement intake. A human must author a new synthetic/expert golden case; sampled text is never copied directly into the holdout.';
COMMENT ON FUNCTION private.delete_expired_ai_eval_samples(integer) IS
  'B8 bounded hourly retention sweep. Cascades reviews and synthesis rows with the expired sample.';
COMMENT ON FUNCTION private.queue_disagreed_ai_eval_samples(integer) IS
  'B8 bounded weekly queue: requires two distinct reviewers and two distinct verdicts before synthetic-case intake.';
