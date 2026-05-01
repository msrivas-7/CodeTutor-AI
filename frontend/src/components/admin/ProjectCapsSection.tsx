import { useEffect, useState } from "react";
import {
  api,
  type SystemConfigEntry,
  type SystemConfigKey,
} from "../../api/client";

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
};

// Inline help for each row — surfaced as a one-line description so the
// admin doesn't have to remember which kill switch does what at 2am.
const KEY_DESCRIPTION: Partial<Record<SystemConfigKey, string>> = {
  share_public_disabled:
    "503s the public /api/shares/:token GET. Existing shares stop loading; creation still works.",
  share_create_disabled:
    "503s POST /api/shares. New shares blocked; existing shares stay viewable.",
  share_render_disabled:
    "Skips Satori render+upload. Share row still gets created (URL works), images stay null, dialog falls back gracefully.",
  aci_overflow_enabled:
    "Master gate. When off, the 15th+ concurrent session 503s instead of spilling over to ACI. Existing ACI sessions ride out their lifetimes. No new ACI cost while off.",
  aci_daily_usd_cap:
    "Cost-cap kill switch. When today's ACI spend ≥ this value, overflow disables for the rest of the UTC day. Resets at midnight UTC. Each ACI session bills at $0.053/hr.",
  aci_max_overflow:
    "Concurrent ACI sessions allowed past the local cap of 14. 0 = effectively off (overflow returns 503). Higher values let an HN-spike route many sessions through ACI before the daily cap intervenes.",
  aci_warm_pool_enabled:
    "Pre-spawn 1–2 ACI containers when local capacity is close to its cap so the next overflow user gets a sub-second handoff (vs. 5–15s cold start). Off by default — turn on if cold-start latency complaints surface. Hard-capped at 2 idle containers, ~$2.54/day worst-case idle cost; cost-cap kill switch is the absolute backstop.",
};

const KEY_BOUNDS: Record<
  SystemConfigKey,
  { type: "number"; min: number; max: number; step: string } | { type: "boolean" }
> = {
  free_tier_enabled: { type: "boolean" },
  free_tier_daily_questions: { type: "number", min: 0, max: 10000, step: "1" },
  free_tier_daily_usd_per_user: { type: "number", min: 0, max: 10, step: "0.01" },
  free_tier_lifetime_usd_per_user: { type: "number", min: 0, max: 100, step: "0.01" },
  free_tier_daily_usd_cap: { type: "number", min: 0, max: 50, step: "0.01" },
  share_public_disabled: { type: "boolean" },
  share_create_disabled: { type: "boolean" },
  share_render_disabled: { type: "boolean" },
  aci_overflow_enabled: { type: "boolean" },
  aci_daily_usd_cap: { type: "number", min: 0, max: 100, step: "1" },
  aci_max_overflow: { type: "number", min: 0, max: 50, step: "1" },
  aci_warm_pool_enabled: { type: "boolean" },
  aci_warm_high_watermark: { type: "number", min: 0, max: 14, step: "1" },
  aci_warm_low_watermark: { type: "number", min: 0, max: 14, step: "1" },
  aci_warm_max_pool_size: { type: "number", min: 0, max: 10, step: "1" },
};

const PHRASE_DISABLE = "I understand this stops free AI for everyone";
const PHRASE_REDUCE_GLOBAL = "I understand this may exhaust free tier today";

function fmtValue(v: boolean | number): string {
  if (typeof v === "boolean") return v ? "Enabled" : "Disabled";
  if (Number.isInteger(v)) return v.toString();
  return v.toFixed(2);
}

export function ProjectCapsSection() {
  const [config, setConfig] = useState<Record<SystemConfigKey, SystemConfigEntry> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<SystemConfigKey | null>(null);

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

  if (error) {
    return (
      <div className="rounded-md border border-danger/40 bg-danger/10 p-3 text-[11px] text-danger">
        Failed to load: {error}
      </div>
    );
  }
  if (!config) {
    return <div className="text-[11px] text-muted">Loading…</div>;
  }

  return (
    <div className="flex flex-col gap-2">
      {(Object.keys(KEY_LABEL) as SystemConfigKey[]).map((k) => (
        <CapRow
          key={k}
          configKey={k}
          entry={config[k]}
          editing={editingKey === k}
          onEdit={() => setEditingKey(k)}
          onCancel={() => setEditingKey(null)}
          onSaved={async () => {
            setEditingKey(null);
            await refresh();
          }}
        />
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
  return (
    <div className="rounded-md border border-border bg-elevated/30 p-3">
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
        </div>
        {!editing && (
          <div className="flex shrink-0 gap-1">
            <button
              onClick={onEdit}
              className="rounded-md border border-border bg-elevated px-2.5 py-1 text-[11px] font-semibold text-ink transition hover:border-accent/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
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
        className="rounded-md border border-border bg-elevated px-2.5 py-1 text-[11px] text-muted transition hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
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
  const bounds = KEY_BOUNDS[configKey];
  const [draft, setDraft] = useState<boolean | number>(entry.value);
  const [reason, setReason] = useState("");
  const [phrase, setPhrase] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Determine which (if any) phrase guard is required.
  const requiresDisablePhrase =
    configKey === "free_tier_enabled" && draft === false;
  const requiresReductionPhrase =
    configKey === "free_tier_daily_usd_cap" &&
    typeof draft === "number" &&
    typeof entry.value === "number" &&
    entry.value > 0 &&
    draft < entry.value * 0.25;
  const requiredPhrase = requiresDisablePhrase
    ? PHRASE_DISABLE
    : requiresReductionPhrase
      ? PHRASE_REDUCE_GLOBAL
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
  const canSave =
    !busy && reasonOk && !outOfBounds && phraseOk && valueChanged;

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
      } = { value: draft, reason: reason.trim() };
      if (requiresDisablePhrase) body.confirmDisable = PHRASE_DISABLE;
      if (requiresReductionPhrase) body.confirmReduction = PHRASE_REDUCE_GLOBAL;
      await api.adminSetSystemConfig(configKey, body);
      await onSaved();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
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
            className="rounded border border-border bg-bg px-2 py-1 text-[11px] text-ink"
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
            className={`w-24 rounded border bg-bg px-2 py-1 font-mono text-[11px] text-ink ${
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
          className="rounded border border-border bg-bg px-2 py-1 text-[11px] text-ink"
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
            className={`rounded border bg-bg px-2 py-1 font-mono text-[11px] text-ink ${
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
          className="rounded-md bg-accent px-3 py-1 text-[11px] font-semibold text-bg transition hover:bg-accent/90 disabled:cursor-not-allowed disabled:bg-elevated disabled:text-faint"
        >
          Save…
        </button>
        <button
          onClick={onCancel}
          disabled={busy}
          className="rounded-md border border-border bg-elevated px-3 py-1 text-[11px] text-muted transition hover:text-ink"
        >
          Cancel
        </button>
        {!valueChanged && (
          <span className="text-[10px] text-faint">No change.</span>
        )}
      </div>

      {confirming && (
        <ConfirmModal
          title={`Set ${KEY_LABEL[configKey]}?`}
          description={`This affects ALL users on the next AI call. From ${fmtValue(entry.value)} to ${fmtValue(draft)}.`}
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="w-full max-w-md rounded-lg border border-warn/40 bg-panel p-5 shadow-xl">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        <p className="mt-2 text-[12px] leading-relaxed text-muted">{description}</p>
        <div className="mt-3 rounded bg-elevated/50 p-2 text-[11px]">
          <span className="text-muted">Reason: </span>
          <span className="text-ink">{reason}</span>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={busy}
            className="rounded-md border border-border bg-elevated px-3 py-1 text-[11px] text-muted transition hover:text-ink"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className="rounded-md bg-warn px-3 py-1 text-[11px] font-semibold text-bg transition hover:bg-warn/90 disabled:opacity-50"
          >
            {busy ? "Saving…" : "Yes, change it"}
          </button>
        </div>
      </div>
    </div>
  );
}
