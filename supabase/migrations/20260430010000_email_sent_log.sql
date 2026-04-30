-- Phase 23 P1 #10: operator outbox.
--
-- ACS Email is API-only — it doesn't persist message bodies (privacy by
-- design) and `noreply@mail.codetutor.msrivas.com` isn't a real mailbox
-- with an IMAP-accessible "Sent" folder. To give the operator visibility
-- into what we actually shipped (without leaking a BCC line to every
-- recipient), capture the rendered email body server-side at send time.
--
-- Rows are written by `recordEmailSent(...)` in
-- backend/src/services/email/sentLog.ts, called from `sendStreakNudge`
-- (Phase 22D streak nudges) and intended to cover any future send paths
-- (budget alerts, password reset / verification if we ever bring those
-- in-house, billing email, etc.) via the same hook. Read via
--   `SELECT to_email, subject, sent_at FROM public.email_sent_log
--      ORDER BY sent_at DESC LIMIT 20;`
-- or via a thin admin-only HTTP route in a follow-up if needed.
--
-- Storage cost projection: ~30 KB per row × ~100 sends/day = 3 MB/day,
-- ~1 GB/year. Fine on Supabase free tier.
--
-- PII posture: recipient email is already in our DB (auth.users.email);
-- streak-nudge body is anodyne (firstName + streak-day count + a course
-- deep link); the unsubscribe URL contains an HMAC token that, if leaked,
-- only lets an attacker unsubscribe specific users (low impact). Future
-- send kinds with sensitive payloads (e.g. password-reset codes) should
-- redact-before-store at the call site, not here.
--
-- ON DELETE CASCADE follows auth.users — when a user deletes their
-- account, their email log goes with them. Pairs cleanly with the
-- account-deletion audit trail (Phase 23 P1 #6) which is intentionally
-- the OPPOSITE — that table preserves a row after the user is gone.

CREATE TABLE public.email_sent_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Discriminator for filter / analytics: 'streak_nudge', 'budget_alert',
  -- 'password_reset', etc. Free-form string; not enum-constrained because
  -- future send kinds shouldn't require a migration to start logging.
  kind         text NOT NULL,
  to_email     text NOT NULL,
  subject      text NOT NULL,
  text_body    text NOT NULL,
  html_body    text NOT NULL,
  -- ACS operationId for cross-referencing with Azure Monitor diagnostic
  -- logs (when those get enabled in a future phase). Nullable because
  -- some send paths might log before invoking ACS (e.g. dry-run dev
  -- pathway), or fail mid-call.
  acs_op_id    text,
  sent_at      timestamptz NOT NULL DEFAULT now()
);

-- Hot path: "what did we send to user X" + "what did we send today across
-- all users". Both queries hit (user_id, sent_at DESC) cleanly.
CREATE INDEX idx_email_sent_log_user_recent
  ON public.email_sent_log (user_id, sent_at DESC);

-- Secondary path: filter by kind for ops dashboards / debugging
-- ("show me the last 50 streak nudges").
CREATE INDEX idx_email_sent_log_kind_recent
  ON public.email_sent_log (kind, sent_at DESC);

-- Comment + RLS posture: not exposed to the SPA. Backend writes via
-- service-role key; no SELECT policy needed because no anon/auth client
-- ever queries it. Belt-and-suspenders RLS-deny:
ALTER TABLE public.email_sent_log ENABLE ROW LEVEL SECURITY;
-- No SELECT/INSERT/UPDATE policies → only service-role reaches it. The
-- backend connection uses the service role; SPA clients (anon + user JWT)
-- get nothing back even if they try to query directly.
