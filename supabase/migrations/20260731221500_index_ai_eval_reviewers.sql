-- Phase B8 follow-up: cover the reviewer foreign key.
--
-- Reviews expire with their sample, but an administrator account deletion
-- also cascades through reviewer_id. The covering index keeps that cleanup
-- bounded as the short-lived review table grows.

CREATE INDEX idx_ai_eval_sample_reviews_reviewer
  ON public.ai_eval_sample_reviews (reviewer_id, sample_id);

COMMENT ON INDEX public.idx_ai_eval_sample_reviews_reviewer IS
  'B8 reviewer-account deletion and audit lookup support.';
