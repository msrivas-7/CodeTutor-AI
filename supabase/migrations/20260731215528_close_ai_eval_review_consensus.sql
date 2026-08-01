-- Phase B8 follow-up: bound independent review and close non-disagreement.
--
-- A retained sample needs at most two independent verdicts. Disagreements
-- continue to enter the synthesis queue; agreement is terminal and should not
-- crowd future reviewer work until the 30-day retention sweep deletes it.

ALTER TABLE public.ai_eval_samples
  DROP CONSTRAINT ai_eval_samples_disposition_ck;

ALTER TABLE public.ai_eval_samples
  ADD CONSTRAINT ai_eval_samples_disposition_ck CHECK (
    disposition IN (
      'pending_review',
      'review_complete',
      'synthesis_queued',
      'rejected'
    )
  );

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

  WITH reviewed AS (
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
  ), disagreement_candidates AS (
    SELECT
      samples.id AS sample_id,
      samples.content_fingerprint,
      reviewed.review_count,
      reviewed.distinct_verdict_count
    FROM public.ai_eval_samples AS samples
    JOIN reviewed ON reviewed.sample_id = samples.id
    WHERE samples.disposition = 'pending_review'
      AND samples.expires_at > now()
      AND reviewed.distinct_verdict_count >= 2
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
    FROM disagreement_candidates
    ON CONFLICT DO NOTHING
    RETURNING sample_id
  )
  UPDATE public.ai_eval_samples AS samples
     SET disposition = 'synthesis_queued'
   WHERE samples.id IN (SELECT sample_id FROM inserted);

  GET DIAGNOSTICS queued_count = ROW_COUNT;

  WITH consensus AS (
    SELECT samples.id AS sample_id
      FROM public.ai_eval_samples AS samples
      JOIN public.ai_eval_sample_reviews AS reviews
        ON reviews.sample_id = samples.id
     WHERE samples.disposition = 'pending_review'
       AND samples.expires_at > now()
     GROUP BY samples.id
    HAVING count(DISTINCT reviews.reviewer_id) >= 2
       AND count(DISTINCT reviews.verdict) = 1
  ), consensus_candidates AS (
    SELECT samples.id
      FROM public.ai_eval_samples AS samples
      JOIN consensus ON consensus.sample_id = samples.id
     WHERE samples.disposition = 'pending_review'
     ORDER BY samples.created_at
     LIMIT batch_size
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public.ai_eval_samples AS samples
     SET disposition = 'review_complete'
   WHERE samples.id IN (SELECT id FROM consensus_candidates);

  RETURN queued_count;
END;
$$;

COMMENT ON FUNCTION private.queue_disagreed_ai_eval_samples(integer) IS
  'B8 weekly closeout: queue two-reviewer disagreement and close two-reviewer consensus.';
