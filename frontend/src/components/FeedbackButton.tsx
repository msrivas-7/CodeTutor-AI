import { lazy, Suspense, useRef, useState } from "react";
import { useAuthStore } from "../auth/authStore";

// Phase 20-P1: global feedback affordance, rendered inline in each page's
// top bar next to UserMenu. (Pre-Phase-20-P2 this was a fixed bottom-left
// pill floated by App.tsx — it covered content on narrow editor panes and
// the file tree; the header placement keeps it always-visible without
// overlapping.) Hidden while signed-out — the backend route requires auth
// and we don't want to collect rows we can't attribute.
//
// Modal is lazy-loaded so the submit-feedback code path doesn't live in the
// first bundle; most learners never click this button in a session.

const FeedbackModalLazy = lazy(() =>
  import("./FeedbackModal").then((m) => ({ default: m.FeedbackModal })),
);

export function FeedbackButton() {
  const user = useAuthStore((s) => s.user);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  if (!user) return null;
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Give feedback"
        data-testid="feedback-button"
        title="Report a bug or share an idea"
        className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[11px] font-medium text-muted transition hover:bg-elevated hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 16 16"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M2 3.5A1.5 1.5 0 013.5 2h9A1.5 1.5 0 0114 3.5v7A1.5 1.5 0 0112.5 12H7.7l-2.9 2.3a.5.5 0 01-.8-.4V12h-.5A1.5 1.5 0 012 10.5v-7zM5 6a.75.75 0 000 1.5h6A.75.75 0 0011 6H5zm0 2.5a.75.75 0 000 1.5h4a.75.75 0 000-1.5H5z" />
        </svg>
        Feedback
      </button>
      {open && (
        <Suspense fallback={null}>
          <FeedbackModalLazy
            onClose={() => {
              setOpen(false);
              // A10: Modal's built-in focus-restore relies on the trigger
              // still existing — it does here, but explicit re-focus guards
              // against SR edge cases where restore loses the element.
              triggerRef.current?.focus();
            }}
          />
        </Suspense>
      )}
    </>
  );
}
