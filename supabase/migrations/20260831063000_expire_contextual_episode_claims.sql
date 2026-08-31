-- The replay key excludes client-owned epoch/revision fields. Database time
-- owns the bounded episode window so changing browser metadata cannot reset it,
-- while a learner can receive fresh help after the signed-evidence lifetime.

ALTER TABLE public.ai_contextual_episode_claims
  ADD COLUMN expires_at timestamptz NOT NULL
  DEFAULT (now() + interval '15 minutes');

CREATE INDEX idx_ai_contextual_episode_claims_expiry
  ON public.ai_contextual_episode_claims (expires_at);

COMMENT ON COLUMN public.ai_contextual_episode_claims.expires_at IS
  'Server-owned replay-window expiry aligned to the 15-minute contextual evidence token lifetime.';
