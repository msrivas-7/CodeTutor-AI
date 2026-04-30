-- Phase 23 P1 #3: index `user_streak.last_active_date` for the digest
-- sweeper's eligibility query.
--
-- Today the digestSweeper's SELECT does:
--   SELECT … FROM user_streak s JOIN user_preferences p …
--    WHERE s.current_streak >= 1
--      AND s.last_active_date = (CURRENT_DATE - INTERVAL '1 day')::date
--      AND p.email_opt_in = TRUE
--      AND (p.last_streak_email_sent_at IS NULL
--           OR p.last_streak_email_sent_at < CURRENT_DATE)
--
-- Without an index on `user_streak.last_active_date`, this falls back to
-- a Seq Scan on user_streak. At 16 users it's irrelevant; at 1k+ users
-- the daily sweep would scan the whole table once per fire — fine
-- functionally but wasteful + slow as the user base grows.
--
-- Partial index: only the rows where current_streak >= 1. The sweeper
-- never reads rows with current_streak = 0 (those users have no streak
-- to nudge), so the partial index stays tiny + skips the dead-streak
-- noise that accumulates over time as users disengage.
--
-- No CONCURRENTLY: at our row count the index build finishes in
-- milliseconds. CONCURRENTLY would let us avoid the brief table lock
-- but Supabase's `db push` runs migrations in transactions by default,
-- which conflicts with CONCURRENTLY. Revisit when user_streak hits
-- >100k rows or if we move to direct-DB migrations.

CREATE INDEX IF NOT EXISTS idx_user_streak_last_active_date
  ON public.user_streak (last_active_date)
  WHERE current_streak >= 1;
