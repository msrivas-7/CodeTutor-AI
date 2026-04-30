-- Phase 24B P1-2 (second-audit fix): close TRUNCATE bypass on the
-- system_config writer-gate trigger.
--
-- BEFORE INSERT/UPDATE/DELETE row triggers do not fire on TRUNCATE.
-- Pre-fix, a SQL injection that emitted `TRUNCATE public.system_config`
-- could wipe every override row, reverting all keys to env defaults
-- (silently re-enabling share creation, free-tier toggles, etc.) — the
-- writer-gate's stated guarantee was violated.
--
-- Two-layer fix:
--   (a) Add a statement-level BEFORE TRUNCATE trigger that calls the
--       same guard function. The trigger payload is OLD/NEW agnostic
--       for statement-level triggers — we just check the gate and
--       block if not satisfied. Returning normally lets the TRUNCATE
--       proceed; RAISING blocks it.
--   (b) REVOKE TRUNCATE on system_config from PUBLIC (which covers
--       service_role's default grants) so a non-superuser caller's
--       attempt fails at the privilege check before the trigger even
--       fires. The trigger remains the safety net for any role that
--       might later be granted TRUNCATE explicitly.
--
-- The statement-level trigger reuses the existing guard function. For
-- statement triggers, NEW/OLD are NULL, so we add a TG_OP branch in
-- the function: TRUNCATE always lands in the same allow/deny logic.

CREATE OR REPLACE FUNCTION public.guard_system_config_writes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Path (a): calling role is a member of the writer role.
  IF pg_has_role(current_user, 'app_system_config_writer', 'MEMBER') THEN
    -- Row triggers expect NEW/OLD; statement triggers (TRUNCATE) don't
    -- use the return value but RETURN something safe.
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Path (b): explicit per-transaction opt-in via SET LOCAL.
  IF current_setting('app.allow_system_config_write', true) = 'true' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  RAISE EXCEPTION 'system_config writes require admin context: either the calling role is a member of app_system_config_writer, or the transaction sets app.allow_system_config_write=true via SET LOCAL'
    USING ERRCODE = '42501',
          HINT = 'See backend/src/db/systemConfig.ts setSystemConfig() for the admin-route opt-in pattern.';
END $$;

-- Statement-level BEFORE TRUNCATE trigger. Note: TRUNCATE doesn't
-- support FOR EACH ROW; statement-level is the only valid form.
DROP TRIGGER IF EXISTS guard_system_config_truncate ON public.system_config;
CREATE TRIGGER guard_system_config_truncate
  BEFORE TRUNCATE ON public.system_config
  FOR EACH STATEMENT EXECUTE FUNCTION public.guard_system_config_writes();

-- Defense in depth: revoke TRUNCATE from broad roles so the trigger is
-- a backstop, not the only line of defense. PUBLIC covers any role
-- that hasn't been explicitly granted; service_role inherits PUBLIC's
-- grants but also has its own owner-of-table privileges in some
-- Supabase project setups, so we explicitly revoke from it as well.
REVOKE TRUNCATE ON public.system_config FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'REVOKE TRUNCATE ON public.system_config FROM service_role';
  END IF;
END $$;
