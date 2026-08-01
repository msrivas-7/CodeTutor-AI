// Phase 25: read-side helpers for the email_sent_log table. The write
// side already exists in services/email/sentLog.ts; this file only
// adds the cursor-paginated list query used by GET /api/admin/email-log.

import { db } from "./client.js";

export interface EmailLogEntry {
  id: string;
  userId: string;
  kind: string;
  toEmail: string;
  subject: string;
  textBody: string;
  htmlBody: string;
  acsOpId: string | null;
  sentAt: string; // ISO
  capabilitiesRedacted: true;
}

const UNSUBSCRIBE_CAPABILITY = /(?:https?:\/\/|\/)[^\s"'<>]*unsubscribe[^\s"'<>]*/gi;

export function redactEmailCapabilities(body: string): string {
  return body.replace(UNSUBSCRIBE_CAPABILITY, "[unsubscribe link redacted]");
}

interface ListOpts {
  limit?: number;
  cursor?: string | null; // ISO timestamp; rows strictly older than this
  kind?: string | null;
  toEmailLike?: string | null; // substring match on to_email
}

export async function listEmailLog(
  opts: ListOpts = {},
): Promise<{ entries: EmailLogEntry[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const sql = db();

  // Build the predicate compositionally so absent filters don't push
  // false-positive WHERE clauses through. postgres-js fragment composition
  // keeps the query parameterized.
  const cursorClause = opts.cursor
    ? sql`AND sent_at < ${opts.cursor}`
    : sql``;
  const kindClause = opts.kind ? sql`AND kind = ${opts.kind}` : sql``;
  const emailClause = opts.toEmailLike
    ? sql`AND to_email ILIKE ${"%" + opts.toEmailLike + "%"}`
    : sql``;

  const rows = await sql<
    Array<{
      id: string;
      user_id: string;
      kind: string;
      to_email: string;
      subject: string;
      text_body: string;
      html_body: string;
      acs_op_id: string | null;
      sent_at: Date;
    }>
  >`
    SELECT id, user_id, kind, to_email, subject, text_body, html_body, acs_op_id, sent_at
      FROM public.email_sent_log
     WHERE 1=1
       ${cursorClause}
       ${kindClause}
       ${emailClause}
     ORDER BY sent_at DESC
     LIMIT ${limit + 1}
  `;

  const hasMore = rows.length > limit;
  const sliced = hasMore ? rows.slice(0, limit) : rows;
  const entries: EmailLogEntry[] = sliced.map((r) => ({
    id: r.id,
    userId: r.user_id,
    kind: r.kind,
    toEmail: r.to_email,
    subject: r.subject,
    textBody: redactEmailCapabilities(r.text_body),
    htmlBody: redactEmailCapabilities(r.html_body),
    acsOpId: r.acs_op_id,
    sentAt: r.sent_at.toISOString(),
    capabilitiesRedacted: true,
  }));
  const nextCursor =
    hasMore && sliced.length > 0
      ? sliced[sliced.length - 1].sent_at.toISOString()
      : null;
  return { entries, nextCursor };
}

// Returns the distinct `kind` values currently present in the table —
// the admin UI uses this to populate the kind filter dropdown without
// hardcoding the list. Cheap because the table has an index on kind.
export async function listEmailLogKinds(): Promise<string[]> {
  const sql = db();
  const rows = await sql<Array<{ kind: string }>>`
    SELECT DISTINCT kind FROM public.email_sent_log ORDER BY kind ASC
  `;
  return rows.map((r) => r.kind);
}
