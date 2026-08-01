-- Phase B8 follow-up: one retained row per redacted quality pattern.
--
-- The fingerprint is computed only after pre-insert redaction and includes the
-- tutor intent/stage plus redacted learner and tutor text. Keeping one copy is
-- enough for synthesis while preventing repeated anonymous traffic from
-- crowding reviewer capacity or generating duplicate holdout candidates.

WITH ranked_patterns AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY content_fingerprint
      ORDER BY created_at, id
    ) AS duplicate_rank
  FROM public.ai_eval_samples
)
DELETE FROM public.ai_eval_samples AS samples
USING ranked_patterns AS ranked
WHERE samples.id = ranked.id
  AND ranked.duplicate_rank > 1;

DROP INDEX IF EXISTS public.idx_ai_eval_samples_content_dedupe;

CREATE UNIQUE INDEX idx_ai_eval_samples_content_dedupe
  ON public.ai_eval_samples (content_fingerprint);

COMMENT ON INDEX public.idx_ai_eval_samples_content_dedupe IS
  'B8 post-redaction dedupe: a traffic pattern may enter independent review only once.';
