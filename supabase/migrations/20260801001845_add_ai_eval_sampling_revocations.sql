-- A deletion capability must also revoke writes that were already in flight
-- when deletion completed. The backend serializes insert/delete operations by
-- subject hash with a transaction-scoped advisory lock, while this private,
-- bounded tombstone makes the revocation durable across requests and replicas.

CREATE TABLE private.ai_eval_sampling_revocations (
  subject_token_hash text        PRIMARY KEY,
  revoked_at         timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz NOT NULL DEFAULT (now() + interval '31 days'),

  CONSTRAINT ai_eval_sampling_revocations_hash_ck CHECK (
    subject_token_hash ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT ai_eval_sampling_revocations_retention_ck CHECK (
    expires_at > revoked_at
    AND expires_at <= revoked_at + interval '31 days 5 minutes'
  )
);

CREATE INDEX idx_ai_eval_sampling_revocations_expiry
  ON private.ai_eval_sampling_revocations (expires_at);

ALTER TABLE private.ai_eval_sampling_revocations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.ai_eval_sampling_revocations
  FROM PUBLIC, anon, authenticated;

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

  WITH expired_revocations AS (
    SELECT subject_token_hash
      FROM private.ai_eval_sampling_revocations
     WHERE expires_at <= now()
     ORDER BY expires_at
     LIMIT batch_size
     FOR UPDATE SKIP LOCKED
  )
  DELETE FROM private.ai_eval_sampling_revocations AS revocations
   USING expired_revocations
   WHERE revocations.subject_token_hash = expired_revocations.subject_token_hash;

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

COMMENT ON TABLE private.ai_eval_sampling_revocations IS
  'Bounded hashes of anonymous deletion capabilities; blocks in-flight eval sample writes after deletion succeeds.';
