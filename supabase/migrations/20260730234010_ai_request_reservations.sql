-- Release 0D: atomic AI admission + offer-accept idempotency.
--
-- One row represents one learner-accepted AI action. The backend inserts the
-- row in the same transaction that checks every applicable platform quota and
-- pessimistic dollar budget. The provider is called only after the INSERT
-- commits, so concurrent requests and multiple backend replicas cannot all
-- observe the same pre-call capacity.
--
-- BYOK actions also use this table (with reserved_cost_usd = 0) so the same
-- request_id cannot create duplicate model calls. Platform-funded calls fail
-- closed when this store is unavailable. Terminal rows are immutable from the
-- application layer and remain as the durable idempotency record.

CREATE TABLE public.ai_request_reservations (
  request_id                uuid          PRIMARY KEY,
  actor_kind                text          NOT NULL,
  user_id                   uuid          REFERENCES auth.users(id) ON DELETE CASCADE,
  ip_hash                   text,
  funding_source            text          NOT NULL,
  model                     text          NOT NULL,
  route                     text          NOT NULL,
  request_fingerprint       text          NOT NULL,
  counts_toward_quota       boolean       NOT NULL,
  reserved_input_tokens     int           NOT NULL,
  reserved_output_tokens    int           NOT NULL,
  reserved_cost_usd         numeric(10,6) NOT NULL,
  price_version             int           NOT NULL,
  state                     text          NOT NULL DEFAULT 'reserved',
  created_at                timestamptz   NOT NULL DEFAULT now(),
  expires_at                timestamptz   NOT NULL,
  finalized_at              timestamptz,
  final_input_tokens        int,
  final_output_tokens       int,
  final_cost_usd            numeric(10,6),
  ledger_status             text,
  provider_outcome_uncertain boolean      NOT NULL DEFAULT false,

  CONSTRAINT ai_request_reservations_actor_val
    CHECK (actor_kind IN ('user', 'anonymous')),
  CONSTRAINT ai_request_reservations_owner_ck
    CHECK (
      (actor_kind = 'user' AND user_id IS NOT NULL AND ip_hash IS NULL)
      OR
      (actor_kind = 'anonymous' AND user_id IS NULL AND ip_hash IS NOT NULL)
    ),
  CONSTRAINT ai_request_reservations_ip_hash_shape
    CHECK (ip_hash IS NULL OR length(ip_hash) BETWEEN 16 AND 128),
  CONSTRAINT ai_request_reservations_funding_val
    CHECK (funding_source IN ('platform', 'byok')),
  CONSTRAINT ai_request_reservations_route_val
    CHECK (route IN ('ask', 'ask_stream', 'summarize')),
  CONSTRAINT ai_request_reservations_fingerprint_shape
    CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ai_request_reservations_state_val
    CHECK (state IN ('reserved', 'finalized', 'released', 'expired')),
  CONSTRAINT ai_request_reservations_ledger_status_val
    CHECK (ledger_status IS NULL OR ledger_status IN ('finish', 'error', 'aborted')),
  CONSTRAINT ai_request_reservations_token_bounds
    CHECK (
      reserved_input_tokens >= 0
      AND reserved_output_tokens >= 0
      AND (final_input_tokens IS NULL OR final_input_tokens >= 0)
      AND (final_output_tokens IS NULL OR final_output_tokens >= 0)
    ),
  CONSTRAINT ai_request_reservations_cost_bounds
    CHECK (
      reserved_cost_usd >= 0
      AND (final_cost_usd IS NULL OR final_cost_usd >= 0)
      AND (funding_source = 'platform' OR reserved_cost_usd = 0)
    ),
  CONSTRAINT ai_request_reservations_ttl_bounds
    CHECK (expires_at > created_at AND expires_at <= created_at + interval '60 seconds'),
  CONSTRAINT ai_request_reservations_terminal_shape
    CHECK (
      (state = 'reserved' AND finalized_at IS NULL AND final_cost_usd IS NULL AND ledger_status IS NULL)
      OR
      (state = 'released' AND finalized_at IS NOT NULL AND final_cost_usd = 0 AND ledger_status IS NULL)
      OR
      (state IN ('finalized', 'expired') AND finalized_at IS NOT NULL AND final_cost_usd IS NOT NULL AND ledger_status IS NOT NULL)
    )
);

-- The hot admission queries count active reservations alongside durable usage.
CREATE INDEX idx_ai_request_reservations_active_global
  ON public.ai_request_reservations (created_at, reserved_cost_usd)
  WHERE state = 'reserved' AND funding_source = 'platform';

CREATE INDEX idx_ai_request_reservations_active_user
  ON public.ai_request_reservations (user_id, created_at)
  WHERE state = 'reserved' AND funding_source = 'platform' AND user_id IS NOT NULL;

CREATE INDEX idx_ai_request_reservations_active_anon
  ON public.ai_request_reservations (ip_hash, created_at)
  WHERE state = 'reserved' AND funding_source = 'platform' AND ip_hash IS NOT NULL;

CREATE INDEX idx_ai_request_reservations_expiry
  ON public.ai_request_reservations (expires_at)
  WHERE state = 'reserved';

-- Exposed-schema defense in depth: the backend service-role pool is the only
-- reader/writer. No anon/authenticated policies are intentionally defined.
ALTER TABLE public.ai_request_reservations ENABLE ROW LEVEL SECURITY;
