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
      className="mb-2 rounded-lg border border-border/80 bg-elevated/45 px-2.5 py-2"
    >
      <label
        htmlFor={inputId}
        className="flex min-h-11 cursor-pointer items-center gap-2.5"
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
        <span className="min-w-0">
          <span className="block text-xs font-semibold text-ink">Help improve the tutor</span>
          <span id={descriptionId} className="mt-0.5 block text-[11px] leading-4 text-muted">
            Off by default. Share 5% of redacted anonymous turns for up to 30 days.
          </span>
        </span>
      </label>

      <details className="ml-6 text-[11px] leading-4 text-muted">
        <summary className="min-h-11 cursor-pointer py-3 text-accentMuted underline decoration-accentMuted/40 underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
          What is shared?
        </summary>
        <p className="pb-2 pr-1">
          Files, source code, selections, terminal output, paths, and raw history are never
          stored. Personal details and identifiers are removed before saving. Turn this off
          to delete retained samples. BYOK chats are excluded. Read the{" "}
          <Link className="text-accentMuted underline underline-offset-2" to="/privacy#ai">
            privacy details
          </Link>
          .
        </p>
      </details>

      <div className="ml-6 min-h-4 text-[11px] leading-4" aria-live="polite">
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
