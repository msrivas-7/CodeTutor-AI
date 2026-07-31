-- Least-privilege repair discovered by the linked-project advisor during the
-- B4 release pass.
--
-- Two SECURITY DEFINER share helpers survived in codetutor-dev from an early
-- draft even though the committed base migration and backend use direct,
-- server-side SQL instead. Drop that remote-only drift explicitly so a new
-- checkout and an existing project converge on the same schema.
DROP FUNCTION IF EXISTS public.bump_share_view(text);
DROP FUNCTION IF EXISTS public.revoke_share(text);

-- Trigger and maintenance functions are invoked by Postgres or the trusted
-- backend role. They are not public RPC endpoints. PostgreSQL grants EXECUTE
-- to PUBLIC on new functions by default, so revoke both the inherited grant
-- and any explicit API-role grants before restoring the server roles.
REVOKE ALL ON FUNCTION public.feedback_scrub_on_user_delete()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_admin_audit_log_mutation()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_system_config_writes()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.phase27_ttl_sweep()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.phase_a_ttl_sweep()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rls_auto_enable()
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.feedback_scrub_on_user_delete()
  TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.guard_admin_audit_log_mutation()
  TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.guard_system_config_writes()
  TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.phase27_ttl_sweep()
  TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.phase_a_ttl_sweep()
  TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.rls_auto_enable()
  TO postgres, service_role;

-- This ordinary trigger function is not SECURITY DEFINER, but a fixed search
-- path removes name-resolution ambiguity and clears the database-linter
-- warning without changing its behavior.
ALTER FUNCTION public.touch_updated_at()
  SET search_path = pg_catalog, public;
REVOKE ALL ON FUNCTION public.touch_updated_at()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.touch_updated_at()
  TO postgres, service_role;
