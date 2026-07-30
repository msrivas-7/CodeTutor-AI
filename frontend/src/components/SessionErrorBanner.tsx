import { useState } from "react";
import { api } from "../api/client";
import { useSessionStore } from "../state/sessionStore";
import { usePreferencesStore } from "../state/preferencesStore";

// When heartbeat fails past MAX_FAILURES or rebind throws, session.phase
// goes to "error" and the Run button silently greys out. Without this
// banner the learner has no idea why Run doesn't work or how to recover —
// they just see a dead button. Rendered inline by EditorPage/LessonPage
// below their headers.
export function SessionErrorBanner() {
  const { phase, error, setPhase, setSession, setError } = useSessionStore();
  const accountFrozen = usePreferencesStore((s) => s.accountFrozen);
  const [retrying, setRetrying] = useState(false);

  if (phase === "starting") {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex items-center gap-3 border-b border-accent/25 bg-accent/10 px-4 py-2 text-xs text-accent"
      >
        <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-accent" aria-hidden="true" />
        <div>
          <span className="font-semibold">Preparing your secure runner.</span>{" "}
          <span className="text-muted">The first launch can take around 20 seconds.</span>
        </div>
      </div>
    );
  }
  if (phase !== "error") return null;
  // Phase 25: frozen accounts get the FrozenAccountBanner at the top of
  // every authed page already — a stacked "Session lost / Retry" banner
  // would be confusing AND the Retry button is useless (the 403 will
  // repeat). Skip rendering this banner; the freeze banner is the only
  // explanation the learner needs.
  if (accountFrozen) return null;

  const retry = async () => {
    setRetrying(true);
    setError(null);
    setPhase("starting");
    try {
      const { sessionId } = await api.startSession();
      setSession(sessionId);
    } catch (err) {
      // QA-C3: setError no longer flips phase; do both explicitly so the
      // banner stays up (phase==="error") instead of dropping back to
      // "starting" while the underlying session is still missing.
      setError((err as Error).message);
      setPhase("error");
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div
      role="alert"
      className="flex items-center gap-3 border-b border-danger/30 bg-danger/10 px-4 py-2 text-xs text-danger"
    >
      <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <div className="min-w-0 flex-1">
        <div className="font-semibold">Session lost</div>
        <div className="truncate text-[11px] opacity-80">
          {error || "Couldn't reach the code runner."} Retry in a moment, or refresh if the problem persists.
        </div>
      </div>
      <button
        onClick={retry}
        disabled={retrying}
        className="inline-flex min-h-11 shrink-0 items-center rounded-md bg-danger/20 px-3 py-2 text-sm font-semibold text-danger ring-1 ring-danger/40 transition hover:bg-danger/30 disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-danger"
      >
        {retrying ? "Retrying…" : "Retry"}
      </button>
    </div>
  );
}
