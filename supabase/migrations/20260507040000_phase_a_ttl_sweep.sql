-- Phase A — A3 + A2: TTL sweep for the new anon surfaces.
--
-- Two tables are growing without bound today:
--   1. shared_lesson_completions (anon rows where user_id IS NULL).
--      A3 anon-share unlock created these. Anon shares are not
--      account-owned, so the storage cost has no upper bound from
--      the per-user lifetime cap. 30-day TTL matches the comment
--      pre-positioned by 20260507020000_shared_completions_anon.sql.
--   2. anon_laptop_invites. A2 magic-link handoff. After expiry, the
--      row is dead weight. 24h post-expiry buffer so a redeemed-then-
--      refunded retry still resolves cleanly (defensive — there's no
--      such retry path today, but the buffer is essentially free).
--
-- Strategy mirrors phase27_ttl_sweep (20260505000000): SECURITY DEFINER
-- function, bounded delete (50k rows / call), idempotent. Operator
-- runs daily (manual or pg_cron). Forward-only — rolling back this
-- migration just leaves the function in place; harms nothing.
--
-- The function returns the count of rows deleted from each table so
-- the operator can correlate "I ran the sweep" with "this is what it
-- removed." Same shape as phase27_ttl_sweep's return.

CREATE OR REPLACE FUNCTION public.phase_a_ttl_sweep()
RETURNS TABLE (
  anon_shares_deleted bigint,
  anon_invites_deleted bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
-- Locked search_path — same pattern as phase27_ttl_sweep — so a
-- SECURITY DEFINER function can't be hijacked by a same-named
-- relation in a caller-controlled schema.
SET search_path = public, pg_temp
AS $$
DECLARE
  v_anon_shares_deleted bigint := 0;
  v_anon_invites_deleted bigint := 0;
BEGIN
  -- 30-day TTL on anon shares. The matching index
  -- (idx_shared_lesson_completions_anon_ttl) covers (created_at)
  -- WHERE user_id IS NULL AND revoked_at IS NULL — so the lookup is
  -- index-only. We DO delete revoked anon shares too: a revoked anon
  -- share has no owner who could un-revoke it, and the row is dead
  -- (the public GET 410s on revoked_at IS NOT NULL anyway).
  WITH old_anon AS (
    SELECT id
      FROM public.shared_lesson_completions
     WHERE user_id IS NULL
       AND created_at < now() - interval '30 days'
     LIMIT 50000
  )
  DELETE FROM public.shared_lesson_completions s
   USING old_anon o
   WHERE s.id = o.id;
  GET DIAGNOSTICS v_anon_shares_deleted = ROW_COUNT;

  -- 24h-post-expiry sweep on anon laptop invites. Any row whose
  -- expires_at is older than now() - 24h is safe to delete: it's
  -- past TTL, and the 24h buffer absorbs any clock skew between the
  -- backend and the DB. The matching index
  -- (idx_anon_laptop_invites_expires) makes the lookup index-only.
  WITH old_invites AS (
    SELECT id
      FROM public.anon_laptop_invites
     WHERE expires_at < now() - interval '24 hours'
     LIMIT 50000
  )
  DELETE FROM public.anon_laptop_invites i
   USING old_invites o
   WHERE i.id = o.id;
  GET DIAGNOSTICS v_anon_invites_deleted = ROW_COUNT;

  RETURN QUERY SELECT v_anon_shares_deleted, v_anon_invites_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.phase_a_ttl_sweep() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.phase_a_ttl_sweep() TO postgres, service_role;

COMMENT ON FUNCTION public.phase_a_ttl_sweep() IS
  'Phase A — A3+A2: deletes anon shared_lesson_completions older than 30 days and anon_laptop_invites past expiry+24h. Bounded at 50k rows per call. Operator runs daily (manual or pg_cron).';
