-- P-M7 (adversarial audit, bucket 4b): fold the "user has clicked the paid-
-- access CTA" presence signal onto public.user_preferences so /ai-status
-- can read BYOK state + paid-interest state in a single PK lookup.
--
-- The paid_access_interest table is kept as-is — it still holds the columns
-- the operator queries for lead triage (email, display_name, click_count,
-- last_clicked_at, denylisted_at_click). This column is a hot-path denorm,
-- not a replacement.

ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS paid_access_shown_at timestamptz NULL;

-- Backfill from the durable record. Any existing paid_access_interest row
-- implies the user has clicked at least once; seed user_preferences with
-- first_clicked_at so the /ai-status presence check returns identical
-- answers before and after this migration.
--
-- INSERT...ON CONFLICT handles the rare case where a user hit the CTA
-- (so paid_access_interest has a row) before we'd ever written a
-- user_preferences row (nothing else requires one to exist).
INSERT INTO public.user_preferences (user_id, paid_access_shown_at)
SELECT pai.user_id, pai.first_clicked_at
  FROM public.paid_access_interest pai
ON CONFLICT (user_id) DO UPDATE
  SET paid_access_shown_at = EXCLUDED.paid_access_shown_at
  WHERE public.user_preferences.paid_access_shown_at IS NULL;
