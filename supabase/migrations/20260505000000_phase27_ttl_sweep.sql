-- Phase 27-v2.2 audit fix C4 (staff-sre + staff-qa convergence) —
-- TTL sweep for ai_anon_usage_ledger and phase27_funnel_events.
--
-- Pre-fix, both tables grew without bound. The L_anon cap only consults
-- today's rows, so anything older is dead data. The funnel-events table
-- is even more relaxed — admins poll today's slice (Phase 27-v2.2 audit
-- fix A1) so old rows are pure storage cost.
--
-- Strategy: ship a SECURITY DEFINER function that deletes rows older
-- than 30 days. The function is idempotent and bounded — it caps the
-- delete at 50k rows per invocation so an accumulated backlog can't
-- pin a connection. An operator (or Supabase pg_cron, if enabled) calls
-- the function on a daily-ish schedule.
--
-- We do NOT auto-schedule via pg_cron in this migration because:
--   1. pg_cron requires the extension be enabled, which is project-
--      level and may not be on for every env we ship to.
--   2. A scheduled DELETE that runs at the wrong moment can lock
--      contention with the L_anon write path; operator-driven
--      kickoff at a known-quiet hour is safer for v0.
--
-- Operator runbook: `SELECT public.phase27_ttl_sweep();` once a day
-- (e.g., via `supabase functions invoke` or a manual cron job). The
-- function returns the count of rows deleted from each table.
--
-- Forward-only: the rollback for this migration is just to leave the
-- function in place; it harms nothing if not called.

CREATE OR REPLACE FUNCTION public.phase27_ttl_sweep()
RETURNS TABLE (
  ledger_deleted bigint,
  funnel_deleted bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
-- Restrict the search_path so a SECURITY DEFINER function can't be
-- hijacked by a same-named relation in a caller-controlled schema.
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ledger_deleted bigint := 0;
  v_funnel_deleted bigint := 0;
BEGIN
  -- 30-day TTL on the anon ledger. Bounded delete so a 6-month accrued
  -- backlog can't lock the connection — operator runs daily and the
  -- table catches up over a few invocations.
  WITH old_rows AS (
    SELECT id
      FROM public.ai_anon_usage_ledger
     WHERE created_at < now() - interval '30 days'
     LIMIT 50000
  )
  DELETE FROM public.ai_anon_usage_ledger l
   USING old_rows o
   WHERE l.id = o.id;
  GET DIAGNOSTICS v_ledger_deleted = ROW_COUNT;

  -- Same TTL on the funnel-events table. The admin Trial-path tab
  -- only renders today's slice (audit A1) so older rows are dead.
  WITH old_events AS (
    SELECT id
      FROM public.phase27_funnel_events
     WHERE occurred_at < now() - interval '30 days'
     LIMIT 50000
  )
  DELETE FROM public.phase27_funnel_events f
   USING old_events o
   WHERE f.id = o.id;
  GET DIAGNOSTICS v_funnel_deleted = ROW_COUNT;

  RETURN QUERY SELECT v_ledger_deleted, v_funnel_deleted;
END;
$$;

-- The function runs as the role that owns it (postgres / service_role
-- via Supabase). RLS on these tables is deny-all to anon/authenticated;
-- the SECURITY DEFINER bypass is intentional.
REVOKE ALL ON FUNCTION public.phase27_ttl_sweep() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.phase27_ttl_sweep() TO postgres, service_role;

COMMENT ON FUNCTION public.phase27_ttl_sweep() IS
  'Phase 27-v2.2 audit fix C4: deletes ai_anon_usage_ledger and phase27_funnel_events rows older than 30 days. Bounded at 50k rows per call. Operator runs daily (or wires pg_cron) — see ops/PHASE-27-V2-ROLLBACK.md.';
