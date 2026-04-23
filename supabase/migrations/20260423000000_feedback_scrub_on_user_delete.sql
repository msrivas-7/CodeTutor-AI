-- Audit P-7: when a learner deletes their account, auth.users CASCADE fires
-- `ON DELETE SET NULL` on public.feedback.user_id (defined in 20260421010000_
-- feedback.sql). That keeps the row visible to admin triage but leaves the
-- free-text `body` + opt-in `diagnostics` jsonb intact — both can hold PII
-- the learner typed ("my email is ..." in body, page-route + userAgent in
-- diagnostics). The intent was "row survives, identity collapses"; the
-- practical outcome was "row survives WITH identity-bearing fields".
--
-- This trigger fires BEFORE UPDATE on the SET-NULL transition and blanks
-- the three identity-bearing columns. We replace `body` with a visible
-- sentinel so an admin reviewing the table can tell a ghost row apart from
-- a 1-char submission — and because the existing feedback_body_or_mood
-- CHECK requires a non-empty body when `mood` is NULL, which is the
-- majority of classic modal submissions.
--
-- Preserved on ghost rows:
--   category     (enum, not PII)
--   mood         (enum, not PII — still useful for aggregate analytics)
--   created_at   (the whole point of keeping the row)
--
-- Cleared on ghost rows:
--   body         -> '[scrubbed on account deletion]'
--   diagnostics  -> '{}'::jsonb
--   lesson_id    -> NULL

CREATE OR REPLACE FUNCTION public.feedback_scrub_on_user_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.user_id IS NOT NULL AND NEW.user_id IS NULL THEN
    NEW.body        := '[scrubbed on account deletion]';
    NEW.diagnostics := '{}'::jsonb;
    NEW.lesson_id   := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER feedback_scrub_on_user_delete
BEFORE UPDATE OF user_id ON public.feedback
FOR EACH ROW
EXECUTE FUNCTION public.feedback_scrub_on_user_delete();
