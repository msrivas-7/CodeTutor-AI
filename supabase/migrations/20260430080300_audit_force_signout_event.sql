-- Phase 26 zero-trust hardening (audit H-1 / SRE F3.2): extend
-- admin_audit_log.event_type CHECK with `user_force_signout`.
--
-- The new force-signout admin action revokes every refresh token a user
-- holds, forcing them to re-authenticate. This is the response action
-- after demoting a compromised admin (or after any incident where the
-- operator wants to invalidate a user's existing JWT before the 1-hour
-- refresh window expires). Audit-trail support is required so the
-- operator can later answer "who did I sign out, when, and why".
--
-- Idempotent re-apply: drops the old constraint by name and adds the
-- new one with the extended IN-list, mirroring the Phase 25 pattern.

ALTER TABLE public.admin_audit_log
  DROP CONSTRAINT IF EXISTS admin_audit_log_event_type_check;

ALTER TABLE public.admin_audit_log
  ADD CONSTRAINT admin_audit_log_event_type_check
  CHECK (event_type IN (
    'user_override_set',
    'user_override_cleared',
    'system_config_set',
    'system_config_cleared',
    'denylist_added',
    'denylist_removed',
    'tab_opened',
    'rejected_attempt',
    -- Phase 25 additions
    'session_terminated',
    'session_terminated_bulk',
    'user_frozen',
    'user_unfrozen',
    'budget_watcher_reset',
    'platform_auth_unstick',
    -- Phase 26 additions
    'user_force_signout'
  ));
