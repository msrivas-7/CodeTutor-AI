-- Release 1C hardening: the signed error episode, not a client-selected
-- receipt subset, is the atomic single-use admission boundary.

CREATE TABLE public.ai_contextual_episode_claims (
  episode_digest text PRIMARY KEY,
  request_id uuid NOT NULL
    REFERENCES public.ai_request_reservations(request_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_contextual_episode_claims_digest_shape
    CHECK (episode_digest ~ '^[0-9a-f]{64}$')
);

ALTER TABLE public.ai_contextual_episode_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ai_contextual_episode_claims FROM anon, authenticated;

COMMENT ON TABLE public.ai_contextual_episode_claims IS
  'Server-only atomic claims for signed contextual Tutor error episodes; disjoint receipt subsets cannot fund multiple calls.';
