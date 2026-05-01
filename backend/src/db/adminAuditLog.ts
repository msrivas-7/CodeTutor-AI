// Phase 20-P5: append-only admin action log.
//
// Every admin route mutation (and EVERY rejected attempt — bounds
// violation, missing confirm phrase, rate limit etc.) lands here so the
// admin dashboard can render a tail-of-recent-actions section. The
// stdout JSON line is the secondary trail for log-aggregator queries
// (Phase 20-P3 introduced `requestLogger`; we use the same shape here).

import type { JSONValue } from "postgres";
import { db } from "./client.js";

export type AuditEventType =
  | "user_override_set"
  | "user_override_cleared"
  | "system_config_set"
  | "system_config_cleared"
  | "denylist_added"
  | "denylist_removed"
  | "tab_opened"
  | "rejected_attempt"
  // Phase 25 additions — must stay in sync with the CHECK constraint
  // in supabase/migrations/20260430080100_audit_event_types.sql.
  | "session_terminated"
  | "session_terminated_bulk"
  | "user_frozen"
  | "user_unfrozen"
  | "budget_watcher_reset"
  | "platform_auth_unstick"
  // Phase 26 additions — must stay in sync with the CHECK constraint
  // in supabase/migrations/20260430080300_audit_force_signout_event.sql.
  | "user_force_signout";

export interface AdminAuditLogRow {
  id: string;
  actorId: string;
  eventType: AuditEventType;
  targetUserId: string | null;
  targetKey: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
  createdAt: string;
}

export interface LogAdminActionArgs {
  actorId: string;
  eventType: AuditEventType;
  targetUserId?: string | null;
  targetKey?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
}

export async function logAdminAction(args: LogAdminActionArgs): Promise<void> {
  const sql = db();
  try {
    await sql`
      INSERT INTO public.admin_audit_log (
        actor_id, event_type, target_user_id, target_key, before, after, reason
      ) VALUES (
        ${args.actorId},
        ${args.eventType},
        ${args.targetUserId ?? null},
        ${args.targetKey ?? null},
        ${sql.json((args.before ?? null) as JSONValue)},
        ${sql.json((args.after ?? null) as JSONValue)},
        ${args.reason ?? null}
      )
    `;
  } catch (err) {
    // Audit log write must NEVER fail the calling admin route — the
    // operation itself succeeded; if we lost the audit row, that's a
    // monitoring concern. The structured stdout log below is the
    // backup trail.
    console.error(
      JSON.stringify({
        level: "error",
        eventType: "admin_audit_log_write_failed",
        actorId: args.actorId,
        action: args.eventType,
        err: (err as Error).message,
      }),
    );
  }
  // Always emit the stdout log too.
  console.info(
    JSON.stringify({
      level: "info",
      eventType: "admin_action",
      actorId: args.actorId,
      action: args.eventType,
      targetUserId: args.targetUserId ?? null,
      targetKey: args.targetKey ?? null,
      reason: args.reason ?? null,
    }),
  );
}

interface ListOpts {
  limit?: number;
  cursor?: string | null; // ISO timestamp; rows older than this are returned
  // Phase 25: optional event_type filter for the redesigned audit-log
  // section. Validated at the route layer; here we just splice it in.
  eventType?: string | null;
}

export async function listAdminAuditLog(
  opts: ListOpts = {},
): Promise<{ entries: AdminAuditLogRow[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const sql = db();
  const cursorClause = opts.cursor
    ? sql`AND created_at < ${opts.cursor}`
    : sql``;
  const eventTypeClause = opts.eventType
    ? sql`AND event_type = ${opts.eventType}`
    : sql``;
  const rows = await sql<
    Array<{
      id: string;
      actor_id: string;
      event_type: AuditEventType;
      target_user_id: string | null;
      target_key: string | null;
      before: unknown;
      after: unknown;
      reason: string | null;
      created_at: Date;
    }>
  >`
    SELECT id, actor_id, event_type, target_user_id, target_key,
           before, after, reason, created_at
      FROM public.admin_audit_log
     WHERE 1=1
       ${cursorClause}
       ${eventTypeClause}
     ORDER BY created_at DESC
     LIMIT ${limit + 1}
  `;
  const hasMore = rows.length > limit;
  const sliced = hasMore ? rows.slice(0, limit) : rows;
  const entries: AdminAuditLogRow[] = sliced.map((r) => ({
    id: r.id,
    actorId: r.actor_id,
    eventType: r.event_type,
    targetUserId: r.target_user_id,
    targetKey: r.target_key,
    before: r.before,
    after: r.after,
    reason: r.reason,
    createdAt: r.created_at.toISOString(),
  }));
  const nextCursor = hasMore && sliced.length > 0
    ? sliced[sliced.length - 1].created_at.toISOString()
    : null;
  return { entries, nextCursor };
}
