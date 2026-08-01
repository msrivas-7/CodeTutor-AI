-- Phase B8 follow-up: make the documented 30-day retention ceiling exact.
--
-- The original constraint allowed a five-minute tolerance. PostgreSQL's
-- transaction-stable now() already makes the created/expires defaults exact,
-- so the tolerance was unnecessary and weakened the stated privacy contract.

ALTER TABLE public.ai_eval_samples
  DROP CONSTRAINT ai_eval_samples_retention_ck;

ALTER TABLE public.ai_eval_samples
  ADD CONSTRAINT ai_eval_samples_retention_ck CHECK (
    expires_at > created_at
    AND expires_at <= created_at + interval '30 days'
  );

COMMENT ON CONSTRAINT ai_eval_samples_retention_ck
  ON public.ai_eval_samples IS
  'B8 hard privacy ceiling: every retained sample expires no later than 30 days after creation.';
