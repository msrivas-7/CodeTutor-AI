-- Phase 27-v2.2 Fix 6 — funnel telemetry for the anon trial path.
--
-- The trial path's whole reason for existing is conversion measurement:
-- "did Maya land on /try/, did she hit the wall, did she sign up, did
-- she reach lesson 2." Without instrumentation we can't tell shipping
-- the feature from doing nothing. PM audit lane flagged this as P0;
-- this migration + the matching POST /api/telemetry/event route are
-- the minimum-viable funnel.
--
-- Schema is intentionally narrow:
--   - id           uuid surrogate (gen_random_uuid)
--   - event        constrained to four canonical funnel labels; an
--                  unknown event reads as "telemetry attacker is
--                  poking us" and gets rejected before insert
--   - reason       nullable; only `anon_wall_opened` populates it
--                  with the SignupWallReason ("save"/"next-lesson"/
--                  "exhausted"/"share")
--   - ip_hash      same shape as ai_anon_usage_ledger so cross-table
--                  joins (e.g., "of IPs that hit ANON_EXHAUSTED, how
--                  many converted") are mechanically possible later
--   - occurred_at  timestamptz default now() — UTC for funnel windows
--
-- TTL: same 30d sweep policy the anon ledger comment promises (Phase
-- 28 backlog item — neither table sweeps yet, but storage cost is
-- bounded and the table is stripped of PII by design).

CREATE TABLE IF NOT EXISTS public.phase27_funnel_events (
  id          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  event       text          NOT NULL,
  reason      text,
  ip_hash     text          NOT NULL,
  occurred_at timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT phase27_funnel_events_event_val
    CHECK (event IN (
      'anon_page_view',
      'anon_wall_opened',
      'anon_signup_completed',
      'anon_lesson2_reached'
    )),
  -- reason is only meaningful for anon_wall_opened; loosely scoped to
  -- the SignupWallReason union so a future reason value lands here
  -- without a migration. Empty string would be ambiguous, so disallow.
  CONSTRAINT phase27_funnel_events_reason_val
    CHECK (reason IS NULL OR length(reason) BETWEEN 1 AND 32),
  CONSTRAINT phase27_funnel_events_ip_hash_shape
    CHECK (length(ip_hash) BETWEEN 16 AND 128)
);

-- Daily funnel rollup index — covers admin-dashboard queries like
-- "today's anon_page_view count" / "today's anon_wall_opened by
-- reason." Same shape as the anon ledger's today index.
CREATE INDEX IF NOT EXISTS idx_phase27_funnel_events_today
  ON public.phase27_funnel_events (occurred_at);
CREATE INDEX IF NOT EXISTS idx_phase27_funnel_events_event_today
  ON public.phase27_funnel_events (event, occurred_at);

-- Phase 26 zero-trust norm: deny-all RLS. Service-role pool writes;
-- admin reads via authed admin route, never through the client.
ALTER TABLE public.phase27_funnel_events ENABLE ROW LEVEL SECURITY;
