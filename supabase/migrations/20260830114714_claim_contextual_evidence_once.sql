-- Release 1C: a signed contextual-run proof may fund at most one admitted
-- Tutor request. Keeping the claim on the durable reservation row makes the
-- rule survive retries, backend restarts, and concurrent replicas.

ALTER TABLE public.ai_request_reservations
  ADD COLUMN contextual_evidence_digest text;

ALTER TABLE public.ai_request_reservations
  ADD CONSTRAINT ai_request_reservations_contextual_evidence_digest_shape
  CHECK (
    contextual_evidence_digest IS NULL
    OR contextual_evidence_digest ~ '^[0-9a-f]{64}$'
  );

CREATE UNIQUE INDEX uq_ai_request_reservations_contextual_evidence_digest
  ON public.ai_request_reservations (contextual_evidence_digest)
  WHERE contextual_evidence_digest IS NOT NULL;

COMMENT ON COLUMN public.ai_request_reservations.contextual_evidence_digest IS
  'SHA-256 digest of a server-signed contextual evidence token; unique so one proof admits at most one AI request.';
