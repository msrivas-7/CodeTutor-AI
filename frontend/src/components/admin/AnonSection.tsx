import { useCallback } from "react";
import { api, type AdminAnonSummary } from "../../api/client";
import { useLivePolling } from "../../auth/useLivePolling";

// Phase 27-v2.2 Fix 7b — admin "Trial path" tab. Read-only summary of the
// anon trial path (the /try/lesson/... funnel that backs Phase 27's
// language-agnostic 60-second activation). Mirrors OverviewSection's
// poll-every-5s pattern so admins can watch traffic in real time during
// a launch window or an abuse spike.
//
// Surfaces:
//   - today's anon question count + distinct IP count + exhausted IPs
//   - process-cumulative abuse signals (anon_lesson_not_allowed,
//     model_rejection) so a non-zero count surfaces fast
//   - cumulative funnel events (page view → wall opened → signup →
//     lesson 2) so the operator can see whether a launch landed
//   - kill-switch state pulled from system_config
//
// The kill-switch toggle itself lives in ProjectCapsSection (the
// existing system_config grid). This tab is a read view + a one-line
// link to the toggle, to avoid duplicating the phrase-confirm UI.

const POLL_MS = 5000;

export function AnonSection() {
  const fetcher = useCallback(() => api.adminGetAnonSummary(), []);
  const { data, error, refresh } = useLivePolling<AdminAnonSummary>(
    fetcher,
    POLL_MS,
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">Trial path</h2>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted">
            Anon /try/lesson/... funnel — request volume, abuse signals,
            funnel events, kill-switch state. Refreshed every 5 seconds.
          </p>
        </div>
        <RefreshButton onClick={() => void refresh()} stale={!!error} />
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-[11px] text-danger"
        >
          Failed to refresh: {error}
        </div>
      )}

      {data && data.killSwitch.enabled === false && (
        <div
          role="alert"
          className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-[11px] text-warn"
        >
          <strong className="font-semibold">Kill switch engaged: </strong>
          /api/anon/* is returning 503. Flip{" "}
          <span className="font-mono">anon_lesson_enabled</span> in the Project
          tab to re-enable.
        </div>
      )}

      {!data ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            <TrafficTile snap={data} />
            <FunnelTile snap={data} />
            <AbuseTile snap={data} />
            <KillSwitchTile snap={data} />
          </div>
        </>
      )}
    </div>
  );
}

function TrafficTile({ snap }: { snap: AdminAnonSummary }) {
  return (
    <Tile title="Traffic today (UTC)">
      <div className="flex flex-col gap-2 text-[11px]">
        <Row
          label="Questions"
          value={snap.questionsToday.toLocaleString()}
          hint="counts_toward_quota"
        />
        <Row
          label="Distinct IPs"
          value={snap.distinctIpsToday.toLocaleString()}
        />
        <Row
          label="Exhausted IPs"
          value={snap.exhaustedIpsToday.toLocaleString()}
          hint={`hit ${snap.perIpDailyCap}/day cap`}
          tone={snap.exhaustedIpsToday > 0 ? "warn" : "ok"}
        />
      </div>
      <div className="mt-2 text-[10px] leading-relaxed text-faint">
        Per-IP cap: {snap.perIpDailyCap} questions / UTC day. Resets at
        midnight.
      </div>
    </Tile>
  );
}

function FunnelTile({ snap }: { snap: AdminAnonSummary }) {
  const fe = snap.funnelEvents;
  // Stage-by-stage drop-off rate, computed client-side.
  const pct = (a: number, b: number) =>
    b === 0 ? "—" : `${Math.round((a / b) * 100)}%`;
  return (
    <Tile title="Funnel (today, UTC)">
      <div className="flex flex-col gap-1.5 text-[11px]">
        <FunnelRow label="Page view" value={fe.anon_page_view} />
        <FunnelRow
          label="Wall opened"
          value={fe.anon_wall_opened}
          conv={pct(fe.anon_wall_opened, fe.anon_page_view)}
        />
        <FunnelRow
          label="Signup completed"
          value={fe.anon_signup_completed}
          conv={pct(fe.anon_signup_completed, fe.anon_wall_opened)}
        />
        <FunnelRow
          label="Lesson 2 reached"
          value={fe.anon_lesson2_reached}
          conv={pct(fe.anon_lesson2_reached, fe.anon_signup_completed)}
        />
      </div>
      <div className="mt-2 text-[10px] leading-relaxed text-faint">
        Today (UTC). % shows conversion from the previous stage. Resets
        at midnight; for historical comparison query the table directly.
      </div>
    </Tile>
  );
}

function AbuseTile({ snap }: { snap: AdminAnonSummary }) {
  const a = snap.abuseSignals;
  const total = a.anon_lesson_not_allowed + a.model_rejection;
  return (
    <Tile title="Abuse signals (since boot)">
      <div className="flex flex-col gap-1.5 text-[11px]">
        <Row
          label="anon_lesson_not_allowed"
          value={a.anon_lesson_not_allowed.toLocaleString()}
          tone={a.anon_lesson_not_allowed > 0 ? "warn" : "ok"}
          hint="lesson outside allowlist"
        />
        <Row
          label="model_rejection"
          value={a.model_rejection.toLocaleString()}
          tone={a.model_rejection > 0 ? "warn" : "ok"}
          hint="model not on per-route allowlist"
        />
        {/* Phase A — A4: not abuse but the same "non-zero ⇒ look" story —
            the tutor named an API that isn't stdlib or in the user's
            file. Symbols are in the tutor_suspect_api log lines. */}
        <Row
          label="tutor_suspect_api"
          value={(a.tutor_suspect_api ?? 0).toLocaleString()}
          tone={(a.tutor_suspect_api ?? 0) > 0 ? "warn" : "ok"}
          hint="tutor named an unrecognized API"
        />
      </div>
      {total === 0 ? (
        <div className="mt-2 text-[10px] leading-relaxed text-success/80">
          No abuse signals since process boot.
        </div>
      ) : (
        <div className="mt-2 text-[10px] leading-relaxed text-warn">
          Non-zero signal — investigate. Each tick corresponds to a request
          that should never reach this layer under the defense ladder.
        </div>
      )}
    </Tile>
  );
}

function KillSwitchTile({ snap }: { snap: AdminAnonSummary }) {
  const ks = snap.killSwitch;
  return (
    <Tile title="Kill switch">
      <div className="flex flex-col gap-2 text-[11px]">
        <div className="flex items-baseline gap-2">
          <span
            className={`rounded px-2 py-0.5 text-[10px] font-semibold ${
              ks.enabled
                ? "bg-success/15 text-success ring-1 ring-success/30"
                : "bg-danger/15 text-danger ring-1 ring-danger/30"
            }`}
          >
            {ks.enabled ? "ENABLED" : "BLOCKED"}
          </span>
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] ${
              ks.source === "override"
                ? "bg-accent/15 text-accent ring-1 ring-accent/30"
                : "bg-muted/15 text-muted ring-1 ring-muted/30"
            }`}
          >
            {ks.source === "override" ? "override" : "env default"}
          </span>
        </div>
        {ks.source === "override" && ks.reason && (
          <div className="text-[10px] italic leading-relaxed text-faint">
            "{ks.reason}"
            {ks.setAt && <> — {ks.setAt.slice(0, 10)}</>}
          </div>
        )}
        <div className="text-[10px] leading-relaxed text-faint">
          Toggle at <span className="font-mono">Project → Anon trial path
          enabled</span>. Phrase-confirm and audit log apply.
        </div>
      </div>
    </Tile>
  );
}

function Row({
  label,
  value,
  hint,
  tone = "ok",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "ok" | "warn" | "danger";
}) {
  const toneClass =
    tone === "danger"
      ? "text-danger"
      : tone === "warn"
        ? "text-warn"
        : "text-ink";
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-muted">
        {label}
        {hint && (
          <span className="ml-1 text-[10px] text-faint">— {hint}</span>
        )}
      </span>
      <span className={`font-mono ${toneClass}`}>{value}</span>
    </div>
  );
}

function FunnelRow({
  label,
  value,
  conv,
}: {
  label: string;
  value: number;
  conv?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-muted">{label}</span>
      <span className="flex items-baseline gap-2">
        {conv && <span className="text-[10px] text-faint">{conv}</span>}
        <span className="font-mono text-ink">{value.toLocaleString()}</span>
      </span>
    </div>
  );
}

function Tile({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-elevated/30 p-3">
      <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted">
        {title}
      </h3>
      {children}
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="rounded-md border border-border bg-elevated/30 p-3">
      <div className="skeleton h-3 w-24 rounded" />
      <div className="mt-3 skeleton h-6 w-32 rounded" />
      <div className="mt-2 skeleton h-3 w-40 rounded" />
    </div>
  );
}

function RefreshButton({
  onClick,
  stale,
}: {
  onClick: () => void;
  stale: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border px-3 py-1 text-[11px] font-semibold transition ${stale ? "border-warn/40 bg-warn/10 text-warn" : "border-border bg-elevated text-muted hover:text-ink"}`}
    >
      Refresh
    </button>
  );
}
