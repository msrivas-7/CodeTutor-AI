-- Phase 27 §3d: anonymous AI usage ledger.
--
-- Mirrors public.ai_usage_ledger but keyed by an IP hash instead of a
-- user_id (anonymous traffic has no UUID). Splitting into a separate
-- table — instead of widening ai_usage_ledger with a nullable user_id +
-- nullable ip_hash — keeps the existing per-user advisory-lock + FK +
-- partial-index semantics intact for the authed path. Cross-table
-- aggregation only happens at the L4 (global daily $) layer.
--
-- Why a hash, not the raw IP:
--   - Privacy: a leaked DB dump must not surface raw user IPs.
--   - The hash is salted at the application layer (sha256 of ip plus a
--     static label). The threat model is "data-at-rest disclosure",
--     not "rainbow-table inversion of full IPv4 space" — a static
--     salt is fine for our scope.
--   - The cap window is 24h, so a hash that differs day-to-day would
--     defeat the per-IP daily cap. We accept stable hashes as the
--     trade-off.
--
-- Why no FK / no DELETE CASCADE:
--   - There's nothing to cascade from. Anon traffic has no parent row.
--   - Operator can drop old rows on a TTL via a periodic sweep
--     (anything > 30d can go; the L_anon cap only ever consults today).

CREATE TABLE IF NOT EXISTS public.ai_anon_usage_ledger (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_hash             text          NOT NULL,
  created_at          timestamptz   NOT NULL DEFAULT now(),
  model               text          NOT NULL,
  funding_source      text          NOT NULL DEFAULT 'platform',
  route               text          NOT NULL,
  counts_toward_quota boolean       NOT NULL DEFAULT TRUE,
  input_tokens        int           NOT NULL,
  output_tokens       int           NOT NULL,
  cost_usd            numeric(10,6) NOT NULL,
  price_version       int           NOT NULL,
  status              text          NOT NULL,
  request_id          text          NOT NULL,

  -- Anon never uses BYOK — anonymous can't have a personal key. The
  -- check pins it so an accidental future call site can't smuggle
  -- byok rows into the anon table and bypass the per-IP cap.
  CONSTRAINT ai_anon_usage_ledger_funding_source_val
    CHECK (funding_source IN ('platform')),
  CONSTRAINT ai_anon_usage_ledger_route_val
    CHECK (route IN ('ask','ask_stream')),
  CONSTRAINT ai_anon_usage_ledger_status_val
    CHECK (status IN ('finish','error','aborted')),
  CONSTRAINT ai_anon_usage_ledger_tokens_nonneg
    CHECK (input_tokens >= 0 AND output_tokens >= 0),
  CONSTRAINT ai_anon_usage_ledger_cost_nonneg
    CHECK (cost_usd >= 0),
  CONSTRAINT ai_anon_usage_ledger_ip_hash_shape
    CHECK (length(ip_hash) BETWEEN 16 AND 128)
);

-- Per-IP today index — covers the L_anon cap query
-- (count(*) WHERE ip_hash = X AND created_at >= today_utc).
CREATE INDEX IF NOT EXISTS idx_ai_anon_usage_ledger_ip_today
  ON public.ai_anon_usage_ledger (ip_hash, created_at);

-- Today-global index — covers the global L4 $ cap query that sums
-- across all anon traffic for the current UTC day.
CREATE INDEX IF NOT EXISTS idx_ai_anon_usage_ledger_today
  ON public.ai_anon_usage_ledger (created_at);

-- Phase 26 zero-trust norm: every new table enables RLS, even backend-
-- only tables that are written by the service-role pool (which
-- bypasses RLS). Deny-all-by-default keeps the project-wide invariant
-- that "no policies = no client read/write" intact, so an accidental
-- future shift to the dual-pool authenticated role on this table
-- can't expose IP-hash + cost data without an explicit policy.
ALTER TABLE public.ai_anon_usage_ledger ENABLE ROW LEVEL SECURITY;
