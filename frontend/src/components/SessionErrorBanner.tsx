import { useState } from "react";
import { api } from "../api/client";
import { useSessionStore } from "../state/sessionStore";

// When heartbeat fails past MAX_FAILURES or rebind throws, session.phase
// goes to "error" and the Run button silently greys out. Without this
// banner the learner has no idea why Run doesn't work or how to recover —
// they just see a dead button. Rendered inline by EditorPage/LessonPage
// below their headers.
export function SessionErrorBanner() {
  const { phase, error, setPhase, setSession, setError } = useSessionStore();
  const [retrying, setRetrying] = useState(false);

  if (phase !== "error") return null;

  const retry = async () => {
    setRetrying(true);
    setError(null);
    setPhase("starting");
    try {
      const { sessionId } = await api.startSession();
      setSession(sessionId);
    } catch (err) {
      setError((err as Error).message);
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
          {error || "Couldn't reach the code runner."} Check that Docker is running, then retry.
        </div>
      </div>
      <button
        onClick={retry}
        disabled={retrying}
        className="shrink-0 rounded-md bg-danger/20 px-3 py-1 text-[11px] font-semibold text-danger ring-1 ring-danger/40 transition hover:bg-danger/30 disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-danger"
      >
        {retrying ? "Retrying…" : "Retry"}
      </button>
    </div>
  );
}
