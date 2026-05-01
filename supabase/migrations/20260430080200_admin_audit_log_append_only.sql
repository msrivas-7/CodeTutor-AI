-- Phase 26 zero-trust hardening (audit finding F2.2): make admin_audit_log
-- tamper-resistant.
--
-- Threat: a compromised SUPABASE_SERVICE_ROLE_KEY (or any role with the
-- same privileges as the backend's connection role) could `DELETE FROM
-- admin_audit_log WHERE actor_id = '<their uuid>'` and erase their tracks.
-- The stdout shadow into Log Analytics is our real safety net (Azure RBAC
-- on the LA workspace is in a different blast radius from Supabase keys),
-- but a defense-in-depth move at the DB layer makes the attack visibly
-- noisy: the DELETE attempt itself raises an error and lands in the
-- Postgres log.
--
-- Approach mirrors the system_config_writer_gate pattern (Phase 24B P1-1):
-- BEFORE UPDATE/DELETE row trigger + BEFORE TRUNCATE statement trigger
-- both fail closed. A retention-purge path is left intentionally available
-- via a transaction-level GUC opt-in (`app.allow_admin_audit_log_purge`)
-- so a future scheduled job can age out rows older than N days; the
-- backend's hot path doesn't set that GUC and so cannot tamper.
--
-- Why an opt-in GUC vs. fully forbidden: leaving zero path means a
-- legitimate retention job (when we eventually need one) requires either
-- editing this migration or running raw psql out-of-band. Both are worse
-- than a single `SET LOCAL app.allow_admin_audit_log_purge = 'true'` in
-- a clearly-labeled job. The GUC is per-transaction so it can't leak
-- across requests.

CREATE OR REPLACE FUNCTION public.guard_admin_audit_log_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF current_setting('app.allow_admin_audit_log_purge', true) = 'true' THEN
    -- Row triggers expect NEW/OLD; statement triggers (TRUNCATE) don't
    -- use the return value but RETURN something safe.
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION
    'admin_audit_log is append-only — UPDATE/DELETE/TRUNCATE require app.allow_admin_audit_log_purge=true (retention-purge path only; never tamper)'
    USING ERRCODE = '42501',
          HINT = 'See ops/runbooks/admin-audit-log-purge.md (when the retention job is built).';
END $$;

DROP TRIGGER IF EXISTS guard_admin_audit_log_update ON public.admin_audit_log;
CREATE TRIGGER guard_admin_audit_log_update
  BEFORE UPDATE OR DELETE ON public.admin_audit_log
  FOR EACH ROW EXECUTE FUNCTION public.guard_admin_audit_log_mutation();

DROP TRIGGER IF EXISTS guard_admin_audit_log_truncate ON public.admin_audit_log;
CREATE TRIGGER guard_admin_audit_log_truncate
  BEFORE TRUNCATE ON public.admin_audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION public.guard_admin_audit_log_mutation();

-- Defense in depth: revoke TRUNCATE from broad roles so the trigger is
-- a backstop, not the only line of defense (matches the pattern in
-- 20260430070000_system_config_truncate_gate.sql).
REVOKE TRUNCATE ON public.admin_audit_log FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'REVOKE TRUNCATE ON public.admin_audit_log FROM service_role';
  END IF;
END $$;
