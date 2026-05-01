import { useCallback, useEffect, useState } from "react";
import {
  api,
  type AdminEmailLogEntry,
  type AdminEmailLogResponse,
} from "../../api/client";
import { Modal } from "../Modal";

// Phase 25: read-only viewer for email_sent_log. Cursor pagination, kind +
// email substring filters, click-row to inspect rendered body.

const PAGE_SIZE = 50;

export function EmailLogSection() {
  const [entries, setEntries] = useState<AdminEmailLogEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [kind, setKind] = useState("");
  const [emailQuery, setEmailQuery] = useState("");
  const [kinds, setKinds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState<AdminEmailLogEntry | null>(null);

  const load = useCallback(
    async (cursor: string | null) => {
      setLoading(true);
      setError(null);
      try {
        const res: AdminEmailLogResponse = await api.adminListEmailLog({
          cursor: cursor ?? undefined,
          limit: PAGE_SIZE,
          kind: kind || undefined,
          toEmailLike: emailQuery || undefined,
        });
        if (cursor === null) {
          setEntries(res.entries);
        } else {
          setEntries((prev) => [...prev, ...res.entries]);
        }
        setNextCursor(res.nextCursor);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [kind, emailQuery],
  );

  useEffect(() => {
    void load(null);
  }, [load]);

  useEffect(() => {
    void api
      .adminListEmailLogKinds()
      .then((r) => setKinds(r.kinds))
      .catch(() => {
        // soft-fail; the dropdown still works as a free-text input
      });
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">Email log</h2>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted">
            Outbound mail (streak nudge, budget alert, …). Click a row to view
            the rendered body. Read-only.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load(null)}
          className="rounded-md border border-border bg-elevated px-3 py-1 text-[11px] text-muted hover:text-ink"
        >
          Refresh
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="text-[11px]">
          <span className="text-muted">Kind: </span>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className="rounded-md border border-border bg-bg px-2 py-1 text-ink"
          >
            <option value="">All</option>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[11px]">
          <span className="text-muted">Email contains: </span>
          <input
            type="text"
            value={emailQuery}
            onChange={(e) => setEmailQuery(e.target.value)}
            className="rounded-md border border-border bg-bg px-2 py-1 text-ink"
            placeholder="user@example.com"
          />
        </label>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-[11px] text-danger"
        >
          {error}
        </div>
      )}

      {entries.length === 0 && !loading ? (
        <div className="rounded-md border border-border bg-elevated/30 px-3 py-6 text-center text-[11px] text-muted">
          No emails matched.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-left text-[11px]">
            <thead className="bg-elevated/50 text-[10px] uppercase tracking-wider text-muted">
              <tr>
                <th className="px-3 py-2 font-semibold">Sent</th>
                <th className="px-3 py-2 font-semibold">Kind</th>
                <th className="px-3 py-2 font-semibold">To</th>
                <th className="px-3 py-2 font-semibold">Subject</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr
                  key={e.id}
                  className="cursor-pointer border-t border-border hover:bg-accent/5"
                  onClick={() => setOpened(e)}
                >
                  <td className="whitespace-nowrap px-3 py-2 text-muted">
                    {new Date(e.sentAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-ink">{e.kind}</td>
                  <td className="px-3 py-2 text-muted">{e.toEmail}</td>
                  <td className="px-3 py-2 text-ink">{e.subject}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex justify-center">
        <button
          type="button"
          disabled={!nextCursor || loading}
          onClick={() => void load(nextCursor)}
          className="rounded-md border border-border bg-elevated px-3 py-1 text-[11px] text-muted hover:text-ink disabled:opacity-40"
        >
          {loading ? "Loading…" : nextCursor ? "Load more" : "End of log"}
        </button>
      </div>

      {opened && (
        <Modal onClose={() => setOpened(null)} role="dialog">
          <div className="max-w-2xl space-y-3 p-4">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-sm font-semibold text-ink">{opened.subject}</h3>
              <button
                type="button"
                onClick={() => setOpened(null)}
                className="text-[11px] text-muted hover:text-ink"
              >
                Close
              </button>
            </div>
            <div className="text-[11px] text-muted">
              Sent {new Date(opened.sentAt).toLocaleString()} to {opened.toEmail}
              {" · "}
              kind: {opened.kind}
              {opened.acsOpId && (
                <>
                  {" · "}ACS op: <span className="font-mono">{opened.acsOpId}</span>
                </>
              )}
            </div>
            <div>
              <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted">
                Text body
              </h4>
              <pre className="max-h-72 overflow-auto rounded-md border border-border bg-elevated/40 p-3 text-[11px] leading-relaxed text-ink whitespace-pre-wrap">
                {opened.textBody}
              </pre>
            </div>
            <details>
              <summary className="cursor-pointer text-[11px] text-muted hover:text-ink">
                HTML body (escaped)
              </summary>
              <pre className="mt-2 max-h-72 overflow-auto rounded-md border border-border bg-elevated/40 p-3 text-[10px] leading-relaxed text-muted whitespace-pre-wrap">
                {opened.htmlBody}
              </pre>
            </details>
          </div>
        </Modal>
      )}
    </div>
  );
}
