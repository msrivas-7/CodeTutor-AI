import { db } from "./client.js";

// Phase 23 P1 #10: operator outbox.
//
// ACS Email is API-only — there's no IMAP-accessible "Sent" folder for
// `noreply@mail.codetutor.msrivas.com`, and ACS doesn't persist message
// bodies (privacy by design). To give the operator visibility into what
// we actually shipped, capture the rendered email body server-side at
// send time. Recipient sees nothing different — no BCC line, no extra
// header. See migration 20260430010000_email_sent_log.sql for the
// storage shape + PII posture.
//
// Keep this layer thin: pure inserts, no business logic. Callers
// (sendStreakNudge, future budget-alert sender, etc.) decide what
// `kind` discriminator to use and what gets logged.

export type EmailKind =
  | "streak_nudge"
  | "budget_alert"
  // Reserved for future paths if/when those move in-house. Free-form
  // string column on the DB side, so adding a kind here doesn't require
  // a migration.
  | "password_reset"
  | "email_verification"
  | (string & {});

export interface InsertEmailSentLogArgs {
  userId: string;
  kind: EmailKind;
  toEmail: string;
  subject: string;
  textBody: string;
  htmlBody: string;
  /** ACS operationId returned from `sendEmail`. Optional — some send
   *  paths log before invoking ACS or fail mid-call. */
  acsOpId?: string | null;
}

export async function insertEmailSentLog(
  args: InsertEmailSentLogArgs,
): Promise<void> {
  const sql = db();
  await sql`
    INSERT INTO public.email_sent_log (
      user_id, kind, to_email, subject, text_body, html_body, acs_op_id
    )
    VALUES (
      ${args.userId},
      ${args.kind},
      ${args.toEmail},
      ${args.subject},
      ${args.textBody},
      ${args.htmlBody},
      ${args.acsOpId ?? null}
    )
  `;
}
