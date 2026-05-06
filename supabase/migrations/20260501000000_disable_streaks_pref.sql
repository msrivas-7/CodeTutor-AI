-- Phase 27: per-user opt-out for the streak system.
--
-- Adds `disable_streaks` to user_preferences. Defaults FALSE so existing
-- users keep their current behaviour (streak chip in toolbar, streak
-- nudge email at 18:00 UTC, lesson-complete celebration). When TRUE:
--   * StreakChip renders nothing
--   * LessonCompletePanel skips the streak section
--   * Streak nudge email is suppressed (digestSweeper filters this out)
--   * SharePage hides the streak count
-- The streak data itself is preserved on user_streak — only display +
-- email send are gated. Toggling back to FALSE picks up where left off.
--
-- Why opt-out and not opt-in:
--   The default audience (Maya — first-time learner, motivated by
--   reinforcement) benefits from streak signal. The opt-out audience
--   (Alex — career-changer, allergic to streak-pressure from prior
--   apps) is the minority but losing them at activation is more
--   expensive than the slightly-larger default streak surface. So:
--   on by default, off by user choice. Discoverable in Settings →
--   Account.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS so a re-apply is a no-op.

ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS disable_streaks boolean NOT NULL DEFAULT FALSE;
