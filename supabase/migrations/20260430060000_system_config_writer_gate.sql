-- Phase 24B P1-1 (audit fix): defense-in-depth gate on system_config writes.
--
-- The system_config table holds runtime kill switches + cost caps for the
-- ACI overflow path (aci_overflow_enabled, aci_daily_usd_cap, aci_max_overflow,
-- aci_warm_pool_enabled) AND the free-tier kill switches (free_tier_*). A
-- SQL injection in any non-admin route that hits the same DB pool could in
-- theory corrupt these values — bypassing the cost cap or flipping the
-- overflow toggle without an admin-audit-log entry.
--
-- The audit asked for separation between admin-write and runtime-read
-- paths. Two-layer defense:
--
--   (a) Dedicated role app_system_config_writer with the only direct
--       INSERT/UPDATE/DELETE grants on system_config. Future operator
--       can provision a password + connection string for this role and
--       route the admin pool through it (DATABASE_URL_ADMIN env var,
--       see ops/PHASE-24B-RUNBOOK.md).
--
--   (b) BEFORE trigger that requires EITHER:
--         - the calling role is a member of app_system_config_writer
--           (the dual-pool path, when DATABASE_URL_ADMIN is configured),
--         - OR the session-level GUC app.allow_system_config_write is
--           set to 'true' for the current transaction (current single-
--           pool path; admin route opts in via SET LOCAL inside a
--           transaction so the var cannot leak across pooled connections).
--
-- The current single-pool deploy uses path (b): the admin route's
-- set/clear functions wrap their writes in a transaction with SET LOCAL.
-- Once an operator opts into the dual-pool architecture, path (a) takes
-- over and SET LOCAL becomes a no-op safety net.
--
-- Rejection error uses code 42501 (insufficient_privilege) so route
-- handlers can map to a 403 if they ever leak through, instead of a
-- generic 500.

-- Idempotent role creation. NOLOGIN by default — future operator step
-- is `ALTER ROLE app_system_config_writer LOGIN PASSWORD '...';` once
-- the dual-pool path is wired.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_system_config_writer') THEN
    CREATE ROLE app_system_config_writer NOLOGIN;
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.system_config
  TO app_system_config_writer;

-- Trigger function. SECURITY DEFINER so the privilege check runs
-- regardless of the calling role's grants — pg_has_role and
-- current_setting both work without further permissions.
CREATE OR REPLACE FUNCTION public.guard_system_config_writes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Path (a): calling role is a member of the writer role.
  IF pg_has_role(current_user, 'app_system_config_writer', 'MEMBER') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Path (b): explicit per-transaction opt-in via SET LOCAL. The third
  -- arg `true` to current_setting makes it return NULL instead of
  -- erroring when the GUC is unset, which is the common case (any non-
  -- admin code path).
  IF current_setting('app.allow_system_config_write', true) = 'true' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  RAISE EXCEPTION 'system_config writes require admin context: either the calling role is a member of app_system_config_writer, or the transaction sets app.allow_system_config_write=true via SET LOCAL'
    USING ERRCODE = '42501',
          HINT = 'See backend/src/db/systemConfig.ts setSystemConfig() for the admin-route opt-in pattern.';
END $$;

DROP TRIGGER IF EXISTS guard_system_config_writes ON public.system_config;
CREATE TRIGGER guard_system_config_writes
  BEFORE INSERT OR UPDATE OR DELETE ON public.system_config
  FOR EACH ROW EXECUTE FUNCTION public.guard_system_config_writes();
