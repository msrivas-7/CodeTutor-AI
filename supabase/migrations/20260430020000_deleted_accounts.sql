-- Phase 23 P1 #6: account-deletion audit trail.
--
-- Today, when a user clicks Delete account, we tear down their auth.users
-- row + cascading public.* rows and that's the end of the audit trail —
-- the user is gone, the rows are gone, and any attempt to ask "did
-- jane@example.com really initiate the delete or did her session get
-- stolen?" comes up empty.
--
-- This table preserves a minimal forensic record:
--   - hashed user id (never the plaintext — hashUserId() with the same
--     deploy-wide HMAC the request logger uses, so support can correlate
--     a `userId` log line to an audit row without exposing a join key
--     for an attacker who somehow reads this table)
--   - email at deletion time (plaintext, since the email itself is the
--     thing the user typed to confirm and pairing it with deleted_at is
--     the support ticket key — "I deleted my account on Tuesday but
--     can't sign back in" needs the email to look up)
--   - reason ("self_service" today; reserved for future "operator_mod"
--     / "fraud_prevention" / etc.)
--   - deleted_at (timestamptz, server-set)
--
-- Written BEFORE auth.admin.deleteUser() in routes/userData.ts so even
-- if the cascade fails halfway we have proof of intent. NOT linked back
-- to auth.users via FK — the row must survive the user being gone.
--
-- Retention: keep forever (rows are tiny). Operator can manually purge
-- entries older than e.g. 1 year for GDPR right-to-be-forgotten if a
-- user requests it; the hashed userId means there's no plaintext PII
-- joinable back to the original auth.users.id once the row is gone.
--
-- RLS: deny-all. Backend writes via service-role; no client should
-- ever read this table.

CREATE TABLE public.deleted_accounts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id_hashed  text NOT NULL,
  email           text NOT NULL,
  reason          text NOT NULL DEFAULT 'self_service',
  deleted_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_deleted_accounts_email_deleted_at
  ON public.deleted_accounts (email, deleted_at DESC);

-- Operator support query: "show me deletions in the last 30 days":
-- SELECT email, reason, deleted_at FROM public.deleted_accounts
--   WHERE deleted_at > now() - interval '30 days' ORDER BY 3 DESC;

ALTER TABLE public.deleted_accounts ENABLE ROW LEVEL SECURITY;
-- No SELECT/INSERT/UPDATE/DELETE policies → only service-role reaches it.
