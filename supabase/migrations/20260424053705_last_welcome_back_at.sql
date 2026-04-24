-- First-run cinematic (Phase 1.6, welcome-back overlay): track the last
-- time the daily welcome-back overlay was shown to each user. Server-
-- backed (not localStorage) so one device's heartbeat suppresses the
-- next device the same day — a learner who got welcomed on laptop at
-- 9 AM shouldn't be re-welcomed on phone at noon.
--
-- Nullable: existing users get NULL (no overlay shown yet), which the
-- trigger rule reads as "show on next eligible visit." New users get
-- NULL from the row's default. The welcome-back overlay itself writes
-- via upsertPreferences when it dismisses.

ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS last_welcome_back_at timestamptz NULL;
