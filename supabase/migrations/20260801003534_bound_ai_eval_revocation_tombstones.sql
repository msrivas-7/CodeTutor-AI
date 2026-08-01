-- Anonymous deletion must preserve the delete-versus-insert race guarantee,
-- but an attacker must not be able to turn arbitrary well-formed tokens into
-- an unbounded number of durable revocation rows. This private daily budget is
-- consumed only when a token has neither an existing sample nor an existing
-- tombstone. Existing samples always remain deletable.

CREATE TABLE private.ai_eval_sampling_revocation_quota (
  quota_date date        PRIMARY KEY,
  consumed   integer     NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ai_eval_sampling_revocation_quota_consumed_ck CHECK (
    consumed >= 0 AND consumed <= 5000
  )
);

ALTER TABLE private.ai_eval_sampling_revocation_quota ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.ai_eval_sampling_revocation_quota
  FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE private.ai_eval_sampling_revocation_quota IS
  'Server-owned UTC-day ceiling for attacker-selected eval revocation tombstones without an existing sample.';
