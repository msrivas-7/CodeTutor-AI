-- Phase 20-P1: user feedback channel. Until now there's been no way for
-- learners to tell us about bugs / ideas / confusion — the only signal was
-- sparse inbound email. A persistent "Feedback" button in the app writes
-- here so we can triage against a real table instead of a zero baseline.
--
-- Triage is via the Supabase dashboard with the service role for now; a
-- dedicated admin view can come later.
--
-- Payload shape:
--   body        — free-text from the learner (required, <=4000 chars)
--   category    — bug | idea | other
--   diagnostics — OPT-IN non-PII context the client may attach (route path,
--                 viewport, theme, lesson id, editor lang, app git-sha, UA).
--                 The client modal describes exactly what gets included; we
--                 accept a loose jsonb here because the shape may evolve,
--                 but the column is 8 KB-capped to stop a malicious client
--                 from storing runaway blobs. NEVER stores: learner code,
--                 the OpenAI key, email, IP, auth tokens.

-- user_id is NULLable with ON DELETE SET NULL: we deliberately want
-- feedback rows to survive a learner deleting their account. Once the user
-- is gone the row becomes a "ghost" (still visible to admins via service
-- role, invisible to any authenticated session because RLS uses
-- auth.uid() = user_id). The submitter's identity has already been
-- collapsed into the FK nullification — no PII remains on the row.
CREATE TABLE public.feedback (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  body        text        NOT NULL,
  category    text        NOT NULL DEFAULT 'other',
  diagnostics jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT feedback_body_len      CHECK (char_length(body) BETWEEN 1 AND 4000),
  CONSTRAINT feedback_category_val  CHECK (category IN ('bug','idea','other')),
  CONSTRAINT feedback_diag_size     CHECK (octet_length(diagnostics::text) <= 8192)
);

CREATE INDEX idx_feedback_user_created ON public.feedback (user_id, created_at DESC);
CREATE INDEX idx_feedback_created      ON public.feedback (created_at DESC);

ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;

-- Learners can only SELECT + INSERT their own rows. UPDATE / DELETE are
-- closed from the client — once submitted, the row is immutable to the user;
-- only admin service role can touch it. This is deliberate: a hostile client
-- shouldn't be able to retroactively blank or repurpose their own feedback
-- rows to confuse triage.
CREATE POLICY feedback_own_select ON public.feedback
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- INSERT requires user_id = auth.uid(). NULL is explicitly rejected here so
-- a malicious client can't submit orphan rows that bypass the ownership
-- predicate. Nullification only happens via ON DELETE SET NULL after the
-- account is gone; direct INSERTs with NULL are always rejected.
CREATE POLICY feedback_own_insert ON public.feedback
  FOR INSERT TO authenticated
  WITH CHECK (user_id IS NOT NULL AND auth.uid() = user_id);
