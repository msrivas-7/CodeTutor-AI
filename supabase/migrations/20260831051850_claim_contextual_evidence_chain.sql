-- Release 1C hardening: claim every signed receipt that made a contextual
-- episode eligible. A second request with any overlapping receipt is a replay,
-- even when it advances the terminal revision.

CREATE TABLE public.ai_contextual_evidence_claims (
  evidence_digest text PRIMARY KEY,
  request_id uuid NOT NULL
    REFERENCES public.ai_request_reservations(request_id) ON DELETE CASCADE,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_contextual_evidence_claims_digest_shape
    CHECK (evidence_digest ~ '^[0-9a-f]{64}$')
);

ALTER TABLE public.ai_contextual_evidence_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ai_contextual_evidence_claims FROM anon, authenticated;

INSERT INTO public.ai_contextual_evidence_claims (evidence_digest, request_id)
SELECT contextual_evidence_digest, request_id
  FROM public.ai_request_reservations
 WHERE contextual_evidence_digest IS NOT NULL
ON CONFLICT (evidence_digest) DO NOTHING;

COMMENT ON TABLE public.ai_contextual_evidence_claims IS
  'Server-only atomic claims for every signed receipt in an admitted contextual Tutor evidence chain.';
