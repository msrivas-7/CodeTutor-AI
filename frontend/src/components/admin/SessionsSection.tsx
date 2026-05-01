import { useCallback, useState } from "react";
import {
  api,
  type AdminSession,
  type AdminSessionsResponse,
} from "../../api/client";
import { useLivePolling } from "../../auth/useLivePolling";

const POLL_MS = 5000;
const PHRASE_KILL_SESSION =
  "I understand killing this session loses unsaved code";

// Phase 25: live session list with admin termination controls. Per-session
// "Kill" opens a phrase-confirm drawer; bulk "Kill all for user" lives
// at the top of the section.

export function SessionsSection() {
  const fetcher = useCallback(() => api.adminListSessions(), []);
  const { data, error, refresh } = useLivePolling<AdminSessionsResponse>(
    fetcher,
    POLL_MS,
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);

  const sessions = data?.sessions ?? [];
  const selectedSession = sessions.find((s) => s.sessionId === selected) ?? null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">Active sessions</h2>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted">
            {data ? `${data.total} runner${data.total === 1 ? "" : "s"} live` : "Loading…"}
            {" · "}auto-refreshes every 5 s
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setBulkOpen(true)}
            className="rounded-md border border-danger/40 bg-danger/10 px-3 py-1 text-[11px] font-semibold text-danger hover:bg-danger/15"
          >
            Kill all for user…
          </button>
          <button
            type="button"
            onClick={() => void refresh()}
            className="rounded-md border border-border bg-elevated px-3 py-1 text-[11px] text-muted hover:text-ink"
          >
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-[11px] text-danger"
        >
          Failed to refresh: {error}
        </div>
      )}

      {sessions.length === 0 && data ? (
        <div className="rounded-md border border-border bg-elevated/30 px-3 py-6 text-center text-[11px] text-muted">
          No active sessions.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-left text-[11px]">
            <thead className="bg-elevated/50 text-[10px] uppercase tracking-wider text-muted">
              <tr>
                <th className="px-3 py-2 font-semibold">Session</th>
                <th className="px-3 py-2 font-semibold">Email</th>
                <th className="px-3 py-2 font-semibold">Backend</th>
                <th className="px-3 py-2 font-semibold">Age</th>
                <th className="px-3 py-2 font-semibold">Last seen</th>
                <th className="px-3 py-2 font-semibold">Model</th>
                <th className="px-3 py-2 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => {
                const isSelected = selected === s.sessionId;
                return (
                  <tr
                    key={s.sessionId}
                    className={`border-t border-border ${isSelected ? "bg-accent/5" : ""}`}
                  >
                    <td className="px-3 py-2 font-mono text-ink">
                      {s.sessionId.slice(0, 10)}…
                    </td>
                    <td className="px-3 py-2 text-muted">{s.userEmail ?? "—"}</td>
                    <td className="px-3 py-2">
                      <BackendPill backend={s.backend} />
                    </td>
                    <td className="px-3 py-2 text-muted">{fmtMs(s.ageMs)}</td>
                    <td className="px-3 py-2 text-muted">{fmtMs(s.lastSeenMs)} ago</td>
                    <td className="px-3 py-2 text-muted">{s.selectedModel ?? "—"}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() =>
                          setSelected(isSelected ? null : s.sessionId)
                        }
                        className="rounded-md border border-border bg-elevated px-2 py-0.5 text-[10px] text-muted hover:text-ink"
                      >
                        {isSelected ? "Hide" : "Manage"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {selectedSession && (
        <KillSessionDrawer
          session={selectedSession}
          onDone={() => {
            setSelected(null);
            void refresh();
          }}
          onCancel={() => setSelected(null)}
        />
      )}

      {bulkOpen && (
        <BulkKillDrawer
          onDone={() => {
            setBulkOpen(false);
            void refresh();
          }}
          onCancel={() => setBulkOpen(false)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

function BackendPill({ backend }: { backend: "local" | "aci" }) {
  const className =
    backend === "aci"
      ? "border-warn/40 bg-warn/10 text-warn"
      : "border-success/40 bg-success/10 text-success";
  return (
    <span
      className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-semibold ${className}`}
    >
      {backend}
    </span>
  );
}

function KillSessionDrawer({
  session,
  onDone,
  onCancel,
}: {
  session: AdminSession;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState("");
  const [phrase, setPhrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ready = reason.trim().length >= 4 && phrase === PHRASE_KILL_SESSION;

  return (
    <div className="rounded-md border border-danger/40 bg-danger/5 p-3">
      <div className="flex items-baseline justify-between">
        <h3 className="text-[12px] font-semibold text-ink">
          Kill session{" "}
          <span className="font-mono text-danger">{session.sessionId}</span>?
        </h3>
        <button
          type="button"
          onClick={onCancel}
          className="text-[11px] text-muted hover:text-ink"
        >
          Cancel
        </button>
      </div>
      <p className="mt-1 text-[11px] text-muted">
        The container is destroyed immediately. Any unsaved code in the
        learner's editor is lost. The frontend will rebind to a fresh
        session on next ping.
      </p>
      <div className="mt-3 flex flex-col gap-2">
        <label className="text-[11px]">
          <div className="text-muted">Reason (≥ 4 chars)</div>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="mt-0.5 w-full rounded-md border border-border bg-bg px-2 py-1 text-ink"
            placeholder="e.g. learner reported stuck container"
          />
        </label>
        <label className="text-[11px]">
          <div className="text-muted">
            Type the phrase exactly to confirm:{" "}
            <span className="font-mono text-danger">{PHRASE_KILL_SESSION}</span>
          </div>
          <input
            type="text"
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            className={`mt-0.5 w-full rounded-md border bg-bg px-2 py-1 ${phrase === PHRASE_KILL_SESSION ? "border-success/40 text-success" : "border-border text-ink"}`}
          />
        </label>
        {err && <div className="text-[11px] text-danger">{err}</div>}
        <div className="flex gap-2">
          <button
            type="button"
            disabled={!ready || busy}
            onClick={async () => {
              setBusy(true);
              setErr(null);
              try {
                await api.adminKillSession(session.sessionId, {
                  reason,
                  confirmKill: phrase,
                });
                onDone();
              } catch (e) {
                setErr(e instanceof Error ? e.message : String(e));
              } finally {
                setBusy(false);
              }
            }}
            className="rounded-md bg-danger px-3 py-1 text-[11px] font-semibold text-bg disabled:opacity-50"
          >
            {busy ? "Killing…" : "Kill session"}
          </button>
        </div>
      </div>
    </div>
  );
}

function BulkKillDrawer({
  onDone,
  onCancel,
}: {
  onDone: () => void;
  onCancel: () => void;
}) {
  const [userId, setUserId] = useState("");
  const [reason, setReason] = useState("");
  const [phrase, setPhrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ready =
    userId.trim().length > 0 &&
    reason.trim().length >= 4 &&
    phrase === PHRASE_KILL_SESSION;

  return (
    <div className="rounded-md border border-danger/40 bg-danger/5 p-3">
      <div className="flex items-baseline justify-between">
        <h3 className="text-[12px] font-semibold text-ink">
          Kill all sessions for user
        </h3>
        <button
          type="button"
          onClick={onCancel}
          className="text-[11px] text-muted hover:text-ink"
        >
          Cancel
        </button>
      </div>
      <p className="mt-1 text-[11px] text-muted">
        Destroys every active session owned by this userId.
      </p>
      <div className="mt-3 flex flex-col gap-2">
        <label className="text-[11px]">
          <div className="text-muted">User ID (UUID, from Users page)</div>
          <input
            type="text"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            className="mt-0.5 w-full rounded-md border border-border bg-bg px-2 py-1 font-mono text-ink"
            placeholder="00000000-0000-0000-0000-000000000000"
          />
        </label>
        <label className="text-[11px]">
          <div className="text-muted">Reason (≥ 4 chars)</div>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="mt-0.5 w-full rounded-md border border-border bg-bg px-2 py-1 text-ink"
          />
        </label>
        <label className="text-[11px]">
          <div className="text-muted">
            Phrase: <span className="font-mono text-danger">{PHRASE_KILL_SESSION}</span>
          </div>
          <input
            type="text"
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            className={`mt-0.5 w-full rounded-md border bg-bg px-2 py-1 ${phrase === PHRASE_KILL_SESSION ? "border-success/40 text-success" : "border-border text-ink"}`}
          />
        </label>
        {err && <div className="text-[11px] text-danger">{err}</div>}
        <div className="flex gap-2">
          <button
            type="button"
            disabled={!ready || busy}
            onClick={async () => {
              setBusy(true);
              setErr(null);
              try {
                await api.adminKillSessionsByUser(userId, {
                  reason,
                  confirmKill: phrase,
                });
                onDone();
              } catch (e) {
                setErr(e instanceof Error ? e.message : String(e));
              } finally {
                setBusy(false);
              }
            }}
            className="rounded-md bg-danger px-3 py-1 text-[11px] font-semibold text-bg disabled:opacity-50"
          >
            {busy ? "Killing…" : "Kill all sessions"}
          </button>
        </div>
      </div>
    </div>
  );
}
