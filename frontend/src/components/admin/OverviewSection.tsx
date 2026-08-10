import { useCallback, useMemo, useState } from "react";
import { api, type AdminDashboardSnapshot } from "../../api/client";
import { useLivePolling } from "../../auth/useLivePolling";
import { AdminLoadFailure } from "./AdminLoadFailure";
import { AdminPageHeader } from "./AdminPrimitives";
import { useAdminDraft } from "./useAdminDraft";

// Phase 25: live overview dashboard. Six tiles + a flagged-state banner.
// Polls /api/admin/dashboard every 5s; pauses on tab blur.

const POLL_MS = 5000;

export function OverviewSection() {
  const fetcher = useCallback(() => api.adminGetDashboard(), []);
  const { data, error, refresh } = useLivePolling<AdminDashboardSnapshot>(
    fetcher,
    POLL_MS,
  );
  const banners = useMemo(() => buildBanners(data), [data]);

  return (
    <div className="flex flex-col gap-4">
      <AdminPageHeader
        eyebrow="Live operations"
        title="Overview"
        description="A real-time view of capacity, spend, health, queues, and the controls most likely to matter during an incident."
        actions={<RefreshButton onClick={() => void refresh()} stale={!!error} />}
      />

      {error && data && (
        <div
          role="alert"
          className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-[11px] text-danger"
        >
          Failed to refresh: {error}
        </div>
      )}

      {banners.map((b) => (
        <div
          key={b.title}
          role="alert"
          className={`rounded-md border px-3 py-2 text-[11px] ${b.severity === "danger" ? "border-danger/40 bg-danger/10 text-danger" : "border-warn/40 bg-warn/10 text-warn"}`}
        >
          <strong className="font-semibold">{b.title}: </strong>
          {b.body}
          {b.cta && (
            <span className="ml-1 underline">— {b.cta}</span>
          )}
        </div>
      ))}

      {error && !data ? (
        <AdminLoadFailure
          title="Overview did not load"
          error={error}
          onRetry={() => void refresh()}
        />
      ) : !data ? (
        <div className="admin-instrument-board grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : (
        <>
          <div className="admin-instrument-board grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
            <SessionsTile snap={data} />
            <SpendTile snap={data} />
            <BurnTile snap={data} />
            <HealthTile snap={data} />
            <QueuesTile snap={data} />
            <SpawnOutcomesTile snap={data} />
            <BootTile snap={data} />
          </div>
          <div className="admin-action-board grid grid-cols-1 md:grid-cols-2">
            <PlatformAuthCard
              snap={data}
              onChanged={() => void refresh()}
            />
            <BudgetWatcherCard
              snap={data}
              onChanged={() => void refresh()}
            />
          </div>
        </>
      )}
    </div>
  );
}

const PHRASE_UNSTICK_AUTH =
  "I understand this may hammer an invalid OpenAI key";
const PHRASE_RESET_BUDGET =
  "I understand this may cause duplicate budget alerts";

function PlatformAuthCard({
  snap,
  onChanged,
}: {
  snap: AdminDashboardSnapshot;
  onChanged: () => void;
}) {
  const { draft, setDraft, clear: clearDraft, hasDraft, restored } = useAdminDraft(
    "overview.platform-auth",
    { reason: "", phrase: "" },
  );
  const { reason, phrase } = draft;
  const [open, setOpen] = useState(restored);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const failed = snap.health.platformAuth === "failed";
  const ready = reason.trim().length >= 4 && phrase === PHRASE_UNSTICK_AUTH;
  return (
    <Tile title="Platform auth">
      <div className="flex items-baseline justify-between text-[11px]">
        <span className={failed ? "text-danger" : "text-success"}>
          {failed ? "FAILING" : "OK"}
        </span>
        <span className="text-[10px] text-muted">
          {failed && snap.health.platformAuthSinceMs !== null
            ? `${Math.round(snap.health.platformAuthSinceMs / 60_000)} min ago`
            : "no flag set"}
        </span>
      </div>
      {failed && !open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-2 self-start rounded-md border border-danger/40 bg-danger/10 px-3 py-1 text-[11px] font-semibold text-danger"
        >
          Clear flag…
        </button>
      )}
      {open && (
        <div className="mt-2 flex flex-col gap-2 border-t border-border pt-2">
          {restored && <div role="status" className="text-[11px] text-accent">Restored your unfinished draft.</div>}
          <label className="text-[11px]">
            <span className="text-muted">Reason (≥4 chars)</span>
            <input
              type="text"
              value={reason}
              onChange={(e) => setDraft((current) => ({ ...current, reason: e.target.value }))}
              className="mt-0.5 w-full rounded border border-border bg-bg px-2 py-1 text-ink"
              placeholder="e.g. rotated key in KV"
            />
          </label>
          <label className="text-[11px]">
            <span className="text-muted">
              Phrase:{" "}
              <span className="font-mono text-danger">{PHRASE_UNSTICK_AUTH}</span>
            </span>
            <input
              type="text"
              value={phrase}
              onChange={(e) => setDraft((current) => ({ ...current, phrase: e.target.value }))}
              className={`mt-0.5 w-full rounded border bg-bg px-2 py-1 ${phrase === PHRASE_UNSTICK_AUTH ? "border-success/40 text-success" : "border-border text-ink"}`}
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
                  await api.adminUnstickPlatformAuth({
                    reason,
                    confirmUnstick: phrase,
                  });
                  setOpen(false);
                  clearDraft();
                  onChanged();
                } catch (e) {
                  setErr(e instanceof Error ? e.message : String(e));
                } finally {
                  setBusy(false);
                }
              }}
              className="rounded-md bg-danger px-3 py-1 text-[11px] font-semibold text-bg disabled:opacity-50"
            >
              {busy ? "Clearing…" : "Clear flag"}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md border border-border bg-elevated px-3 py-1 text-[11px] text-muted hover:text-ink"
            >
              Close
            </button>
            {hasDraft && (
              <button type="button" onClick={() => { clearDraft(); setOpen(false); }} className="min-h-11 rounded-md px-3 text-[11px] text-danger hover:bg-danger/10">
                Discard draft
              </button>
            )}
          </div>
        </div>
      )}
    </Tile>
  );
}

function BudgetWatcherCard({
  snap,
  onChanged,
}: {
  snap: AdminDashboardSnapshot;
  onChanged: () => void;
}) {
  const { draft, setDraft, clear: clearDraft, hasDraft, restored } = useAdminDraft(
    "overview.budget-watcher",
    { reason: "", phrase: "" },
  );
  const { reason, phrase } = draft;
  const [open, setOpen] = useState(restored);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const lastFired = snap.freeTier.lastFiredKey;
  const ready = reason.trim().length >= 4 && phrase === PHRASE_RESET_BUDGET;
  return (
    <Tile title="Budget watcher">
      <div className="flex flex-col gap-1 text-[11px]">
        <div className="flex items-baseline justify-between">
          <span className="text-muted">Last fired</span>
          <span className="font-mono text-[10px] text-ink">
            {lastFired ?? "—"}
          </span>
        </div>
        <div className="text-[10px] text-muted">
          50% / 80% / 100% thresholds; one alert per (day, cap, threshold).
        </div>
      </div>
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={!lastFired}
          className="mt-2 self-start rounded-md border border-border bg-elevated px-3 py-1 text-[11px] text-muted hover:text-ink disabled:opacity-40"
        >
          Reset dedup…
        </button>
      ) : (
        <div className="mt-2 flex flex-col gap-2 border-t border-border pt-2">
          {restored && <div role="status" className="text-[11px] text-accent">Restored your unfinished draft.</div>}
          <label className="text-[11px]">
            <span className="text-muted">Reason (≥4 chars)</span>
            <input
              type="text"
              value={reason}
              onChange={(e) => setDraft((current) => ({ ...current, reason: e.target.value }))}
              className="mt-0.5 w-full rounded border border-border bg-bg px-2 py-1 text-ink"
            />
          </label>
          <label className="text-[11px]">
            <span className="text-muted">
              Phrase:{" "}
              <span className="font-mono text-warn">{PHRASE_RESET_BUDGET}</span>
            </span>
            <input
              type="text"
              value={phrase}
              onChange={(e) => setDraft((current) => ({ ...current, phrase: e.target.value }))}
              className={`mt-0.5 w-full rounded border bg-bg px-2 py-1 ${phrase === PHRASE_RESET_BUDGET ? "border-success/40 text-success" : "border-border text-ink"}`}
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
                  await api.adminResetBudgetWatcher({
                    reason,
                    confirmReset: phrase,
                  });
                  setOpen(false);
                  clearDraft();
                  onChanged();
                } catch (e) {
                  setErr(e instanceof Error ? e.message : String(e));
                } finally {
                  setBusy(false);
                }
              }}
              className="rounded-md bg-warn px-3 py-1 text-[11px] font-semibold text-bg disabled:opacity-50"
            >
              {busy ? "Resetting…" : "Reset"}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md border border-border bg-elevated px-3 py-1 text-[11px] text-muted hover:text-ink"
            >
              Close
            </button>
            {hasDraft && (
              <button type="button" onClick={() => { clearDraft(); setOpen(false); }} className="min-h-11 rounded-md px-3 text-[11px] text-danger hover:bg-danger/10">
                Discard draft
              </button>
            )}
          </div>
        </div>
      )}
    </Tile>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface Banner {
  title: string;
  body: string;
  severity: "danger" | "warn";
  cta?: string;
}

function buildBanners(snap: AdminDashboardSnapshot | null): Banner[] {
  if (!snap) return [];
  const out: Banner[] = [];
  if (snap.aci.costTrackerState === "degraded") {
    out.push({
      title: "ACI cost tracker degraded",
      body:
        "Persistence init failed at boot — kill switch is refusing all spawns until the backend restarts and re-init succeeds.",
      severity: "danger",
    });
  }
  if (snap.health.platformAuth === "failed") {
    const mins = snap.health.platformAuthSinceMs
      ? Math.round(snap.health.platformAuthSinceMs / 60_000)
      : 0;
    out.push({
      title: "Platform auth failing",
      body: `Platform OpenAI key has been returning 401 for ~${mins} min. Free-tier calls are short-circuited.`,
      severity: "danger",
      cta: "Clear flag from Overview after rotating the key in Key Vault.",
    });
  }
  if (snap.health.db === "fail") {
    out.push({
      title: "Database unreachable",
      body: "Probe failed. User state, BYOK ciphertext, and admin writes are likely affected.",
      severity: "danger",
    });
  }
  if (snap.sessions.counterDrift !== 0) {
    out.push({
      title: `Hybrid backend counter drift = ${snap.sessions.counterDrift}`,
      body:
        "Local/ACI session counters disagree with the source of truth. Lifecycle invariants broken upstream.",
      severity: "warn",
    });
  }
  return out;
}

function RefreshButton({ onClick, stale }: { onClick: () => void; stale: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-11 rounded-md border px-3 py-2 text-[11px] font-semibold transition ${stale ? "border-warn/40 bg-warn/10 text-warn" : "border-border bg-elevated text-muted hover:text-ink"}`}
    >
      Refresh
    </button>
  );
}

function Tile({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="admin-metric-card">
      <h3 className="admin-card-label">
        {title}
      </h3>
      {children}
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="admin-metric-card">
      <div className="skeleton h-3 w-24 rounded" />
      <div className="mt-3 skeleton h-6 w-32 rounded" />
      <div className="mt-2 skeleton h-3 w-40 rounded" />
    </div>
  );
}

function Bar({ pct, tone }: { pct: number; tone: "ok" | "warn" | "danger" }) {
  const color =
    tone === "danger" ? "bg-danger" : tone === "warn" ? "bg-warn" : "bg-success";
  return (
    <div className="h-1.5 w-full rounded-full bg-bg/60 overflow-hidden">
      <div
        className={`h-full ${color}`}
        style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
      />
    </div>
  );
}

function pctTone(pct: number): "ok" | "warn" | "danger" {
  if (pct >= 100) return "danger";
  if (pct >= 80) return "warn";
  return "ok";
}

// Caps are clean dollar amounts ($15, $50) — 2 decimals.
function fmtUsdCap(v: number): string {
  return `$${v.toFixed(2)}`;
}

// Spend accrues in fractions of a cent (a typical AI request bills
// ~$0.0003), so 2 decimals collapses an entire morning's free-tier usage
// to "$0.00". 4 decimals captures everything ≥ $0.0001 (1/100th of a
// cent), which covers OpenAI per-call pricing comfortably. Matches the
// 4-decimal display in UsersSection's per-user usage columns.
function fmtUsdSpend(v: number): string {
  return `$${v.toFixed(4)}`;
}

function fmtMs(ms: number | null): string {
  if (ms === null) return "n/a";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

// ---------------------------------------------------------------------------
// Tiles
// ---------------------------------------------------------------------------

function SessionsTile({ snap }: { snap: AdminDashboardSnapshot }) {
  const totalCap = snap.sessions.capAbsolute;
  const pct = totalCap > 0 ? (snap.sessions.total / totalCap) * 100 : 0;
  const { localAuthed, localAnon, aciAuthed, aciAnon } = snap.sessions;
  return (
    <Tile title="Sessions">
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-semibold text-ink">{snap.sessions.total}</span>
        <span className="text-[11px] text-muted">/ {totalCap} absolute cap</span>
      </div>
      <div className="mt-2">
        <Bar pct={pct} tone={pctTone(pct)} />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-muted">
        <div>
          <span className="text-ink">{snap.sessions.local}</span> local
          <span className="text-[10px]"> (cap {snap.sessions.capLocal})</span>
          {localAnon > 0 ? (
            <div className="mt-0.5 text-[10px] text-muted/80">
              {localAuthed} authed · {localAnon} anon
            </div>
          ) : null}
        </div>
        <div>
          <span className="text-ink">{snap.sessions.aci}</span> ACI
          {aciAnon > 0 ? (
            <div className="mt-0.5 text-[10px] text-muted/80">
              {aciAuthed} authed · {aciAnon} anon
            </div>
          ) : null}
        </div>
      </div>
    </Tile>
  );
}

function SpendTile({ snap }: { snap: AdminDashboardSnapshot }) {
  // Combined % bar drives the headline tone — both authed and anon
  // contribute to the same L4 daily cap, so the operator sees one
  // canonical "fraction of envelope" number. The two sub-rows below
  // show the breakdown so an anon spike is visible at a glance without
  // hiding the combined view that matches the resolver's check.
  const ftPct =
    snap.freeTier.dailyUsdCap > 0
      ? (snap.freeTier.spentTodayUsd / snap.freeTier.dailyUsdCap) * 100
      : 0;
  const ftAuthedPct =
    snap.freeTier.dailyUsdCap > 0
      ? (snap.freeTier.spentTodayUsdAuthed / snap.freeTier.dailyUsdCap) * 100
      : 0;
  const ftAnonPct =
    snap.freeTier.dailyUsdCap > 0
      ? (snap.freeTier.spentTodayUsdAnon / snap.freeTier.dailyUsdCap) * 100
      : 0;
  const aciPct =
    snap.aci.dailyUsdCap > 0
      ? (snap.aci.spentTodayUsd / snap.aci.dailyUsdCap) * 100
      : 0;
  return (
    <Tile title="Today's spend">
      <div className="flex flex-col gap-3">
        <div>
          <div className="flex items-baseline justify-between text-[11px]">
            <span className="text-muted">Free-tier AI</span>
            <span className="text-ink">
              {fmtUsdSpend(snap.freeTier.spentTodayUsd)}{" "}
              <span className="text-muted">
                / {fmtUsdCap(snap.freeTier.dailyUsdCap)}
              </span>
            </span>
          </div>
          <div className="mt-1.5">
            <Bar pct={ftPct} tone={pctTone(ftPct)} />
          </div>
          {/* Phase 27-v2.2 Fix 7a — authed-vs-anon split. The combined
              bar above is what gates against the L4 cap; these two
              sub-rows surface where the spend is coming from so an
              operator can spot an anon spike without leaving Overview. */}
          <div className="mt-2 flex flex-col gap-1.5 pl-1">
            <SubRow
              label="Authed"
              spend={snap.freeTier.spentTodayUsdAuthed}
              pct={ftAuthedPct}
            />
            <SubRow
              label="Anon"
              spend={snap.freeTier.spentTodayUsdAnon}
              pct={ftAnonPct}
            />
          </div>
          {snap.freeTier.lastFiredKey && (
            <div className="mt-1 text-[10px] text-warn">
              Watcher fired: {snap.freeTier.lastFiredKey}
            </div>
          )}
        </div>
        <div>
          <div className="flex items-baseline justify-between text-[11px]">
            <span className="text-muted">ACI overflow</span>
            <span className="text-ink">
              {fmtUsdSpend(snap.aci.spentTodayUsd)}{" "}
              <span className="text-muted">/ {fmtUsdCap(snap.aci.dailyUsdCap)}</span>
            </span>
          </div>
          <div className="mt-1.5">
            <Bar pct={aciPct} tone={pctTone(aciPct)} />
          </div>
        </div>
      </div>
    </Tile>
  );
}

// Phase A — A5: projected monthly burn. Fixed infra baseline (env
// constant INFRA_MONTHLY_BASELINE_USD, operator-maintained) + AI spend
// extrapolated from the trailing 7 days. Directional, not an invoice —
// its job is making a July-2026-style credit blowout visible weeks
// before the subscription gets disabled, not accounting precision.
function BurnTile({ snap }: { snap: AdminDashboardSnapshot }) {
  const b = snap.burn;
  return (
    <Tile title="Projected monthly burn">
      <div className="flex flex-col gap-2">
        <div className="text-2xl font-semibold text-ink">
          ${b.projectedMonthlyUsd.toFixed(2)}
          <span className="ml-1 text-[11px] font-normal text-muted">/mo</span>
        </div>
        <div className="flex flex-col gap-1 text-[11px]">
          <div className="flex items-baseline justify-between">
            <span className="text-muted">Azure infra (baseline)</span>
            <span className="font-mono text-ink">
              ${b.infraMonthlyUsd.toFixed(2)}
            </span>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-muted">AI @ 7-day avg</span>
            <span className="font-mono text-ink">
              ${(b.aiDailyAvgUsd * 30.44).toFixed(2)}
            </span>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-faint">AI last 7 days</span>
            <span className="font-mono text-muted">
              {fmtUsdSpend(b.aiSpendLast7dUsd)}
            </span>
          </div>
        </div>
      </div>
    </Tile>
  );
}

function SubRow({
  label,
  spend,
  pct,
}: {
  label: string;
  spend: number;
  pct: number;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between text-[10px]">
        <span className="text-faint">{label}</span>
        <span className="font-mono text-muted">{fmtUsdSpend(spend)}</span>
      </div>
      <div className="mt-0.5">
        <Bar pct={pct} tone={pctTone(pct)} />
      </div>
    </div>
  );
}

function HealthTile({ snap }: { snap: AdminDashboardSnapshot }) {
  function Dot({ ok, label, hint }: { ok: boolean; label: string; hint?: string }) {
    return (
      <div className="flex items-center gap-2 text-[11px]">
        <span
          className={`h-2 w-2 rounded-full ${ok ? "bg-success" : "bg-danger"}`}
        />
        <span className="text-ink">{label}</span>
        {hint && <span className="text-[10px] text-muted">— {hint}</span>}
      </div>
    );
  }
  return (
    <Tile title="Health">
      <div className="flex flex-col gap-1.5">
        <Dot ok={snap.health.db === "ok"} label="Database" />
        <Dot
          ok={snap.health.platformAuth === "ok"}
          label="Platform auth"
          hint={
            snap.health.platformAuth === "failed" && snap.health.platformAuthSinceMs
              ? `failing ${fmtMs(snap.health.platformAuthSinceMs)}`
              : undefined
          }
        />
        <Dot
          ok={snap.aci.costTrackerState === "hydrated"}
          label="ACI cost tracker"
          hint={snap.aci.costTrackerState === "degraded" ? "DEGRADED" : undefined}
        />
        <Dot
          ok={snap.aci.configRefreshAgeMs !== null && snap.aci.configRefreshAgeMs < 150_000}
          label="ACI config refresh"
          hint={`age ${fmtMs(snap.aci.configRefreshAgeMs)}`}
        />
      </div>
    </Tile>
  );
}

function QueuesTile({ snap }: { snap: AdminDashboardSnapshot }) {
  function Row({
    label,
    value,
    waiting,
  }: {
    label: string;
    value: number;
    waiting?: number;
  }) {
    const tone = waiting && waiting > 0 ? "text-warn" : "text-ink";
    const queueLabel =
      typeof waiting === "number"
        ? `${value} active, ${waiting} waiting`
        : `${value} active`;
    return (
      <div className="flex items-baseline justify-between text-[11px]">
        <span className="text-muted">{label}</span>
        <span
          aria-label={queueLabel}
          className={`inline-flex items-baseline gap-1.5 ${tone}`}
        >
          <span aria-hidden="true" className="inline-flex items-baseline gap-1">
            <strong className="font-mono text-xs font-semibold tabular-nums">
              {value}
            </strong>
            <span className="text-[10px]">active</span>
          </span>
          {typeof waiting === "number" && (
            <span aria-hidden="true" className="inline-flex items-baseline gap-1 text-muted">
              <span>·</span>
              <strong className="font-mono text-[11px] font-medium tabular-nums">
                {waiting}
              </strong>
              <span className="text-[10px]">waiting</span>
            </span>
          )}
        </span>
      </div>
    );
  }
  return (
    <Tile title="Queues">
      <div className="flex flex-col gap-1.5">
        <Row
          label="Docker exec"
          value={snap.queues.dockerExecInflight}
          waiting={snap.queues.dockerExecQueued}
        />
        <Row
          label="Share render"
          value={snap.queues.renderActive}
          waiting={snap.queues.renderWaiting}
        />
      </div>
    </Tile>
  );
}

function SpawnOutcomesTile({ snap }: { snap: AdminDashboardSnapshot }) {
  const r = snap.rates.aciSpawnAttempts;
  const order: Array<keyof typeof r> = [
    "warm_claim",
    "cold_success",
    "fail_cap",
    "fail_arm",
    "fail_agent",
  ];
  const known = new Set<string>(order as string[]);
  const extras = Object.keys(r).filter((k) => !known.has(k));
  return (
    <Tile title="ACI spawn (cumulative)">
      <div className="flex flex-col gap-1">
        {[...order, ...extras].map((k) => {
          const v = r[k] ?? 0;
          const isFail = String(k).startsWith("fail_");
          return (
            <div
              key={String(k)}
              className="flex items-baseline justify-between text-[11px]"
            >
              <span className="text-muted">{String(k)}</span>
              <span className={isFail && v > 0 ? "text-danger" : "text-ink"}>
                {v}
              </span>
            </div>
          );
        })}
      </div>
    </Tile>
  );
}

function BootTile({ snap }: { snap: AdminDashboardSnapshot }) {
  const [copied, setCopied] = useState(false);
  return (
    <Tile title="Boot">
      <div className="flex flex-col gap-1.5 text-[11px]">
        <div className="flex items-baseline justify-between">
          <span className="text-muted">Boot ID</span>
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(snap.bootId);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              } catch {
                // ignore
              }
            }}
            className="font-mono text-[10px] text-ink hover:underline"
          >
            {copied ? "copied!" : snap.bootId}
          </button>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="text-muted">ACI overflow</span>
          <span className="text-ink">{snap.aci.enabled ? "enabled" : "disabled"}</span>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="text-muted">Free tier</span>
          <span className="text-ink">{snap.freeTier.enabled ? "enabled" : "disabled"}</span>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="text-muted">Generated</span>
          <span className="text-[10px] text-muted">
            {new Date(snap.generatedAt).toLocaleTimeString()}
          </span>
        </div>
      </div>
    </Tile>
  );
}
