import { useEffect, useMemo, useState } from "react";
import {
  api,
  type SystemConfigEntry,
  type SystemConfigKey,
} from "../../api/client";
import { Modal } from "../Modal";
import { AdminLoadFailure } from "./AdminLoadFailure";

// Phase 20-P5 / Phase 4.5 (safety guards): runtime-editable project caps.
//
// Read-only by default — each row renders the current value + source
// + envDefault + audit footer. The "Edit" button opens an inline form
// with the safety-guard ladder:
//
//   1. Reason field required, ≥ 4 chars (server-validated too).
//   2. Bounds shown inline; out-of-range disables Save before the click.
//   3. Visible diff: "30 → 5" with strikethrough on the old value.
//   4. For free_tier_enabled = false, type the verbatim phrase
//      "I understand this stops free AI for everyone".
//   5. For free_tier_daily_usd_cap drops > 75%, type the phrase
//      "I understand this may exhaust free tier today".
//   6. Final "Yes, change it" modal before the actual API call.
//   7. Reset-to-default button on each row (DELETE → revert to env).
//
// Server-side guards (route layer) are the truth — these client-side
// guards just make the wrong action HARD, not impossible.

const KEY_LABEL: Record<SystemConfigKey, string> = {
  free_tier_enabled: "Free tier enabled",
  free_tier_daily_questions: "Daily questions per user",
  free_tier_daily_usd_per_user: "Daily $ per user",
  free_tier_lifetime_usd_per_user: "Lifetime $ per user",
  free_tier_daily_usd_cap: "Daily $ cap (global)",
  // Phase 21C kill switches. Labels read "Block X" so that
  // toggle=Enabled ⇔ "yes, the block is on" ⇔ feature killed,
  // toggle=Disabled ⇔ "the block is off" ⇔ feature working normally
  // (the default state).
  share_public_disabled: "Block public share viewing",
  share_create_disabled: "Block new share creation",
  share_render_disabled: "Block share image rendering",
  share_preview_disabled: "Block crawler share previews",
  // Phase 24B ACI overflow knobs. "Enabled" reads positively (the
  // overflow IS allowed) — opposite of the share kill switches
  // because turning ACI off reduces capacity rather than blocking a
  // feature, so the natural default is "on" (overflow available).
  aci_overflow_enabled: "ACI overflow enabled",
  aci_daily_usd_cap: "ACI daily $ cap",
  aci_max_overflow: "ACI max overflow sessions",
  aci_warm_pool_enabled: "ACI warm pool enabled",
  aci_warm_high_watermark: "ACI warm high watermark",
  aci_warm_low_watermark: "ACI warm low watermark",
  aci_warm_max_pool_size: "ACI warm max pool size",
  // Phase 27-v2.2 Fix 7c — anon trial path kill switch. Reads
  // positively ("Enabled") to match the parent state of the trial:
  // operator wants this ON in normal operation.
  anon_lesson_enabled: "Anon trial path enabled",
  // Phase A — A2: reads as "Block X" like the share kill switches —
  // toggle ON means the handoff is blocked.
  anon_laptop_invite_disabled: "Block phone→laptop magic link",
  // Phase A — A5 operational floor.
  anon_daily_usd_cap: "Anon daily $ cap (global)",
  anon_daily_runs_per_ip: "Anon daily runs per IP",
  ai_eval_sampling_enabled: "Anonymous eval sampling enabled",
};

// Inline help for each row — surfaced as a one-line description so the
// admin doesn't have to remember which kill switch does what at 2am.
const KEY_DESCRIPTION: Partial<Record<SystemConfigKey, string>> = {
  free_tier_enabled:
    "Master availability switch for platform-funded tutoring. BYOK remains separate.",
  free_tier_daily_questions:
    "Maximum platform-funded tutor questions per signed-in learner each UTC day.",
  free_tier_daily_usd_per_user:
    "Per-learner daily platform-AI cost ceiling, evaluated with the question cap.",
  free_tier_lifetime_usd_per_user:
    "Lifetime platform-funded AI allowance for one learner.",
  free_tier_daily_usd_cap:
    "Global daily platform-AI budget shared across eligible signed-in learners.",
  share_public_disabled:
    "503s the public /api/shares/:token GET. Existing shares stop loading; creation still works.",
  share_create_disabled:
    "503s POST /api/shares. New shares blocked; existing shares stay viewable.",
  share_render_disabled:
    "Skips Satori render+upload. Share row still gets created (URL works), images stay null, dialog falls back gracefully.",
  share_preview_disabled:
    "Drains only the authenticated crawler/unfurl metadata route. Human share pages and public reader capacity stay available; crawlers receive safe generic metadata.",
  aci_overflow_enabled:
    "Master gate. When off, demand beyond current local capacity is rejected instead of spilling to ACI. Existing ACI sessions ride out their lifetimes.",
  aci_daily_usd_cap:
    "Cost-cap kill switch. When today's ACI spend ≥ this value, overflow disables for the rest of the UTC day. Resets at midnight UTC. Each ACI session bills at $0.053/hr.",
  aci_max_overflow:
    "Concurrent ACI sessions allowed beyond current local capacity. 0 drains overflow without changing the master switch.",
  aci_warm_pool_enabled:
    "Pre-spawn 1–2 ACI containers when local capacity is close to its cap so the next overflow user gets a sub-second handoff (vs. 5–15s cold start). Off by default — turn on if cold-start latency complaints surface. Hard-capped at 2 idle containers, ~$2.54/day worst-case idle cost; cost-cap kill switch is the absolute backstop.",
  aci_warm_high_watermark:
    "Local-session count that starts proactive ACI warming. Must match the deployed local-capacity shape.",
  aci_warm_low_watermark:
    "Local-session count below which the service stops maintaining the warm pool.",
  aci_warm_max_pool_size:
    "Maximum idle ACI containers retained for faster overflow handoff.",
  anon_lesson_enabled:
    "Master gate for /api/anon/run, /api/anon/ai/ask/stream, and /api/anon-handoff. When off, NEW requests return 503 ANON_LESSON_DISABLED on the next request (60s system_config cache TTL after flip). In-flight tutor SSE streams continue until their 25s upstream deadline. The /try/lesson/... frontend route stays mounted but every API hit fails. Use during abuse spikes, paused-trial windows, or when triaging a platform-key issue.",
  anon_daily_usd_cap:
    "Anon-ONLY daily $ ceiling, independent of and tighter than the global Daily $ cap. When today's anon spend ≥ this value, anon AI 503s (PLATFORM_AI_PAUSED) until UTC midnight while authed free tier keeps its full budget. A viral anon spike can't starve signed-up learners.",
  anon_laptop_invite_disabled:
    "503s POST /api/anon/laptop-link. The phone-graduation dialog falls back to the signup wall, so the funnel keeps a conversion lever. Use to drain magic-link abuse (token enumeration, mail-relay misuse) without killing the whole trial path.",
  anon_daily_runs_per_ip:
    "Per-IP daily cap on /api/anon/run container spawns (the expensive anon op). Bursts are bounded by the 30/min limiter; this stops sustained abuse. Over-cap requests get 429 ANON_RUN_CAP_EXCEEDED until UTC midnight. 0 drains the run surface without killing the whole trial.",
  ai_eval_sampling_enabled:
    "Master switch for new explicitly-consented, redacted 5% anonymous tutor samples. Existing samples still honor deletion and automatic expiry while this is off.",
};

type ConfigGroupId = "learning" | "trial" | "sharing" | "capacity";

const CONFIG_GROUPS: Array<{
  id: ConfigGroupId;
  label: string;
  description: string;
}> = [
  {
    id: "learning",
    label: "Learning AI",
    description: "Availability and spend limits for signed-in tutoring.",
  },
  {
    id: "trial",
    label: "Anonymous trial",
    description: "Public lesson access, abuse limits, handoff, and eval sampling.",
  },
  {
    id: "sharing",
    label: "Public sharing",
    description: "Creation, viewing, rendering, and crawler-preview controls.",
  },
  {
    id: "capacity",
    label: "Runner capacity",
    description: "Azure overflow cost, concurrency, and warm-pool behavior.",
  },
];

const KEY_GROUP: Record<SystemConfigKey, ConfigGroupId> = {
  free_tier_enabled: "learning",
  free_tier_daily_questions: "learning",
  free_tier_daily_usd_per_user: "learning",
  free_tier_lifetime_usd_per_user: "learning",
  free_tier_daily_usd_cap: "learning",
  share_public_disabled: "sharing",
  share_create_disabled: "sharing",
  share_render_disabled: "sharing",
  share_preview_disabled: "sharing",
  aci_overflow_enabled: "capacity",
  aci_daily_usd_cap: "capacity",
  aci_max_overflow: "capacity",
  aci_warm_pool_enabled: "capacity",
  aci_warm_high_watermark: "capacity",
  aci_warm_low_watermark: "capacity",
  aci_warm_max_pool_size: "capacity",
  anon_lesson_enabled: "trial",
  anon_laptop_invite_disabled: "trial",
  anon_daily_usd_cap: "trial",
  anon_daily_runs_per_ip: "trial",
  ai_eval_sampling_enabled: "trial",
};

const KEY_IMPACT: Record<SystemConfigKey, string> = {
  free_tier_enabled: "Can stop or restore platform tutoring for every learner.",
  free_tier_daily_questions: "Changes how many tutor questions each learner gets per UTC day.",
  free_tier_daily_usd_per_user: "Changes each learner's daily platform-AI spend ceiling.",
  free_tier_lifetime_usd_per_user: "Changes each learner's lifetime platform-AI allowance.",
  free_tier_daily_usd_cap: "Changes the global platform-AI daily budget backstop.",
  share_public_disabled: "Can make every existing public share unavailable.",
  share_create_disabled: "Can stop learners from publishing new shares.",
  share_render_disabled: "Changes whether new share images are rendered.",
  share_preview_disabled: "Changes crawler previews without blocking human readers.",
  aci_overflow_enabled: "Controls whether excess runner demand can use paid Azure capacity.",
  aci_daily_usd_cap: "Changes the daily Azure overflow budget backstop.",
  aci_max_overflow: "Changes the maximum number of simultaneous paid overflow runners.",
  aci_warm_pool_enabled: "Can trade idle Azure cost for faster overflow startup.",
  aci_warm_high_watermark: "Changes when proactive overflow warming begins.",
  aci_warm_low_watermark: "Changes when proactive overflow warming winds down.",
  aci_warm_max_pool_size: "Changes the maximum number of idle paid warm runners.",
  anon_lesson_enabled: "Can stop or restore the anonymous first-lesson experience.",
  anon_laptop_invite_disabled: "Can stop or restore phone-to-laptop email handoff.",
  anon_daily_usd_cap: "Changes the anonymous tutor's global daily budget ceiling.",
  anon_daily_runs_per_ip: "Changes how many anonymous sandboxes one IP can start per day.",
  ai_eval_sampling_enabled: "Controls new consented, redacted evaluation sampling only.",
};

const ADMIN_CONFIG_DRAFT_KEY = "codetutor.admin.project-draft.v1";

interface AdminConfigDraft {
  key: SystemConfigKey;
  baseValue: boolean | number;
  draft: boolean | number;
  reason: string;
  phrase: string;
}

function readAdminConfigDraft(): AdminConfigDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(ADMIN_CONFIG_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AdminConfigDraft>;
    if (!parsed.key || !(parsed.key in KEY_LABEL)) return null;
    if (typeof parsed.draft !== "boolean" && typeof parsed.draft !== "number") return null;
    if (typeof parsed.baseValue !== "boolean" && typeof parsed.baseValue !== "number") return null;
    return {
      key: parsed.key,
      baseValue: parsed.baseValue,
      draft: parsed.draft,
      reason: typeof parsed.reason === "string" ? parsed.reason : "",
      phrase: typeof parsed.phrase === "string" ? parsed.phrase : "",
    };
  } catch {
    return null;
  }
}

function writeAdminConfigDraft(draft: AdminConfigDraft): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(ADMIN_CONFIG_DRAFT_KEY, JSON.stringify(draft));
}

function clearAdminConfigDraft(): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(ADMIN_CONFIG_DRAFT_KEY);
}

const PHRASE_DISABLE = "I understand this stops free AI for everyone";
const PHRASE_REDUCE_GLOBAL = "I understand this may exhaust free tier today";
// Phase 27-v2.2 Fix 7c — phrase guard for the anon trial kill switch.
// Mirrors the server-side PHRASE_DISABLE_ANON_LESSON in admin.ts.
const PHRASE_DISABLE_ANON =
  "I understand this stops the anon trial path for everyone";

function fmtValue(v: boolean | number): string {
  if (typeof v === "boolean") return v ? "Enabled" : "Disabled";
  if (Number.isInteger(v)) return v.toString();
  return v.toFixed(2);
}

export function ProjectCapsSection() {
  const [config, setConfig] = useState<Record<SystemConfigKey, SystemConfigEntry> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<SystemConfigKey | null>(
    () => readAdminConfigDraft()?.key ?? null,
  );
  const [query, setQuery] = useState("");

  const refresh = async () => {
    try {
      const r = await api.adminGetSystemConfig();
      setConfig(r.config);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const visibleGroups = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return CONFIG_GROUPS.map((group) => ({
      ...group,
      keys: (Object.keys(KEY_LABEL) as SystemConfigKey[]).filter((key) => {
        if (KEY_GROUP[key] !== group.id) return false;
        if (!needle) return true;
        return [key, KEY_LABEL[key], KEY_DESCRIPTION[key] ?? "", KEY_IMPACT[key], group.label]
          .join(" ")
          .toLocaleLowerCase()
          .includes(needle);
      }),
    })).filter((group) => group.keys.length > 0);
  }, [query]);

  const visibleKeySet = new Set(visibleGroups.flatMap((group) => group.keys));

  if (error && !config) {
    return (
      <AdminLoadFailure
        title="System configuration did not load"
        error={error}
        onRetry={() => void refresh()}
      />
    );
  }
  if (!config) {
    return <div className="text-[11px] text-muted">Loading…</div>;
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">System configuration</h2>
          <p className="mt-0.5 max-w-3xl text-[11px] leading-relaxed text-muted">
            Review mode is read-only. Select Edit for one controlled mutation;
            unfinished edits stay in this browser tab across refresh until you
            save or explicitly discard them.
          </p>
        </div>
        <label className="flex w-full max-w-sm flex-col gap-1 text-[10px] text-muted">
          Find a control
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="min-h-11 rounded-md border border-border bg-bg px-3 py-2 text-xs text-ink"
            placeholder="Search by name, impact, or key"
          />
        </label>
      </div>

      {error && (
        <div role="alert" className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
          Latest refresh failed: {error}. The last confirmed values remain visible.
        </div>
      )}

      {editingKey && !visibleKeySet.has(editingKey) && (
        <div role="status" className="rounded-md border border-accent/30 bg-accent/10 px-3 py-2 text-xs text-accent">
          Your draft for <strong>{KEY_LABEL[editingKey]}</strong> is preserved but
          hidden by this search. Clear the search to continue editing it.
        </div>
      )}

      {visibleGroups.length === 0 ? (
        <div className="rounded-lg border border-border bg-elevated/20 px-4 py-8 text-center text-sm text-muted">
          No controls match “{query}”.
        </div>
      ) : visibleGroups.map((group) => (
        <section key={group.id} aria-labelledby={`config-group-${group.id}`} className="space-y-2">
          <div className="flex items-end justify-between gap-3 border-b border-border pb-2">
            <div>
              <h3 id={`config-group-${group.id}`} className="text-xs font-semibold text-ink">
                {group.label}
              </h3>
              <p className="mt-0.5 text-[10px] text-muted">{group.description}</p>
            </div>
            <span className="text-[10px] text-faint">{group.keys.length} controls</span>
          </div>
          <div className="space-y-2">
            {group.keys.map((key) => (
              <CapRow
                key={key}
                configKey={key}
                entry={config[key]}
                editing={editingKey === key}
                onEdit={() => {
                  if (editingKey && editingKey !== key) clearAdminConfigDraft();
                  setEditingKey(key);
                }}
                onCancel={() => {
                  clearAdminConfigDraft();
                  setEditingKey(null);
                }}
                onSaved={async () => {
                  clearAdminConfigDraft();
                  setEditingKey(null);
                  await refresh();
                }}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

interface CapRowProps {
  configKey: SystemConfigKey;
  entry: SystemConfigEntry;
  editing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSaved: () => Promise<void>;
}

function CapRow({ configKey, entry, editing, onEdit, onCancel, onSaved }: CapRowProps) {
  const bounds = entry.bounds;
  const currentOutsideGuard =
    bounds.type === "number" &&
    (typeof entry.value !== "number" || entry.value < bounds.min || entry.value > bounds.max);
  return (
    <div
      role="group"
      aria-label={`${KEY_LABEL[configKey]} configuration`}
      className="rounded-md border border-border bg-elevated/30 p-3"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[12px] font-semibold text-ink">
            {KEY_LABEL[configKey]}
          </div>
          {KEY_DESCRIPTION[configKey] && (
            <div className="mt-0.5 text-[10px] leading-relaxed text-faint">
              {KEY_DESCRIPTION[configKey]}
            </div>
          )}
          <div className="mt-1 flex items-baseline gap-2 text-[11px]">
            <span className="font-mono text-ink">{fmtValue(entry.value)}</span>
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] ${
                entry.source === "override"
                  ? "bg-accent/15 text-accent ring-1 ring-accent/30"
                  : "bg-muted/15 text-muted ring-1 ring-muted/30"
              }`}
            >
              {entry.source === "override" ? "override" : "env default"}
            </span>
            {entry.source === "override" && (
              <span className="text-[10px] text-faint">
                env: {fmtValue(entry.envDefault)}
              </span>
            )}
          </div>
          {entry.source === "override" && entry.reason && (
            <div className="mt-1 text-[10px] italic text-faint">
              "{entry.reason}" — {entry.setAt?.slice(0, 10)}
            </div>
          )}
          {currentOutsideGuard && (
            <div role="alert" className="mt-2 rounded-md border border-danger/40 bg-danger/10 px-2 py-1.5 text-[10px] leading-relaxed text-danger">
              Current value {fmtValue(entry.value)} is outside the supported
              {bounds.type === "number" ? ` ${bounds.min}–${bounds.max}` : ""} guard.
              Review the deployed environment before relying on this control.
            </div>
          )}
          <div className="mt-2 grid gap-1.5 text-[10px] leading-relaxed sm:grid-cols-2">
            <div className="rounded-md border border-border-soft bg-bg/40 px-2 py-1.5 text-muted">
              <span className="font-semibold text-ink">Impact: </span>
              {KEY_IMPACT[configKey]}
            </div>
            <div className="rounded-md border border-border-soft bg-bg/40 px-2 py-1.5 text-muted">
              <span className="font-semibold text-ink">Rollback: </span>
              Revert to the deployed environment default ({fmtValue(entry.envDefault)}).
            </div>
          </div>
        </div>
        {!editing && (
          <div className="flex shrink-0 gap-1">
            <button
              onClick={onEdit}
              aria-label={`Edit ${KEY_LABEL[configKey]}`}
              className="min-h-11 rounded-md border border-border bg-elevated px-3 py-2 text-[11px] font-semibold text-ink transition hover:border-accent/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Edit
            </button>
            {entry.source === "override" && (
              <ResetButton configKey={configKey} entry={entry} onSaved={onSaved} />
            )}
          </div>
        )}
      </div>
      {editing && <EditForm configKey={configKey} entry={entry} onCancel={onCancel} onSaved={onSaved} />}
    </div>
  );
}

function ResetButton({
  configKey,
  entry,
  onSaved,
}: {
  configKey: SystemConfigKey;
  entry: SystemConfigEntry;
  onSaved: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        aria-label={`Revert ${KEY_LABEL[configKey]} to environment default`}
        className="min-h-11 rounded-md border border-border bg-elevated px-3 py-2 text-[11px] text-muted transition hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        title={`Revert to env default (${fmtValue(entry.envDefault)})`}
      >
        Revert
      </button>
    );
  }
  return (
    <div className="flex items-center gap-1 rounded-md border border-warn/40 bg-warn/10 px-2 py-1 text-[10px] text-warn">
      <span>Revert to {fmtValue(entry.envDefault)}?</span>
      <button
        onClick={async () => {
          setBusy(true);
          try {
            await api.adminClearSystemConfig(configKey);
            await onSaved();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
            setConfirming(false);
          }
        }}
        disabled={busy}
        className="rounded bg-warn px-1.5 py-0.5 font-semibold text-bg disabled:opacity-50"
      >
        Yes
      </button>
      <button
        onClick={() => setConfirming(false)}
        className="rounded px-1 text-warn/80"
      >
        No
      </button>
      {error && <span className="ml-1 text-danger">{error}</span>}
    </div>
  );
}

interface EditFormProps {
  configKey: SystemConfigKey;
  entry: SystemConfigEntry;
  onCancel: () => void;
  onSaved: () => Promise<void>;
}

function EditForm({ configKey, entry, onCancel, onSaved }: EditFormProps) {
  const bounds = entry.bounds;
  const [initialDraft] = useState<AdminConfigDraft>(() => {
    const saved = readAdminConfigDraft();
    return saved?.key === configKey
      ? saved
      : {
          key: configKey,
          baseValue: entry.value,
          draft: entry.value,
          reason: "",
          phrase: "",
        };
  });
  const [baseValue, setBaseValue] = useState<boolean | number>(initialDraft.baseValue);
  const [draft, setDraft] = useState<boolean | number>(initialDraft.draft);
  const [reason, setReason] = useState(initialDraft.reason);
  const [phrase, setPhrase] = useState(initialDraft.phrase);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    writeAdminConfigDraft({ key: configKey, baseValue, draft, reason, phrase });
  }, [baseValue, configKey, draft, phrase, reason]);

  // Determine which (if any) phrase guard is required.
  const requiresDisablePhrase =
    configKey === "free_tier_enabled" && draft === false;
  const requiresReductionPhrase =
    configKey === "free_tier_daily_usd_cap" &&
    typeof draft === "number" &&
    typeof entry.value === "number" &&
    entry.value > 0 &&
    draft < entry.value * 0.25;
  // Phase 27-v2.2 Fix 7c — require phrase only when DISABLING the anon
  // trial path (true → false). Re-enabling is one-click.
  const requiresAnonDisablePhrase =
    configKey === "anon_lesson_enabled" && draft === false;
  const requiredPhrase = requiresDisablePhrase
    ? PHRASE_DISABLE
    : requiresReductionPhrase
      ? PHRASE_REDUCE_GLOBAL
      : requiresAnonDisablePhrase
        ? PHRASE_DISABLE_ANON
        : null;

  // Bounds + reason validity.
  let outOfBounds = false;
  if (bounds.type === "number") {
    const n = typeof draft === "number" ? draft : NaN;
    outOfBounds = !Number.isFinite(n) || n < bounds.min || n > bounds.max;
  }
  const reasonOk = reason.trim().length >= 4;
  const phraseOk = !requiredPhrase || phrase === requiredPhrase;
  const valueChanged = draft !== entry.value;
  const staleDraft = baseValue !== entry.value;
  const canSave =
    !busy && reasonOk && !outOfBounds && phraseOk && valueChanged && !staleDraft;

  const handleSave = async () => {
    if (!canSave) return;
    setBusy(true);
    setError(null);
    try {
      const body: {
        value: boolean | number;
        reason: string;
        confirmDisable?: string;
        confirmReduction?: string;
        confirmAnonDisable?: string;
      } = { value: draft, reason: reason.trim() };
      if (requiresDisablePhrase) body.confirmDisable = PHRASE_DISABLE;
      if (requiresReductionPhrase) body.confirmReduction = PHRASE_REDUCE_GLOBAL;
      if (requiresAnonDisablePhrase) body.confirmAnonDisable = PHRASE_DISABLE_ANON;
      await api.adminSetSystemConfig(configKey, body);
      await onSaved();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
      <div role="status" className="rounded-md border border-accent/25 bg-accent/10 px-2 py-1.5 text-[10px] text-accent">
        Draft saved in this browser tab until you apply or discard it.
      </div>
      {staleDraft && (
        <div role="alert" className="rounded-md border border-warn/40 bg-warn/10 px-2 py-2 text-[10px] leading-relaxed text-warn">
          The live value changed from {fmtValue(baseValue)} to {fmtValue(entry.value)}
          while this draft was open. Review the impact before continuing.
          <button
            type="button"
            onClick={() => setBaseValue(entry.value)}
            className="mt-2 min-h-11 rounded-md border border-warn/40 bg-panel px-3 py-2 font-semibold"
          >
            Use {fmtValue(entry.value)} as the new baseline
          </button>
        </div>
      )}
      <div className="flex items-baseline gap-2 text-[11px]">
        <span className="text-muted">From:</span>
        <span className="font-mono text-faint line-through">
          {fmtValue(entry.value)}
        </span>
        <span className="text-muted">→</span>
        <span className="text-muted">To:</span>
        {bounds.type === "boolean" ? (
          <select
            value={draft ? "true" : "false"}
            onChange={(e) => setDraft(e.target.value === "true")}
            disabled={busy}
            className="min-h-11 rounded border border-border bg-bg px-3 py-2 text-[11px] text-ink"
          >
            <option value="true">Enabled</option>
            <option value="false">Disabled</option>
          </select>
        ) : (
          <input
            type="number"
            min={bounds.min}
            max={bounds.max}
            step={bounds.step}
            value={typeof draft === "number" ? draft : ""}
            onChange={(e) => setDraft(Number(e.target.value))}
            disabled={busy}
            className={`min-h-11 w-24 rounded border bg-bg px-3 py-2 font-mono text-[11px] text-ink ${
              outOfBounds ? "border-danger/60" : "border-border"
            }`}
          />
        )}
        {bounds.type === "number" && (
          <span className="text-[10px] text-faint">
            (range: {bounds.min}–{bounds.max})
          </span>
        )}
      </div>

      {outOfBounds && (
        <div className="text-[10px] text-danger">
          Value out of range. Allowed: {bounds.type === "number" ? `${bounds.min}–${bounds.max}` : "true/false"}.
        </div>
      )}

      <label className="flex flex-col gap-1">
        <span className="text-[10px] font-medium text-muted">
          Reason (visible in audit log){" "}
          <span className="text-faint">— required, 4+ chars</span>
        </span>
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          disabled={busy}
          placeholder="why are you making this change?"
          className="min-h-11 rounded border border-border bg-bg px-3 py-2 text-[11px] text-ink"
        />
      </label>

      {requiredPhrase && (
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-medium text-warn">
            Type-confirm to proceed
          </span>
          <span className="rounded bg-warn/10 px-2 py-1 font-mono text-[10px] text-warn">
            {requiredPhrase}
          </span>
          <input
            type="text"
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            disabled={busy}
            placeholder="type the phrase exactly"
            className={`min-h-11 rounded border bg-bg px-3 py-2 font-mono text-[11px] text-ink ${
              phrase === requiredPhrase ? "border-success/60" : "border-warn/60"
            }`}
          />
        </label>
      )}

      {error && (
        <div className="rounded border border-danger/40 bg-danger/10 px-2 py-1 text-[10px] text-danger">
          {error}
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          onClick={() => setConfirming(true)}
          disabled={!canSave}
          className="min-h-11 rounded-md bg-accent px-4 py-2 text-[11px] font-semibold text-bg transition hover:bg-accent/90 disabled:cursor-not-allowed disabled:bg-elevated disabled:text-faint"
        >
          Save…
        </button>
        <button
          onClick={onCancel}
          disabled={busy}
          className="min-h-11 rounded-md border border-border bg-elevated px-4 py-2 text-[11px] text-muted transition hover:text-ink"
        >
          Discard draft
        </button>
        {!valueChanged && (
          <span className="text-[10px] text-faint">No change.</span>
        )}
      </div>

      {confirming && (
        <ConfirmModal
          title={`Set ${KEY_LABEL[configKey]}?`}
          description={`${KEY_IMPACT[configKey]} Change ${fmtValue(entry.value)} to ${fmtValue(draft)}. Rollback returns to ${fmtValue(entry.envDefault)}.`}
          reason={reason.trim()}
          onCancel={() => setConfirming(false)}
          onConfirm={handleSave}
          busy={busy}
        />
      )}
    </div>
  );
}

function ConfirmModal({
  title,
  description,
  reason,
  onCancel,
  onConfirm,
  busy,
}: {
  title: string;
  description: string;
  reason: string;
  onCancel: () => void;
  onConfirm: () => void;
  busy: boolean;
}) {
  return (
    <Modal
      onClose={onCancel}
      role="alertdialog"
      labelledBy="admin-config-confirm-title"
      describedBy="admin-config-confirm-description"
      position="center"
      panelClassName="w-full max-w-md rounded-xl border border-warn/40 bg-panel p-5 shadow-xl"
    >
        <h3 id="admin-config-confirm-title" className="text-sm font-semibold text-ink">{title}</h3>
        <p id="admin-config-confirm-description" className="mt-2 text-[12px] leading-relaxed text-muted">{description}</p>
        <div className="mt-3 rounded bg-elevated/50 p-2 text-[11px]">
          <span className="text-muted">Reason: </span>
          <span className="text-ink">{reason}</span>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={busy}
            className="min-h-11 rounded-md border border-border bg-elevated px-4 py-2 text-[11px] text-muted transition hover:text-ink"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className="min-h-11 rounded-md bg-warn px-4 py-2 text-[11px] font-semibold text-bg transition hover:bg-warn/90 disabled:opacity-50"
          >
            {busy ? "Saving…" : "Yes, change it"}
          </button>
        </div>
    </Modal>
  );
}
