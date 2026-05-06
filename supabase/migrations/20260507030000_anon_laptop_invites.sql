-- Phase A — A2 (device contract): magic-link invites for phone→laptop graduation.
--
-- After a phone learner finishes lesson 1, the graduation handoff dialog
-- offers "Send myself the link" → email with a magic link. Opening the
-- link on a laptop lands on /start?invite=<token>, which pre-fills the
-- signup form's email and re-stashes the lesson-1 code so the learner
-- continues from where they left off.
--
-- Privacy: NEVER store the raw email. Hash it with the same shape as
-- ip_hash (sha256 + static label). The token in the URL is the index;
-- email_hash is double-defense (an attacker who steals tokens can't
-- enumerate emails). Trade-off: the email is unrecoverable from the
-- DB if the user loses the email — fine, magic-link replaces recovery.
--
-- Lifecycle: 24h expiry, single-use (redeemed_at flips on first open).
-- Rate-limited: 3 sends per IP per 24h, 1 send per email_hash per 24h
-- (enforced server-side).
--
-- RLS deny-all-by-default — service-role pool writes only. The public
-- redemption path looks up by token via the backend, never directly
-- from the anon client.

CREATE TABLE IF NOT EXISTS public.anon_laptop_invites (
  id           uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 12-char lowercase base32 (Crockford-style alphabet a-z + 2-9 to
  -- avoid 0/1/o/i ambiguity in a copy-paste-from-an-email link). Stricter
  -- DB-side shape than `shared_lesson_completions.share_token`, which is
  -- application-validated only — magic links grant lesson-1 code carry-
  -- over and warrant the extra DB belt. Collision-retry inside the
  -- INSERT path absorbs the rare clash.
  token        text          UNIQUE NOT NULL,
  -- Hashed email. NEVER store the raw email here.
  email_hash   text          NOT NULL,
  ip_hash      text          NOT NULL,
  -- The lesson-1 code Maya typed. Capped at 4KB (same as the
  -- share-card snippet limit).
  code         text          NOT NULL,
  -- Maya's typed name (parsed from `name = "..."` in the code).
  -- Optional — if she didn't type one, the redemption page just
  -- skips the personalized greeting.
  name         text,
  created_at   timestamptz   NOT NULL DEFAULT now(),
  expires_at   timestamptz   NOT NULL,
  -- Single-use: NULL until first redemption, then a timestamp.
  redeemed_at  timestamptz,

  CONSTRAINT anon_laptop_invites_token_shape
    CHECK (token ~ '^[a-z2-9]{12}$'),
  CONSTRAINT anon_laptop_invites_email_hash_shape
    CHECK (length(email_hash) BETWEEN 16 AND 128),
  CONSTRAINT anon_laptop_invites_ip_hash_shape
    CHECK (length(ip_hash) BETWEEN 16 AND 128),
  CONSTRAINT anon_laptop_invites_code_size
    CHECK (octet_length(code) <= 4096),
  CONSTRAINT anon_laptop_invites_name_size
    CHECK (name IS NULL OR length(name) <= 80),
  -- Expiry must be in the future at insert time. Sanity bound at 7d
  -- so a misconfig can't hand out year-long links.
  CONSTRAINT anon_laptop_invites_expires_in_future
    CHECK (expires_at > created_at AND expires_at <= created_at + interval '7 days')
);

-- Per-IP rate-limit lookup (count rows for this ip_hash in the last 24h).
CREATE INDEX IF NOT EXISTS idx_anon_laptop_invites_ip_recent
  ON public.anon_laptop_invites (ip_hash, created_at DESC);

-- Per-email rate-limit lookup (count rows for this email_hash in the last 24h).
CREATE INDEX IF NOT EXISTS idx_anon_laptop_invites_email_recent
  ON public.anon_laptop_invites (email_hash, created_at DESC);

-- TTL sweep helper (any row where now() > expires_at + 24h is safe to delete).
CREATE INDEX IF NOT EXISTS idx_anon_laptop_invites_expires
  ON public.anon_laptop_invites (expires_at);

ALTER TABLE public.anon_laptop_invites ENABLE ROW LEVEL SECURITY;
