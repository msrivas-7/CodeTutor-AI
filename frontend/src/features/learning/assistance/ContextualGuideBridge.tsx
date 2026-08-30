import type { AssistanceDecision } from "./policy";
import type { AssistanceEvidence } from "./evidence";

interface ContextualGuideBridgeProps {
  decision: AssistanceDecision;
  evidence: AssistanceEvidence | null;
  onViewError: () => void;
  onDismiss: () => void;
  onAskTutor?: () => void;
  tutorOfferState?: "loading" | "ready" | "unavailable";
  compact?: boolean;
}
export function ContextualGuideBridge({
  decision,
  evidence,
  onViewError,
  onDismiss,
  onAskTutor,
  tutorOfferState = "unavailable",
  compact = false,
}: ContextualGuideBridgeProps) {
  if (decision.kind !== "result_bridge" || !evidence) return null;

  const tutorOfferDescription =
    tutorOfferState === "loading"
      ? "Checking whether contextual Tutor help is available. Nothing is sent yet."
      : tutorOfferState === "ready"
        ? "Help me spot it sends your current code and run evidence to the AI Tutor as one question."
        : "Open Tutor moves focus to the Tutor without sending a question.";

  return (
    <section
      data-testid="contextual-guide-bridge"
      aria-label="Current code guidance"
      className={`border-accent/30 bg-accent/[0.08] ${
        compact
          ? "mx-3 mt-2 rounded-xl border px-3 py-2"
          : "border-b px-4 py-2"
      }`}
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/15 text-sm text-accent"
        >
          ↳
        </span>
        <p className="min-w-0 flex-1 text-xs font-semibold text-ink">
          {evidence.label} on line {evidence.line}
        </p>
        <button
          type="button"
          onClick={onViewError}
          className="inline-flex min-h-11 items-center rounded-lg px-2 text-xs font-semibold text-accent transition hover:bg-accent/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Jump to line {evidence.line}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-base text-muted transition hover:bg-accent/10 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          aria-label="Dismiss current code guidance"
          title="Dismiss guidance until the error changes"
        >
          ×
        </button>
      </div>
      {decision.move && (
        <div className="ml-9 flex flex-wrap items-center justify-between gap-2 pr-12">
          <p
            data-testid="contextual-guide-question"
            role="status"
            aria-live="polite"
            className="min-w-0 flex-1 text-sm leading-relaxed text-ink"
          >
            {decision.move.question}
          </p>
          {onAskTutor && (
            <button
              type="button"
              data-testid="contextual-guide-ask"
              onClick={onAskTutor}
              disabled={tutorOfferState === "loading"}
              className="inline-flex min-h-11 shrink-0 items-center rounded-lg bg-accent px-3 text-xs font-semibold text-panel transition hover:bg-accent/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-panel disabled:cursor-wait disabled:opacity-60"
              aria-describedby="contextual-guide-consent"
            >
              {tutorOfferState === "loading"
                ? "Checking Tutor…"
                : tutorOfferState === "ready"
                  ? "Help me spot it"
                  : "Open Tutor"}
            </button>
          )}
          <span id="contextual-guide-consent" className="sr-only">
            {tutorOfferDescription}
          </span>
        </div>
      )}
    </section>
  );
}
