import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  type AdminTutorModelCandidate,
  type AdminTutorModelState,
} from "../../api/client";
import { Modal } from "../Modal";
import { AdminLoadFailure } from "./AdminLoadFailure";

function money(value: number): string {
  return `$${value.toFixed(2)}`;
}

function multiplierLabel(value: number | null, baselineModel: string): string {
  if (value === null) return "price unavailable";
  return `${Number(value.toFixed(2))}× ${baselineModel}`;
}

export function TutorModelControl() {
  const [state, setState] = useState<AdminTutorModelState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [reason, setReason] = useState("");
  const [costAccepted, setCostAccepted] = useState(false);
  const [confirming, setConfirming] = useState<"change" | "revert" | null>(null);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const reviewButtonRef = useRef<HTMLButtonElement>(null);
  const revertButtonRef = useRef<HTMLButtonElement>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await api.adminGetTutorModel();
      setState(next);
      setSelectedId(next.current.model);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selected = useMemo(
    () => state?.candidates.find((candidate) => candidate.id === selectedId) ?? null,
    [selectedId, state],
  );
  const costsMore = (selected?.costMultiplierVsRecommended ?? 0) > 1;
  const changed = Boolean(state && selectedId !== state.current.model);
  const canSave = Boolean(
    selected?.selectable &&
    changed &&
    reason.trim().length >= 4 &&
    (!costsMore || costAccepted) &&
    !busy,
  );

  const resetDraft = () => {
    if (state) setSelectedId(state.current.model);
    setReason("");
    setCostAccepted(false);
    setEditing(false);
    setConfirming(null);
  };

  const closeConfirmation = () => {
    const trigger = confirming === "revert" ? revertButtonRef.current : reviewButtonRef.current;
    setConfirming(null);
    window.requestAnimationFrame(() => trigger?.focus({ preventScroll: true }));
  };

  const save = async () => {
    if (!state || !selected || !canSave) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await api.adminSetTutorModel({
        model: selected.id,
        reason: reason.trim(),
        expectedSetAt: state.current.setAt,
        ...(costsMore ? { confirmCostImpact: true as const } : {}),
      });
      setState((currentState) => currentState
        ? { ...currentState, current: result.current }
        : currentState);
      setSelectedId(result.current.model);
      setReason("");
      setCostAccepted(false);
      setEditing(false);
      setConfirming(null);
      setSuccess(
        `${result.current.model} was applied successfully. This backend is updated now; any other running backend instances can take up to 60 seconds to refresh.`,
      );
    } catch (caught) {
      setError((caught as Error).message);
      setConfirming(null);
    } finally {
      setBusy(false);
    }
  };

  const revert = async () => {
    if (!state || reason.trim().length < 4) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await api.adminClearTutorModel({
        reason: reason.trim(),
        expectedSetAt: state.current.setAt,
      });
      setState((currentState) => currentState
        ? { ...currentState, current: result.current }
        : currentState);
      setSelectedId(result.current.model);
      setReason("");
      setCostAccepted(false);
      setEditing(false);
      setConfirming(null);
      setSuccess(
        `${result.current.model} was restored successfully. This backend is updated now; any other running backend instances can take up to 60 seconds to refresh.`,
      );
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (loading && !state) {
    return (
      <section aria-label="Platform Tutor model" className="rounded-lg border border-border bg-elevated/30 p-4">
        <div className="h-4 w-48 animate-pulse rounded bg-border" />
        <div className="mt-3 h-16 animate-pulse rounded-md bg-border/50" />
      </section>
    );
  }
  if (!state) {
    return (
      <AdminLoadFailure
        title="Tutor model configuration unavailable"
        error={error ?? "The current platform Tutor model could not be loaded."}
        onRetry={() => void refresh()}
      />
    );
  }

  const currentCandidate = state.candidates.find(
    (candidate) => candidate.id === state.current.model,
  );

  return (
    <section
      aria-labelledby="platform-tutor-model-title"
      aria-busy={busy}
      className="rounded-lg border border-accent/25 bg-elevated/30 p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="platform-tutor-model-title" className="text-sm font-semibold text-ink">
              Platform Tutor model
            </h2>
            <span className="rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-[10px] font-semibold text-accent">
              server controlled
            </span>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-muted">
            One setting controls CodeTutor-funded Tutor turns everywhere. BYOK learners keep their own model choice.
          </p>
        </div>
        {!editing && (
          <button
            type="button"
            onClick={() => {
              setSuccess(null);
              setEditing(true);
            }}
            disabled={busy}
            className="min-h-11 rounded-md border border-border bg-panel px-4 py-2 text-[11px] font-semibold text-ink transition hover:border-accent/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Change model
          </button>
        )}
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div className="rounded-md border border-border-soft bg-bg/40 px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[12px] font-semibold text-ink">
              {currentCandidate?.label ?? state.current.model}
            </span>
            <span className={`rounded px-1.5 py-0.5 text-[10px] ${
              state.current.source === "override"
                ? "bg-warn/15 text-warn ring-1 ring-warn/30"
                : "bg-success/10 text-success ring-1 ring-success/30"
            }`}>
              {state.current.source}
            </span>
          </div>
          <p className="mt-1 text-[10px] text-faint">
            {state.current.source === "fallback"
              ? `${state.fallbackModel} is the compiled safe fallback when no override exists or configuration cannot be read.`
              : `Changed ${state.current.setAt?.slice(0, 10) ?? "recently"}${state.current.reason ? ` — ${state.current.reason}` : ""}`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading || busy}
          className="min-h-11 rounded-md border border-border px-3 py-2 text-[11px] text-muted hover:text-ink disabled:opacity-50"
        >
          {loading ? "Refreshing…" : "Refresh models"}
        </button>
      </div>

      {state.discoveryError && (
        <div role="status" className="mt-3 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-[11px] text-warn">
          {state.discoveryError} The active model remains unchanged.
        </div>
      )}
      {error && (
        <div role="alert" className="mt-3 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-[11px] text-danger">
          {error.includes("409") || error.includes("STALE")
            ? "Another admin changed this setting. Refresh the model list before trying again."
            : error}
        </div>
      )}
      {success && (
        <div role="status" aria-live="polite" className="mt-3 rounded-md border border-success/40 bg-success/10 px-3 py-2 text-[11px] leading-relaxed text-success">
          {success}
        </div>
      )}

      {editing && (
        <div className="mt-4 space-y-3 border-t border-border pt-4">
          <label className="flex flex-col gap-1.5 text-[11px] font-medium text-muted">
            Model
            <select
              value={selectedId}
              disabled={busy}
              onChange={(event) => {
                setSelectedId(event.target.value);
                setCostAccepted(false);
              }}
              className="min-h-11 w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-xs text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {state.candidates.map((candidate) => (
                <option
                  key={candidate.id}
                  value={candidate.id}
                  disabled={!candidate.selectable}
                >
                  {candidate.label}{candidate.selectable ? "" : " — pricing unavailable"}
                </option>
              ))}
            </select>
          </label>

          {selected && (
            <div className="grid gap-2 sm:grid-cols-3">
              <PriceStat label="Input / 1M" value={selected.priceUsdPerMillion ? money(selected.priceUsdPerMillion.input) : "—"} />
              <PriceStat label="Output / 1M" value={selected.priceUsdPerMillion ? money(selected.priceUsdPerMillion.output) : "—"} />
              <PriceStat label="Upper token rate" value={multiplierLabel(selected.costMultiplierVsRecommended, state.fallbackModel)} />
            </div>
          )}

          {selected && selected.qualityStatus !== "evaluated" && (
            <div role="status" className="rounded-md border border-warn/35 bg-warn/10 px-3 py-2 text-[10px] leading-relaxed text-warn">
              This GPT-5 model is API-compatible but has not completed CodeTutor's Tutor-specific quality suite. Monitor teaching quality after activation.
            </div>
          )}

          {costsMore && selected && (
            <label className="flex min-h-11 items-start gap-3 rounded-md border border-warn/45 bg-warn/10 px-3 py-2 text-[11px] leading-relaxed text-warn">
              <input
                type="checkbox"
                checked={costAccepted}
                disabled={busy}
                onChange={(event) => setCostAccepted(event.target.checked)}
                className="mt-0.5 h-4 w-4 accent-current"
              />
              <span>
                I accept that <strong>{selected.id}</strong> can cost up to{" "}
                <strong>{multiplierLabel(selected.costMultiplierVsRecommended, state.fallbackModel)}</strong>{" "}
                per token compared with the recommended model.
              </span>
            </label>
          )}

          <label className="flex flex-col gap-1.5 text-[11px] font-medium text-muted">
            Reason <span className="text-[10px] font-normal text-faint">Required; stored in the audit log.</span>
            <input
              type="text"
              value={reason}
              disabled={busy}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Why is this model changing?"
              className="min-h-11 rounded-md border border-border bg-bg px-3 py-2 text-xs text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <button
              ref={reviewButtonRef}
              type="button"
              onClick={() => setConfirming("change")}
              disabled={!canSave}
              className="min-h-11 rounded-md bg-accent px-4 py-2 text-[11px] font-semibold text-bg disabled:cursor-not-allowed disabled:bg-elevated disabled:text-faint"
            >
              Review change…
            </button>
            {state.current.source === "override" && (
              <button
                ref={revertButtonRef}
                type="button"
                onClick={() => setConfirming("revert")}
                disabled={busy || reason.trim().length < 4}
                className="min-h-11 rounded-md border border-warn/40 px-4 py-2 text-[11px] font-semibold text-warn disabled:opacity-40"
              >
                Revert to {state.fallbackModel}
              </button>
            )}
            <button
              type="button"
              onClick={resetDraft}
              disabled={busy}
              className="min-h-11 rounded-md border border-border px-4 py-2 text-[11px] text-muted hover:text-ink"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {confirming && selected && (
        <Modal
          onClose={() => {
            if (!busy) closeConfirmation();
          }}
          role="alertdialog"
          labelledBy="tutor-model-confirm-title"
          describedBy="tutor-model-confirm-description"
          position="center"
          panelClassName="w-full max-w-md rounded-xl border border-warn/40 bg-panel p-5 shadow-xl"
        >
          <h3 id="tutor-model-confirm-title" className="text-sm font-semibold text-ink">
            {confirming === "revert"
              ? `Revert to ${state.fallbackModel}?`
              : "Change the platform Tutor model?"}
          </h3>
          <p id="tutor-model-confirm-description" className="mt-2 text-[12px] leading-relaxed text-muted">
            {confirming === "revert" ? (
              <>The operator override will be removed. New CodeTutor-funded Tutor turns will use <strong>{state.fallbackModel}</strong> after the backend cache refreshes. BYOK choices are unchanged.</>
            ) : (
              <>New CodeTutor-funded Tutor turns will move from <strong>{state.current.model}</strong> to <strong>{selected.id}</strong> after the backend cache refreshes. BYOK choices are unchanged.</>
            )}
          </p>
          <div className="mt-3 rounded-md border border-border bg-elevated/50 p-3 text-[11px] text-muted">
            {confirming === "change" && (
              <>Cost ceiling: <strong className="text-ink">{multiplierLabel(selected.costMultiplierVsRecommended, state.fallbackModel)}</strong><br /></>
            )}
            Reason: <strong className="text-ink">{reason.trim()}</strong>
          </div>
          {busy && (
            <div role="status" aria-live="polite" className="mt-3 flex items-start gap-2 rounded-md border border-accent/35 bg-accent/10 px-3 py-2 text-[11px] leading-relaxed text-accent">
              <span aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-accent/30 border-t-accent" />
              <span>
                {confirming === "revert"
                  ? "Reverting and propagating the platform Tutor model policy. Keep this window open until confirmation."
                  : "Applying and propagating the platform Tutor model policy. Keep this window open until confirmation."}
              </span>
            </div>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={closeConfirmation}
              disabled={busy}
              className="min-h-11 rounded-md border border-border px-4 py-2 text-[11px] text-muted"
            >
              Keep current
            </button>
            <button
              type="button"
              onClick={() => void (confirming === "revert" ? revert() : save())}
              disabled={busy}
              className="min-h-11 rounded-md bg-warn px-4 py-2 text-[11px] font-semibold text-bg disabled:opacity-50"
            >
              {busy
                ? (confirming === "revert" ? "Reverting…" : "Changing…")
                : (confirming === "revert" ? "Yes, revert" : "Yes, change model")}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}

function PriceStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border-soft bg-bg/40 px-3 py-2">
      <div className="text-[9px] uppercase tracking-[0.12em] text-faint">{label}</div>
      <div className="mt-1 font-mono text-[12px] font-semibold text-ink">{value}</div>
    </div>
  );
}
