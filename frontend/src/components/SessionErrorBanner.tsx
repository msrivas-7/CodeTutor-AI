import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useSessionStore } from "../state/sessionStore";
import { usePreferencesStore } from "../state/preferencesStore";
import { ApiError } from "../api/ApiError";

// When heartbeat fails past MAX_FAILURES or rebind throws, session.phase
// goes to "error" and the Run button silently greys out. Without this
// banner the learner has no idea why Run doesn't work or how to recover —
// they just see a dead button. Rendered inline by EditorPage/LessonPage
// below their headers.
export function SessionErrorBanner() {
  const {
    phase,
    error,
    retryAvailableAt,
    canResumeExisting,
    setPhase,
    setSession,
    setError,
    setRecoveryOptions,
  } = useSessionStore();
  const accountFrozen = usePreferencesStore((s) => s.accountFrozen);
  const [retrying, setRetrying] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!retryAvailableAt || retryAvailableAt <= Date.now()) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [retryAvailableAt]);

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
    if (retryAvailableAt && retryAvailableAt > Date.now()) return;
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
      const retrySeconds =
        err instanceof ApiError
          ? err.retryAfterSeconds ?? (err.status === 429 ? 5 : 0)
          : 0;
      setRecoveryOptions(
        retrySeconds > 0 ? Date.now() + retrySeconds * 1_000 : null,
        err instanceof ApiError && (err.status === 429 || err.status === 503),
      );
      setError(
        err instanceof ApiError && err.status === 429
          ? "Your account already has active runners, or a recent runner is still closing."
          : (err as Error).message,
      );
      setPhase("error");
    } finally {
      setRetrying(false);
    }
  };

  const resume = async () => {
    setRetrying(true);
    setError(null);
    setPhase("starting");
    try {
      const { sessionId } = await api.resumeSession();
      setSession(sessionId);
    } catch (err) {
      setError((err as Error).message);
      setRecoveryOptions(retryAvailableAt, false);
      setPhase("error");
    } finally {
      setRetrying(false);
    }
  };

  const retrySeconds = retryAvailableAt
    ? Math.max(0, Math.ceil((retryAvailableAt - now) / 1_000))
    : 0;

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
        <div className="font-semibold">
          {canResumeExisting ? "Runner capacity reached" : "Runner unavailable"}
        </div>
        <div className="text-sm opacity-85">
          {error || "Couldn't reach the code runner."}{" "}
          {retrySeconds > 0
            ? `You can create a new runner in ${retrySeconds}s.`
            : "Your code is still here; retry when you're ready."}
        </div>
      </div>
      {canResumeExisting && (
        <button
          onClick={resume}
          disabled={retrying}
          className="inline-flex min-h-11 shrink-0 items-center rounded-md border border-danger/40 px-3 py-2 text-sm font-semibold text-danger transition hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-danger"
        >
          Use active runner
        </button>
      )}
      <button
        onClick={retry}
        disabled={retrying || retrySeconds > 0}
        className="inline-flex min-h-11 shrink-0 items-center rounded-md bg-danger/20 px-3 py-2 text-sm font-semibold text-danger ring-1 ring-danger/40 transition hover:bg-danger/30 disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-danger"
      >
        {retrying ? "Connecting…" : retrySeconds > 0 ? `Retry in ${retrySeconds}s` : "New runner"}
      </button>
    </div>
  );
}
