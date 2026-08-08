-- Q1 UX-125: the streak chip and history grid previously used different
-- evidence. user_streak cached the qualifying-action count, while the grid
-- reconstructed dates from lesson_progress.updated_at (which is neither
-- complete nor limited to qualifying actions). Keep one durable UTC-day
-- ledger for both active and grace days; user_streak remains a cached summary.

CREATE TABLE public.user_streak_days (
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  streak_date  date NOT NULL,
  day_kind     text NOT NULL,
  recorded_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, streak_date),
  CONSTRAINT user_streak_days_kind_check
    CHECK (day_kind IN ('active', 'grace'))
);

ALTER TABLE public.user_streak_days ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_streak_days_self_read
  ON public.user_streak_days
  FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

-- Streak evidence is classified by backend qualifying-action handlers. The
-- exposed browser roles may inspect only their own rows; they cannot forge a
-- day or rewrite the cached summary through PostgREST.
REVOKE ALL PRIVILEGES ON TABLE public.user_streak_days
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.user_streak_days TO authenticated;

DROP POLICY IF EXISTS user_streak_self_write ON public.user_streak;
REVOKE ALL PRIVILEGES ON TABLE public.user_streak
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.user_streak TO authenticated;

-- Backfill only dates the existing database can prove. A completed lesson is
-- a qualifying action, as is user_streak.last_active_date. We deliberately do
-- not manufacture the missing days implied by a cached current_streak value.
INSERT INTO public.user_streak_days (user_id, streak_date, day_kind, recorded_at)
SELECT
  user_id,
  (completed_at AT TIME ZONE 'UTC')::date,
  'active',
  MIN(completed_at)
FROM public.lesson_progress
WHERE status = 'completed'
  AND completed_at IS NOT NULL
GROUP BY user_id, (completed_at AT TIME ZONE 'UTC')::date
ON CONFLICT (user_id, streak_date) DO UPDATE
SET day_kind = 'active';

INSERT INTO public.user_streak_days (user_id, streak_date, day_kind)
SELECT user_id, last_active_date, 'active'
FROM public.user_streak
WHERE last_active_date IS NOT NULL
ON CONFLICT (user_id, streak_date) DO UPDATE
SET day_kind = 'active';

-- last_freeze_used is also proven state. If an active date and historical
-- grace date collide, active wins because actual learning occurred that day.
INSERT INTO public.user_streak_days (user_id, streak_date, day_kind)
SELECT user_id, last_freeze_used, 'grace'
FROM public.user_streak
WHERE last_freeze_used IS NOT NULL
ON CONFLICT (user_id, streak_date) DO NOTHING;

COMMENT ON TABLE public.user_streak_days IS
  'Backend-owned UTC streak-day ledger. Active and grace rows are the shared source for streak summary and history.';
COMMENT ON TABLE public.user_streak IS
  'Backend-owned cached streak summary derived from public.user_streak_days.';
