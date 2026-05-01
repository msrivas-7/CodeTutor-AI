-- Phase 26 (audit C-3 fix-up): user_streak RLS gap.
--
-- The original 20260428000000_user_streak.sql migration added only a
-- `FOR SELECT` policy because the design assumed all writes would come
-- from the backend's service-role connection (which bypasses RLS).
-- Phase 26 routes user_streak writes through `withRlsContext` so RLS
-- is the second line of defense — but with no INSERT/UPDATE/DELETE
-- policy on the authenticated role, those writes are rejected with
-- "new row violates row-level security policy".
--
-- Add a full-write policy mirroring user_preferences_own. The
-- existing user_streak_self_read SELECT policy stays in place; the
-- new policy adds INSERT/UPDATE/DELETE under the same user_id =
-- auth.uid() predicate. Cron-context writes from
-- digestSweeper/markStreakNudgeSent still use the service-role pool
-- (via db()) which bypasses RLS entirely.
--
-- Idempotent: DROP+CREATE the named policies so re-applying this
-- migration on a partially-applied DB is safe.

DROP POLICY IF EXISTS user_streak_self_write ON public.user_streak;
CREATE POLICY user_streak_self_write ON public.user_streak
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
