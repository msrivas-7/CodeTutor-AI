-- Phase 25: extend admin_audit_log.event_type CHECK constraint with the
-- new event types Phase 25 emits.
--
-- New event types:
--   session_terminated         — admin killed a single session
--   session_terminated_bulk    — admin killed all sessions for a user
--   user_frozen                — admin set frozen=true on denylist row
--   user_unfrozen              — admin cleared frozen=true
--   budget_watcher_reset       — admin reset today's budget-watcher dedup
--   platform_auth_unstick      — admin cleared platform-auth kill flag
--
-- Postgres requires DROP + ADD to amend a CHECK constraint; the alternative
-- (`ALTER ... DROP CONSTRAINT IF EXISTS`) is what we use so re-running this
-- migration on a partially-applied DB is idempotent.

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
    'platform_auth_unstick'
  ));
