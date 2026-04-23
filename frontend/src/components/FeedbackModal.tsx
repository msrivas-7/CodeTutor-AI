import { useEffect, useId, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { Modal } from "./Modal";
import { api } from "../api/client";
import { ApiError } from "../api/ApiError";

// Phase 20-P1: Global feedback modal. Rendered by FeedbackButton on
// click. The three main jobs are (a) make it frictionless to say something
// vague ("this page is confusing"), (b) collect enough non-PII context
// that we can actually reproduce the issue later, and (c) make the
// diagnostic attachment explicit and opt-in — the user has to tick the
// box AND we disclose exactly what gets sent.
//
// What we deliberately DO NOT include in diagnostics, even when opt-in:
// editor source code, lesson progress, the OpenAI key, email, IP, auth
// tokens. The backend re-validates shape + size and rejects anything
// larger than 8 KB. A user deleting their account leaves these rows
// ghosted (user_id SET NULL) so the signal survives; see migration.

type Category = "bug" | "idea" | "other";
type Mood = "good" | "okay" | "bad";
type Status = "idle" | "sending" | "sent" | "error";

const MOOD_BADGE: Record<Mood, { emoji: string; label: string }> = {
  good: { emoji: "😊", label: "Good" },
  okay: { emoji: "😐", label: "Okay" },
  bad: { emoji: "😕", label: "Confusing" },
};

interface Diagnostics {
  route: string;
  viewport: string;
  theme: string;
  lang: string;
  appSha: string;
  userAgent: string;
}

export function buildDiagnostics(pathname: string): Diagnostics {
  const theme =
    typeof document !== "undefined"
      ? document.documentElement.dataset.theme ?? "default"
      : "default";
  return {
    route: pathname,
    viewport:
      typeof window !== "undefined"
        ? `${window.innerWidth}x${window.innerHeight}`
        : "unknown",
    theme,
    lang: typeof navigator !== "undefined" ? navigator.language : "unknown",
    appSha: (import.meta.env.VITE_APP_SHA as string | undefined) ?? "dev",
    userAgent:
      typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 256) : "unknown",
  };
}

interface FeedbackModalProps {
  onClose: () => void;
  // Optional pre-seeding for contextual entry points (e.g. the lesson-end
  // chip). Only the initial mount honours these — once the learner edits
  // the field, controlled state takes over.
  initialCategory?: Category;
  initialBody?: string;
  // When the modal is opened from the lesson-end chip, the learner's mood
  // tag + lessonId travel with the submit so the "note" row carries the
  // same context as the mood-only chip POST. Also drives the "You rated
  // this lesson" badge so the learner sees their selection persisted.
  mood?: Mood;
  lessonId?: string;
  // Fires once when the backend confirms the insert. Distinct from onClose
  // because a learner can cancel with X or Escape mid-send; callers that
  // care about "actually submitted this session" (see LessonFeedbackChip)
  // need the submitted signal, not just any close.
  onSubmitted?: () => void;
}

export function FeedbackModal({ onClose, initialCategory, initialBody, mood, lessonId, onSubmitted }: FeedbackModalProps) {
  const headingId = useId();
  const location = useLocation();
  const [body, setBody] = useState(initialBody ?? "");
  const [category, setCategory] = useState<Category>(initialCategory ?? "other");
  const [attach, setAttach] = useState(false);
  const [showDiag, setShowDiag] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [err, setErr] = useState<string | null>(null);
  const [submittedId, setSubmittedId] = useState<string | null>(null);

  const diagnostics = useMemo(() => buildDiagnostics(location.pathname), [location.pathname]);

  useEffect(() => {
    // Clear any stale error the moment the user starts typing again.
    if (err) setErr(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body, category]);

  const canSubmit = body.trim().length > 0 && status !== "sending";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setStatus("sending");
    setErr(null);
    try {
      const res = await api.submitFeedback({
        body: body.trim(),
        category,
        diagnostics: attach ? (diagnostics as unknown as Record<string, string>) : {},
        mood: mood ?? null,
        lessonId: lessonId ?? null,
      });
      setSubmittedId(res.id);
      setStatus("sent");
      onSubmitted?.();
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Something went wrong";
      setErr(msg);
      setStatus("error");
    }
  }

  if (status === "sent") {
    return (
      <Modal onClose={onClose} labelledBy={headingId}>
        <div className="flex flex-col gap-3">
          <h2 id={headingId} className="text-sm font-semibold text-ink">
            Thanks — we got it
          </h2>
          <p className="text-xs text-muted">
            Your feedback helps us prioritise what to fix and build next. We
            read everything that comes in.
          </p>
          {submittedId && (
            <p className="text-[10px] text-faint">
              Reference id: <code className="font-mono">{submittedId}</code>
            </p>
          )}
          <div className="mt-1 flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md bg-accent px-3 py-1.5 text-[11px] font-semibold text-bg transition hover:bg-accentMuted focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Close
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      onClose={onClose}
      labelledBy={headingId}
      panelClassName="w-full max-w-lg rounded-xl border border-border bg-panel p-5 shadow-xl"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-3" noValidate>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id={headingId} className="text-sm font-semibold text-ink">
              Send feedback
            </h2>
            <p className="mt-0.5 text-[11px] text-muted">
              Bug, idea, or just something confusing? Tell us what happened —
              we read every note.
            </p>
          </div>
        </div>

        {mood && (
          <div
            data-testid="feedback-mood-badge"
            className="flex items-center gap-2 rounded-md border border-accent/30 bg-accent/5 px-2.5 py-1.5"
          >
            <span className="text-base" aria-hidden="true">
              {MOOD_BADGE[mood].emoji}
            </span>
            <span className="text-[11px] text-ink">
              You rated this lesson:{" "}
              <span className="font-semibold text-accent">{MOOD_BADGE[mood].label}</span>
            </span>
          </div>
        )}

        <fieldset className="flex flex-col gap-1.5">
          <legend className="text-[11px] font-medium text-muted">Type</legend>
          <div
            role="radiogroup"
            aria-label="Feedback type"
            className="flex gap-1.5"
          >
            {(["bug", "idea", "other"] as const).map((c) => {
              const active = category === c;
              return (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setCategory(c)}
                  className={`rounded-md border px-2.5 py-1 text-[11px] capitalize transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                    active
                      ? "border-accent/60 bg-accent/10 text-accent"
                      : "border-border bg-elevated text-muted hover:text-ink"
                  }`}
                >
                  {c}
                </button>
              );
            })}
          </div>
        </fieldset>

        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-medium text-muted">
            What's on your mind?
          </span>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={4000}
            rows={5}
            required
            aria-label="Feedback message"
            placeholder="What happened, and what did you expect?"
            className="resize-y rounded-md border border-border bg-elevated px-2.5 py-1.5 text-xs text-ink placeholder:text-faint focus:border-accent/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
          <span className="self-end text-[10px] text-faint">
            {body.length}/4000
          </span>
        </label>

        <div className="flex flex-col gap-1 rounded-md border border-border bg-elevated/50 p-2.5">
          <label className="flex items-start gap-2 text-[11px] text-muted">
            <input
              type="checkbox"
              checked={attach}
              onChange={(e) => setAttach(e.target.checked)}
              aria-label="Attach diagnostic context"
              className="mt-0.5"
            />
            <span>
              Attach page context (route, viewport, theme, language, app
              version, browser) — helps us reproduce.
            </span>
          </label>
          <button
            type="button"
            onClick={() => setShowDiag((v) => !v)}
            className="self-start text-[10px] text-accent hover:underline"
          >
            {showDiag ? "Hide" : "What's included?"}
          </button>
          {showDiag && (
            <pre className="overflow-x-auto rounded border border-border bg-bg/60 p-2 text-[10px] text-muted">
              {JSON.stringify(diagnostics, null, 2)}
            </pre>
          )}
          <p className="text-[10px] text-faint">
            Never included: your code, your OpenAI key, your email, your IP.
          </p>
        </div>

        {err && (
          <div
            role="alert"
            className="rounded-md border border-danger/40 bg-danger/10 px-2.5 py-1.5 text-[11px] text-danger"
          >
            {err}
          </div>
        )}

        <div className="mt-1 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border bg-elevated px-3 py-1.5 text-[11px] text-muted transition hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            aria-busy={status === "sending"}
            className="rounded-md bg-accent px-3 py-1.5 text-[11px] font-semibold text-bg transition hover:bg-accentMuted focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:bg-elevated disabled:text-faint"
          >
            {status === "sending" ? "Sending…" : "Send feedback"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
