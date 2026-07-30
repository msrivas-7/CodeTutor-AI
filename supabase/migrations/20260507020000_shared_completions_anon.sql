-- Phase A — A3 (anon-share unlock): widen shared_lesson_completions for anon.
--
-- Today shared_lesson_completions.user_id is NOT NULL (Phase 21C built
-- it for authed-only sharing). Anon-share unlock (A3) needs the same
-- table to hold rows for `/try/...` learners who haven't signed up yet
-- — keyed by ip_hash instead of user_id. Single namespace = single
-- public-read path (`/s/:token`) regardless of authed-vs-anon source.
--
-- Why widen vs new table: the public render path is one query against
-- one table. Forking into two tables doubles read-path complexity AND
-- breaks the 12-char base32 single-namespace token. Existing RLS
-- (anon SELECT non-revoked rows by token) keeps working — it doesn't
-- inspect user_id.
--
-- Forward-compat for existing rows: every existing row has user_id
-- set (NOT NULL today), so the new owner_ck CHECK passes for all of
-- them. Nothing to backfill.

ALTER TABLE public.shared_lesson_completions
  ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE public.shared_lesson_completions
  ADD COLUMN IF NOT EXISTS ip_hash text;

-- Exactly one of (user_id, ip_hash) is set. user_id-row = authed share,
-- ip_hash-row = anon share. Both-NULL is an invalid state; both-set is
-- also invalid (anon-shares are never owned by an account in Phase A;
-- anon→authed stitching is deferred).
ALTER TABLE public.shared_lesson_completions
  ADD CONSTRAINT shared_lesson_completions_owner_ck
  CHECK (
    (user_id IS NOT NULL AND ip_hash IS NULL)
    OR
    (user_id IS NULL AND ip_hash IS NOT NULL)
  );

-- Privacy hash: same shape as the rest of the project's IP hashes.
ALTER TABLE public.shared_lesson_completions
  ADD CONSTRAINT shared_lesson_completions_ip_hash_shape
  CHECK (ip_hash IS NULL OR length(ip_hash) BETWEEN 16 AND 128);

-- Index for a future TTL sweep — anon shares (rows where user_id IS NULL)
-- expire after 30d. The sweep itself ships in a follow-up migration in
-- this phase; this index pre-positions the lookup path.
CREATE INDEX IF NOT EXISTS idx_shared_lesson_completions_anon_ttl
  ON public.shared_lesson_completions (created_at)
  WHERE user_id IS NULL AND revoked_at IS NULL;
