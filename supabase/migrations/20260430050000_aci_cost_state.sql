-- Phase 24B P0-1: persist ACI cost-tracker state across backend restarts.
--
-- The in-process aciCostTracker singleton was previously volatile —
-- a SIGTERM, OOM, deploy, or any unhandled rejection would zero the
-- daily $-cap accumulator AND forget every active session's start
-- time. An attacker (or a routine deploy at 23:55 UTC) could trigger
-- a restart to launder the daily cap to $0 and continue spawning
-- ACI containers past the intended ceiling. Combined with fire-and-
-- forget tryDelete (P0-3), orphan ACI groups would also continue
-- billing on Azure's side with zero local visibility.
--
-- Schema: a singleton row (CHECK constraint enforces id='current')
-- holding the three pieces of state the tracker needs for crash
-- recovery:
--   - completed_today_usd: sum of finalized session billing today
--   - current_date_utc:    YYYY-MM-DD; rollover detection on read
--   - active_sessions:     JSONB array of {sessionId, startedAt}
--                          (includes warm-pool synthetic ids)
--
-- Singleton pattern (id text PRIMARY KEY + CHECK id='current') keeps
-- the upsert path trivially atomic — every write is the same row.
-- numeric (not float) for the dollar accumulator so floating-point
-- rounding can't cumulatively drift the cap decision over hours.
--
-- RLS: deny-all. Only the backend service-role pool reads/writes.
-- (Future P1-1 will move the admin-config writes to a separate role,
-- but this table is exclusively backend-internal — no admin edits.)

CREATE TABLE public.aci_cost_state (
  id                  text        PRIMARY KEY DEFAULT 'current',
  completed_today_usd numeric     NOT NULL DEFAULT 0,
  current_date_utc    text        NOT NULL,
  active_sessions     jsonb       NOT NULL DEFAULT '[]'::jsonb,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT aci_cost_state_singleton CHECK (id = 'current')
);

-- Seed the singleton row so the backend's UPDATE path always finds it
-- (no INSERT ON CONFLICT branch needed in the hot path). current_date_utc
-- gets initialized to today's UTC date; the tracker's rollover logic
-- detects + resets correctly on first post-deploy read.
INSERT INTO public.aci_cost_state (id, current_date_utc)
  VALUES ('current', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD'));

ALTER TABLE public.aci_cost_state ENABLE ROW LEVEL SECURITY;
-- No policies = deny-all. Service-role pool bypasses RLS.
