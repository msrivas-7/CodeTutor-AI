import { useEffect, useRef, useState } from "react";
import {
  api,
  type AdminDenylistRow,
  type AdminUserListEntry,
  type AdminUserOverride,
} from "../../api/client";
import { AdminLoadFailure } from "./AdminLoadFailure";
import { AdminEmptyState, AdminPageHeader } from "./AdminPrimitives";
import { useAdminDraft } from "./useAdminDraft";

// Phase 20-P5: paginated users table + per-user override editor.
//
// The table is read-only by default; clicking a row opens an inline
// drawer with current usage + the override form. Search filters by
// email substring (server-side).
//
// Bounds:
//   • dailyQuestionsCap: 0–10000
//   • dailyUsdCap: 0–100
//   • lifetimeUsdCap: 0–1000
// All three are nullable — null means "use project default for this cap".
//
// Phase 4.5 client safety guard #7: if a user sets dailyQuestionsCap=0,
// we show a soft warning suggesting ai_platform_denylist instead. We
// don't block the save (cap=0 IS valid; sometimes you want a soft
// throttle without committing to the denylist).

const PAGE_SIZE = 25;

export function UsersSection() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [users, setUsers] = useState<AdminUserListEntry[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const editOpenerRef = useRef<HTMLButtonElement | null>(null);

  const refresh = async (targetPage = page) => {
    setBusy(true);
    try {
      const r = await api.adminListUsers({
        page: targetPage,
        perPage: PAGE_SIZE,
        search: search.trim() || undefined,
      });
      setUsers(r.users);
      setHasMore(r.hasMore);
      setSelected((current) =>
        current && r.users.some((user) => user.id === current)
          ? current
          : null,
      );
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const onSearch = () => {
    if (page === 1) {
      void refresh(1);
      return;
    }
    // The page effect owns this request so a page-2 search cannot race a
    // second page-1 request and replace the correct results out of order.
    setPage(1);
  };

  const closeEditor = () => {
    const opener = editOpenerRef.current;
    setSelected(null);
    requestAnimationFrame(() => opener?.focus());
  };

  if (error && !users) {
    return (
      <AdminLoadFailure
        title="Users did not load"
        error={error}
        onRetry={() => void refresh(page)}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <AdminPageHeader
        eyebrow="Learner operations"
        title="Users"
        description="Find a learner, understand current AI usage, and manage scoped limits or access without changing project-wide policy."
      />
      <form
        className="admin-command-bar flex flex-col gap-2 sm:flex-row sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          onSearch();
        }}
      >
        <label className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-[11px] font-medium text-muted">
            Search users
          </span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Email address"
            className="min-h-11 w-full rounded-md border border-border bg-bg px-3 text-base text-ink outline-none transition placeholder:text-faint focus:border-accent/60 focus:ring-2 focus:ring-accent/30 sm:text-xs"
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="min-h-11 cursor-pointer rounded-md border border-border bg-elevated px-4 text-xs font-semibold text-ink transition-colors duration-200 hover:border-accent/60 hover:bg-accent/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-wait disabled:opacity-60 sm:self-end"
        >
          {busy ? "Searching…" : "Search"}
        </button>
      </form>

      {error && users && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger"
        >
          <span>Could not refresh users: {error}</span>
          <button
            type="button"
            onClick={() => void refresh(page)}
            className="min-h-11 cursor-pointer rounded-md border border-danger/40 bg-panel px-3 font-semibold transition-colors hover:bg-danger/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-danger"
          >
            Try again
          </button>
        </div>
      )}

      {!users && (
        <div role="status" className="text-xs text-muted">
          Loading users…
        </div>
      )}
      {users && users.length === 0 && (
        <div role="status">
          <AdminEmptyState
            title="No learners found"
            description="No account matches this email search. Check the spelling or clear the search to return to the full directory."
          />
        </div>
      )}

      {users && users.length > 0 && (
        <div className="admin-data-panel overflow-x-auto">
          <table className="w-full min-w-[700px] table-fixed text-left text-[11px]">
            <thead className="bg-elevated/50 text-[10px] uppercase tracking-wider text-muted">
              <tr>
                <th className="w-[46%] px-2 py-1">Email</th>
                <th className="w-[9%] px-2 py-1 text-right">Q today</th>
                <th className="w-[11%] px-2 py-1 text-right">$ today</th>
                <th className="w-[12%] px-2 py-1 text-right">$ lifetime</th>
                <th className="w-[11%] px-2 py-1">Flags</th>
                <th className="sticky right-0 z-10 w-[11%] border-l border-border bg-elevated px-2 py-1">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr
                  key={u.id}
                  className={`border-t border-border ${
                    selected === u.id ? "bg-accent/5" : ""
                  }`}
                >
                  <td
                    className="max-w-0 truncate whitespace-nowrap px-2 py-1.5 font-mono text-ink"
                    title={u.email ?? undefined}
                  >
                    {u.email ?? <span className="text-faint">(no email)</span>}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-ink">
                    {u.questionsToday}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-ink">
                    ${u.usdToday.toFixed(4)}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-ink">
                    ${u.usdLifetime.toFixed(4)}
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="flex flex-wrap gap-1">
                      {u.override && (
                        <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[9px] text-accent ring-1 ring-accent/30">
                          override
                        </span>
                      )}
                      {u.denylisted && (
                        <span className="rounded bg-warn/15 px-1.5 py-0.5 text-[9px] text-warn ring-1 ring-warn/30">
                          denylisted
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="sticky right-0 z-10 border-l border-border bg-bg px-2 py-1.5 text-right">
                    <button
                      type="button"
                      aria-expanded={selected === u.id}
                      aria-controls={`admin-user-${u.id}`}
                      onClick={(event) => {
                        if (selected !== u.id) {
                          editOpenerRef.current = event.currentTarget;
                        }
                        setSelected((id) => (id === u.id ? null : u.id));
                      }}
                      className="min-h-11 min-w-11 cursor-pointer rounded-md px-3 text-xs font-semibold text-accent transition-colors hover:bg-accent/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                    >
                      {selected === u.id ? "Close" : "Edit"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="text-[10px] text-faint">
          Page {page}
        </div>
        <div className="flex gap-1">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="min-h-11 cursor-pointer rounded-md border border-border bg-elevated px-3 text-xs font-medium text-muted transition-colors hover:border-accent/50 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            ← Prev
          </button>
          <button
            disabled={!hasMore}
            onClick={() => setPage((p) => p + 1)}
            className="min-h-11 cursor-pointer rounded-md border border-border bg-elevated px-3 text-xs font-medium text-muted transition-colors hover:border-accent/50 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            Next →
          </button>
        </div>
      </div>

      {selected && (
        <UserDrawer
          userId={selected}
          onClose={closeEditor}
          onSaved={async () => {
            await refresh();
          }}
        />
      )}
    </div>
  );
}

interface UserDrawerProps {
  userId: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}

function UserDrawer({ userId, onClose, onSaved }: UserDrawerProps) {
  const [override, setOverride] = useState<AdminUserOverride | null>(null);
  const [denylist, setDenylist] = useState<AdminDenylistRow | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const r = await api.adminGetUser(userId);
      setOverride(r.override);
      setDenylist(r.denylist);
      setLoaded(true);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  return (
    <div
      id={`admin-user-${userId}`}
      className="flex flex-col gap-3 rounded-md border border-accent/30 bg-accent/5 p-3"
    >
      <div className="flex items-center justify-between">
        <h4 className="text-[12px] font-semibold text-ink">
          User{" "}
          <span className="font-mono text-[11px]">{userId.slice(0, 8)}…</span>
        </h4>
        <button
          type="button"
          aria-label="Close user editor"
          onClick={onClose}
          className="min-h-11 cursor-pointer rounded-md px-3 text-xs text-muted transition-colors hover:bg-elevated hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Close
        </button>
      </div>
      {error && (
        <div className="rounded border border-danger/40 bg-danger/10 px-2 py-1 text-[10px] text-danger">
          {error}
        </div>
      )}
      {!loaded ? (
        <div className="text-[11px] text-muted">Loading…</div>
      ) : (
        <>
          <section>
            <h5 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted">
              Cap overrides
            </h5>
            <OverrideForm
              userId={userId}
              override={override}
              onSaved={async () => {
                await refresh();
                await onSaved();
              }}
            />
          </section>
          <section className="border-t border-border pt-3">
            <h5 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted">
              Abuse controls
            </h5>
            <AbuseControls
              userId={userId}
              denylist={denylist}
              onChanged={async () => {
                await refresh();
                await onSaved();
              }}
            />
          </section>
        </>
      )}
    </div>
  );
}

const PHRASE_FREEZE_USER =
  "I understand this blocks all access for this user";

function AbuseControls({
  userId,
  denylist,
  onChanged,
}: {
  userId: string;
  denylist: AdminDenylistRow | null;
  onChanged: () => Promise<void>;
}) {
  const { draft, setDraft, clear: clearDraft, hasDraft, restored } = useAdminDraft(
    `user-abuse.${userId}`,
    { denyReason: "", freezeReason: "", freezePhrase: "" },
  );
  const { denyReason, freezeReason, freezePhrase } = draft;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const isDenied = !!denylist;
  const isFrozen = denylist?.frozen === true;

  const denyOk = denyReason.trim().length >= 4;
  const freezeOk =
    freezeReason.trim().length >= 4 && freezePhrase === PHRASE_FREEZE_USER;

  const wrap = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      await onChanged();
      clearDraft();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {restored && <div role="status" className="text-[10px] text-accent">Restored your unfinished account-control draft.</div>}
      <div className="flex flex-wrap gap-1.5 text-[10px]">
        <span
          className={`inline-block rounded-full border px-2 py-0.5 font-semibold ${isDenied ? "border-danger/40 bg-danger/10 text-danger" : "border-success/40 bg-success/10 text-success"}`}
        >
          {isDenied ? "denylisted" : "AI access OK"}
        </span>
        <span
          className={`inline-block rounded-full border px-2 py-0.5 font-semibold ${isFrozen ? "border-danger/40 bg-danger/10 text-danger" : "border-success/40 bg-success/10 text-success"}`}
        >
          {isFrozen ? "FROZEN" : "active"}
        </span>
      </div>

      {denylist?.reason && (
        <div className="rounded border border-border bg-elevated/30 px-2 py-1 text-[10px] text-muted">
          <div>
            <strong className="text-ink">Denylist reason:</strong>{" "}
            {denylist.reason}
          </div>
          {denylist.frozenReason && (
            <div className="mt-0.5">
              <strong className="text-danger">Freeze reason:</strong>{" "}
              {denylist.frozenReason}
            </div>
          )}
        </div>
      )}

      {/* Denylist toggle */}
      <div className="flex flex-col gap-1">
        <label className="text-[11px]">
          <span className="text-muted">Denylist reason (≥4 chars)</span>
          <input
            type="text"
            value={denyReason}
            onChange={(e) => setDraft((current) => ({ ...current, denyReason: e.target.value }))}
            disabled={busy}
            placeholder={isDenied ? "(unused — only needed to add)" : "why deny platform AI"}
            className="mt-0.5 w-full rounded border border-border bg-bg px-2 py-1 text-ink"
          />
        </label>
        <div className="flex gap-2">
          {!isDenied && (
            <button
              type="button"
              disabled={busy || !denyOk}
              onClick={() =>
                wrap(() =>
                  api.adminSetDenylist(userId, { reason: denyReason.trim() }),
                )
              }
              className="rounded-md bg-warn px-3 py-1 text-[11px] font-semibold text-bg disabled:opacity-50"
            >
              Add to denylist
            </button>
          )}
          {isDenied && !isFrozen && (
            <button
              type="button"
              disabled={busy}
              onClick={() => wrap(() => api.adminClearDenylist(userId))}
              className="rounded-md border border-border bg-elevated px-3 py-1 text-[11px] text-muted hover:text-ink"
            >
              Remove from denylist
            </button>
          )}
          {isDenied && isFrozen && (
            <span className="text-[10px] text-muted">
              Unfreeze first to remove denylist (audit-trail integrity).
            </span>
          )}
        </div>
      </div>

      {/* Freeze toggle */}
      <div className="flex flex-col gap-1 border-t border-border pt-2">
        {!isFrozen ? (
          <>
            <label className="text-[11px]">
              <span className="text-muted">Freeze reason (≥4 chars)</span>
              <input
                type="text"
                value={freezeReason}
                onChange={(e) => setDraft((current) => ({ ...current, freezeReason: e.target.value }))}
                disabled={busy}
                placeholder="why this account must be fully blocked"
                className="mt-0.5 w-full rounded border border-border bg-bg px-2 py-1 text-ink"
              />
            </label>
            <label className="text-[11px]">
              <span className="text-muted">
                Phrase:{" "}
                <span className="font-mono text-danger">{PHRASE_FREEZE_USER}</span>
              </span>
              <input
                type="text"
                value={freezePhrase}
                onChange={(e) => setDraft((current) => ({ ...current, freezePhrase: e.target.value }))}
                disabled={busy}
                className={`mt-0.5 w-full rounded border bg-bg px-2 py-1 ${freezePhrase === PHRASE_FREEZE_USER ? "border-success/40 text-success" : "border-border text-ink"}`}
              />
            </label>
            <p className="text-[10px] text-muted">
              Freeze blocks platform AI <em>and</em> session creation. The
              learner sees an &ldquo;account suspended&rdquo; banner with the
              reason on next page load.
            </p>
            <button
              type="button"
              disabled={busy || !freezeOk}
              onClick={() =>
                wrap(() =>
                  api.adminFreezeUser(userId, {
                    reason: freezeReason.trim(),
                    confirmFreeze: freezePhrase,
                  }),
                )
              }
              className="self-start rounded-md bg-danger px-3 py-1 text-[11px] font-semibold text-bg disabled:opacity-50"
            >
              Freeze account
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => wrap(() => api.adminUnfreezeUser(userId))}
            className="self-start rounded-md border border-border bg-elevated px-3 py-1 text-[11px] text-muted hover:text-ink"
          >
            Unfreeze account
          </button>
        )}
      </div>

      {/* Phase 26: force-signout. Distinct from freeze — doesn't persist
          state, just invalidates every JWT this user holds. Use after
          demoting a compromised admin (DELETE FROM user_roles) so their
          ~1h refresh window can't keep them authed. */}
      <ForceSignOutControl userId={userId} onChanged={onChanged} />

      {hasDraft && (
        <button type="button" onClick={clearDraft} disabled={busy} className="min-h-11 self-start rounded-md px-3 text-[11px] text-danger hover:bg-danger/10 disabled:opacity-50">
          Discard account-control draft
        </button>
      )}

      {err && (
        <div className="rounded border border-danger/40 bg-danger/10 px-2 py-1 text-[10px] text-danger">
          {err}
        </div>
      )}
    </div>
  );
}

const PHRASE_FORCE_SIGNOUT =
  "I understand this terminates all sessions and signs them out everywhere";

function ForceSignOutControl({
  userId,
  onChanged,
}: {
  userId: string;
  onChanged: () => Promise<void>;
}) {
  const { draft, setDraft, clear: clearDraft, hasDraft, restored } = useAdminDraft(
    `user-force-signout.${userId}`,
    { reason: "", phrase: "" },
  );
  const { reason, phrase } = draft;
  const [open, setOpen] = useState(restored);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{
    sessionsKilled: number;
    streamsAborted: number;
  } | null>(null);
  const ready = reason.trim().length >= 4 && phrase === PHRASE_FORCE_SIGNOUT;

  return (
    <div className="flex flex-col gap-1 border-t border-border pt-2">
      {!open ? (
        <button
          type="button"
          onClick={() => {
            setResult(null);
            setOpen(true);
          }}
          className="self-start rounded-md border border-warn/40 bg-warn/10 px-3 py-1 text-[11px] font-semibold text-warn"
        >
          Force sign-out…
        </button>
      ) : (
        <>
          {restored && <div role="status" className="text-[10px] text-accent">Restored your unfinished sign-out draft.</div>}
          <p className="text-[10px] text-muted">
            Revokes every refresh token this user holds. Their existing JWT
            stops working on every device immediately. Pair with{" "}
            <code className="text-ink">DELETE FROM user_roles</code> when
            demoting a compromised admin.
          </p>
          <label className="text-[11px]">
            <span className="text-muted">Reason (≥4 chars)</span>
            <input
              type="text"
              value={reason}
              onChange={(e) => setDraft((current) => ({ ...current, reason: e.target.value }))}
              disabled={busy}
              placeholder="e.g. compromised admin — demoted at 14:02 UTC"
              className="mt-0.5 w-full rounded border border-border bg-bg px-2 py-1 text-ink"
            />
          </label>
          <label className="text-[11px]">
            <span className="text-muted">
              Phrase:{" "}
              <span className="font-mono text-warn">{PHRASE_FORCE_SIGNOUT}</span>
            </span>
            <input
              type="text"
              value={phrase}
              onChange={(e) => setDraft((current) => ({ ...current, phrase: e.target.value }))}
              disabled={busy}
              className={`mt-0.5 w-full rounded border bg-bg px-2 py-1 ${phrase === PHRASE_FORCE_SIGNOUT ? "border-success/40 text-success" : "border-border text-ink"}`}
            />
          </label>
          {err && <div className="text-[11px] text-danger">{err}</div>}
          {result && (
            <div className="rounded border border-success/40 bg-success/10 px-2 py-1 text-[10px] text-success">
              Signed out. Killed {result.sessionsKilled} session(s),
              aborted {result.streamsAborted} in-flight stream(s).
            </div>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!ready || busy}
              onClick={async () => {
                setBusy(true);
                setErr(null);
                setResult(null);
                try {
                  const r = await api.adminForceSignOut(userId, {
                    reason: reason.trim(),
                    confirmSignout: phrase,
                  });
                  setResult({
                    sessionsKilled: r.sessionsKilled,
                    streamsAborted: r.streamsAborted,
                  });
                  clearDraft();
                  await onChanged();
                } catch (e) {
                  setErr(e instanceof Error ? e.message : String(e));
                } finally {
                  setBusy(false);
                }
              }}
              className="rounded-md bg-warn px-3 py-1 text-[11px] font-semibold text-bg disabled:opacity-50"
            >
              {busy ? "Signing out…" : "Force sign-out"}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md border border-border bg-elevated px-3 py-1 text-[11px] text-muted hover:text-ink"
            >
              Cancel
            </button>
            {hasDraft && (
              <button type="button" onClick={() => { clearDraft(); setOpen(false); }} disabled={busy} className="min-h-11 rounded-md px-3 text-[11px] text-danger hover:bg-danger/10 disabled:opacity-50">
                Discard draft
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

interface OverrideFormProps {
  userId: string;
  override: AdminUserOverride | null;
  onSaved: () => Promise<void>;
}

function OverrideForm({ userId, override, onSaved }: OverrideFormProps) {
  const { draft, setDraft, clear: clearDraft, hasDraft, restored } = useAdminDraft(
    `user-override.${userId}`,
    {
      dailyQ: override?.dailyQuestionsCap?.toString() ?? "",
      dailyUsd: override?.dailyUsdCap?.toString() ?? "",
      lifetimeUsd: override?.lifetimeUsdCap?.toString() ?? "",
      reason: "",
    },
  );
  const { dailyQ, dailyUsd, lifetimeUsd, reason } = draft;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  type ParsedCap = number | null | "invalid";
  const parseOrNull = (s: string, max: number): ParsedCap => {
    if (s.trim() === "") return null;
    const n = Number(s);
    if (!Number.isFinite(n)) return "invalid" as const;
    if (n < 0 || n > max) return "invalid" as const;
    return n;
  };

  const dailyQVal: ParsedCap = parseOrNull(dailyQ, 10000);
  const dailyUsdVal: ParsedCap = parseOrNull(dailyUsd, 100);
  const lifetimeUsdVal: ParsedCap = parseOrNull(lifetimeUsd, 1000);
  const anyInvalid =
    dailyQVal === "invalid" ||
    dailyUsdVal === "invalid" ||
    lifetimeUsdVal === "invalid";
  const reasonOk = reason.trim().length >= 4;
  const canSave = !busy && !anyInvalid && reasonOk;

  // Soft warning if dailyQ = 0.
  const zeroNudge = dailyQVal === 0;

  const handleSave = async () => {
    if (!canSave) return;
    // After the canSave guard (which includes !anyInvalid), TS has
    // narrowed each *Val to `number | null` — no "invalid" possible.
    setBusy(true);
    setError(null);
    try {
      await api.adminSetUserOverride(userId, {
        dailyQuestionsCap: dailyQVal as number | null,
        dailyUsdCap: dailyUsdVal as number | null,
        lifetimeUsdCap: lifetimeUsdVal as number | null,
        reason: reason.trim(),
      });
      await onSaved();
      clearDraft();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const handleClear = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.adminClearUserOverride(userId);
      await onSaved();
      clearDraft();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {restored && <div role="status" className="text-[10px] text-accent">Restored your unfinished cap draft.</div>}
      <div className="grid grid-cols-3 gap-2">
        <CapInput
          label="Daily questions"
          value={dailyQ}
          onChange={(value) => setDraft((current) => ({ ...current, dailyQ: value }))}
          max={10000}
          placeholder="default"
          disabled={busy}
        />
        <CapInput
          label="Daily $"
          value={dailyUsd}
          onChange={(value) => setDraft((current) => ({ ...current, dailyUsd: value }))}
          max={100}
          step="0.01"
          placeholder="default"
          disabled={busy}
        />
        <CapInput
          label="Lifetime $"
          value={lifetimeUsd}
          onChange={(value) => setDraft((current) => ({ ...current, lifetimeUsd: value }))}
          max={1000}
          step="0.01"
          placeholder="default"
          disabled={busy}
        />
      </div>
      <p className="text-[10px] text-faint">
        Empty = use project default. Bounds enforced server-side.
      </p>

      {zeroNudge && (
        <div className="rounded border border-warn/40 bg-warn/10 px-2 py-1.5 text-[10px] text-warn">
          Setting daily questions = 0 effectively denylists this user. Consider
          adding to the platform denylist instead for clearer audit semantics.
        </div>
      )}

      <label className="flex flex-col gap-1">
        <span className="text-[10px] font-medium text-muted">
          Reason <span className="text-faint">(required, 4+ chars)</span>
        </span>
        <input
          type="text"
          value={reason}
          onChange={(e) => setDraft((current) => ({ ...current, reason: e.target.value }))}
          disabled={busy}
          placeholder="why this user gets a custom cap"
          className="rounded border border-border bg-bg px-2 py-1 text-[11px] text-ink"
        />
      </label>

      {error && (
        <div className="rounded border border-danger/40 bg-danger/10 px-2 py-1 text-[10px] text-danger">
          {error}
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={handleSave}
          disabled={!canSave}
          className="rounded-md bg-accent px-3 py-1 text-[11px] font-semibold text-bg transition hover:bg-accent/90 disabled:cursor-not-allowed disabled:bg-elevated disabled:text-faint"
        >
          {busy ? "Saving…" : "Save override"}
        </button>
        {override && (
          <button
            onClick={handleClear}
            disabled={busy}
            className="rounded-md border border-border bg-elevated px-3 py-1 text-[11px] text-muted transition hover:text-ink"
          >
            Clear all caps
          </button>
        )}
        {hasDraft && (
          <button onClick={clearDraft} disabled={busy} className="min-h-11 rounded-md px-3 text-[11px] text-danger hover:bg-danger/10 disabled:opacity-50">
            Discard draft
          </button>
        )}
      </div>
    </div>
  );
}

function CapInput({
  label,
  value,
  onChange,
  max,
  step,
  placeholder,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  max: number;
  step?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const n = value.trim() === "" ? null : Number(value);
  const invalid =
    n !== null && (!Number.isFinite(n) || n < 0 || n > max);
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-medium text-muted">{label}</span>
      <input
        type="number"
        min={0}
        max={max}
        step={step ?? "1"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className={`rounded border bg-bg px-2 py-1 font-mono text-[11px] text-ink ${
          invalid ? "border-danger/60" : "border-border"
        }`}
      />
      <span className="text-[9px] text-faint">0–{max}</span>
    </label>
  );
}
