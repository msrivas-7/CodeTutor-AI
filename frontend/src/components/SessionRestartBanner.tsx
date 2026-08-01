import { useSessionStore } from "../state/sessionStore";

// Phase 20-P0 #6: surface a one-shot notice when a rebind returned
// reused=false (backend restart / sweeper reaped the runner). The
// frontend's projectStore re-snapshots code on each Run so the happy path
// survives the reset, but in-runner state (built artifacts, prior stdout
// buffer, any files the user created via the runner shell) is gone. We
// render a dismissible yellow banner explaining what happened so the
// learner doesn't silently lose work and wonder what changed.
//
// Not a sibling of SessionErrorBanner — the two are orthogonal states:
// restart is informational, phase=error is blocking. Render both in the
// same slot (EditorPage / LessonPage header) and they stack cleanly.
export function SessionRestartBanner() {
  const sessionRestarted = useSessionStore((s) => s.sessionRestarted);
  const setSessionRestarted = useSessionStore((s) => s.setSessionRestarted);
  const phase = useSessionStore((s) => s.phase);

  // Suppress while an error banner is showing — two full-width banners
  // stacked is noise, and the error case dominates.
  if (!sessionRestarted || phase === "error") return null;

  return (
    <div
      role="status"
      className="flex min-h-11 items-center gap-3 border-b border-warn/30 bg-warn/10 px-4 py-2 text-sm text-warnInk"
    >
      <svg
        className="h-4 w-4 shrink-0"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M23 4v6h-6" />
        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
      </svg>
      <div className="min-w-0 flex-1">
        Your code runner was reset. Your saved code is fine — next Run will
        spin it back up.
      </div>
      <button
        onClick={() => setSessionRestarted(false)}
        className="min-h-11 shrink-0 rounded-lg bg-warn/20 px-3 py-2 text-sm font-semibold text-warnInk ring-1 ring-warn/40 transition hover:bg-warn/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-warn"
      >
        Dismiss
      </button>
    </div>
  );
}
