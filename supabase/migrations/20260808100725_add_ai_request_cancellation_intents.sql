-- Q3 / UX-097: make Stop durable even when it reaches the backend before the
-- matching stream request has completed admission. The request-id advisory
-- lock in application code serializes the intent with reservation creation;
-- this table carries that intent across processes and backend replicas.

CREATE TABLE public.ai_request_cancellation_intents (
  request_id   uuid        PRIMARY KEY,
  actor_kind   text        NOT NULL,
  user_id      uuid        REFERENCES auth.users(id) ON DELETE CASCADE,
  ip_hash      text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL DEFAULT (now() + interval '5 minutes'),

  CONSTRAINT ai_request_cancellation_intents_actor_val
    CHECK (actor_kind IN ('user', 'anonymous')),
  CONSTRAINT ai_request_cancellation_intents_owner_ck
    CHECK (
      (actor_kind = 'user' AND user_id IS NOT NULL AND ip_hash IS NULL)
      OR
      (actor_kind = 'anonymous' AND user_id IS NULL AND ip_hash IS NOT NULL)
    ),
  CONSTRAINT ai_request_cancellation_intents_ip_hash_shape
    CHECK (ip_hash IS NULL OR length(ip_hash) BETWEEN 16 AND 128),
  CONSTRAINT ai_request_cancellation_intents_ttl_bounds
    CHECK (expires_at > created_at AND expires_at <= created_at + interval '5 minutes')
);

CREATE INDEX idx_ai_request_cancellation_intents_expiry
  ON public.ai_request_cancellation_intents (expires_at);

-- The backend service-role pool is the only reader/writer. No browser-facing
-- policies are intentionally defined.
ALTER TABLE public.ai_request_cancellation_intents ENABLE ROW LEVEL SECURITY;
