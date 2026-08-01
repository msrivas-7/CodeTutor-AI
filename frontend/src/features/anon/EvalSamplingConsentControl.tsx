import { useCallback, useEffect, useId, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import {
  clearStoredEvalSamplingConsent,
  enableEvalSampling,
  markEvalSamplingDeletionPending,
  readStoredEvalSamplingConsent,
  type StoredEvalSamplingConsent,
} from "./evalSamplingConsent";

export function EvalSamplingConsentControl() {
  const inputId = useId();
  const descriptionId = `${inputId}-description`;
  const [consent, setConsent] = useState<StoredEvalSamplingConsent | null>(() =>
    readStoredEvalSamplingConsent(),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const finishDeletion = useCallback(async (pending: StoredEvalSamplingConsent) => {
    setBusy(true);
    setError(null);
    try {
      await api.deleteAnonEvalSamples(pending.subjectToken);
      if (!clearStoredEvalSamplingConsent()) {
        throw new Error("storage unavailable");
      }
      setConsent(null);
    } catch {
      setConsent(pending);
      setError("New turns are off. We couldn’t finish deleting earlier samples yet.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (consent?.deletionPending && !busy) void finishDeletion(consent);
  }, []); // retry once on mount; later retries are explicit

  const handleChange = async (checked: boolean) => {
    if (checked) {
      setError(null);
      const enabled = enableEvalSampling();
      if (!enabled) {
        setError("Your browser blocked this preference, so sharing stays off.");
        return;
      }
      setConsent(enabled);
      return;
    }

    const pending = markEvalSamplingDeletionPending();
    if (!pending) {
      setConsent(null);
      return;
    }
    setConsent(pending);
    await finishDeletion(pending);
  };

  const enabled = consent?.enabled === true && !consent.deletionPending;

  return (
    <div
      data-testid="eval-sampling-consent"
      className="relative mb-1 flex min-h-11 items-center gap-2 rounded-lg border border-border/80 bg-elevated/45 px-2.5 py-1.5"
    >
      <label
        htmlFor={inputId}
        className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-2.5"
      >
        <input
          id={inputId}
          type="checkbox"
          checked={enabled}
          disabled={busy}
          aria-describedby={descriptionId}
          onChange={(event) => void handleChange(event.target.checked)}
          className="h-4 w-4 shrink-0 cursor-pointer accent-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-wait"
        />
        <span className="min-w-0 truncate text-xs font-medium text-ink">
          Improve tutor <span id={descriptionId} className="font-normal text-muted">· optional, redacted</span>
        </span>
      </label>

      <details className="group shrink-0 text-[11px] leading-4 text-muted">
        <summary className="flex min-h-11 cursor-pointer list-none items-center rounded-lg px-2 text-accentMuted underline decoration-accentMuted/40 underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
          Privacy
        </summary>
        <div className="absolute bottom-[calc(100%+0.375rem)] left-0 right-0 z-30 rounded-xl border border-border bg-panel p-3 text-xs leading-relaxed text-muted shadow-2xl">
          <p>
            Off by default. If enabled, 5% of anonymous turns may be kept for up to 30 days after personal details are removed. Files, code, paths, output, and raw history are never stored. Turning this off deletes retained samples. BYOK chats are excluded.
          </p>
          <Link
            className="mt-2 inline-flex min-h-11 items-center font-semibold text-accentMuted underline underline-offset-2"
            to="/privacy#ai"
            target="_blank"
            rel="noopener noreferrer"
          >
            Open full privacy details
          </Link>
        </div>
      </details>

      <div className="absolute bottom-full left-0 right-0 mb-1 text-[11px] leading-4" aria-live="polite">
        {busy ? (
          <span className="text-muted">Turning off and deleting retained samples…</span>
        ) : error ? (
          <span className="text-danger">
            {error}{" "}
            {consent?.deletionPending && (
              <button
                type="button"
                onClick={() => void finishDeletion(consent)}
                className="min-h-11 cursor-pointer font-semibold underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger"
              >
                Retry deletion
              </button>
            )}
          </span>
        ) : enabled ? (
          <span className="text-ink">Enabled. You can turn it off here at any time.</span>
        ) : null}
      </div>
    </div>
  );
}
