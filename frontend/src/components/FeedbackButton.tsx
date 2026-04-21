import { lazy, Suspense, useState } from "react";
import { useAuthStore } from "../auth/authStore";

// Phase 20-P1: global feedback affordance. Mounted once by App.tsx so it
// floats over every authenticated page (start, editor, lesson, dashboard).
// Hidden while signed-out — the backend route requires auth and we don't
// want to collect rows we can't attribute.
//
// Modal is lazy-loaded so the submit-feedback code path doesn't live in the
// first bundle; most learners never click this button in a session.

const FeedbackModalLazy = lazy(() =>
  import("./FeedbackModal").then((m) => ({ default: m.FeedbackModal })),
);

export function FeedbackButton() {
  const user = useAuthStore((s) => s.user);
  const [open, setOpen] = useState(false);
  if (!user) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Give feedback"
        data-testid="feedback-button"
        className="fixed bottom-3 left-3 z-40 inline-flex items-center gap-1.5 rounded-full border border-border bg-panel/90 px-3 py-1.5 text-[11px] font-medium text-muted shadow-lg backdrop-blur transition hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 16 16"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M2 3.5A1.5 1.5 0 013.5 2h9A1.5 1.5 0 0114 3.5v7A1.5 1.5 0 0112.5 12H7.7l-2.9 2.3a.5.5 0 01-.8-.4V12h-.5A1.5 1.5 0 012 10.5v-7z" />
        </svg>
        Feedback
      </button>
      {open && (
        <Suspense fallback={null}>
          <FeedbackModalLazy onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  );
}
