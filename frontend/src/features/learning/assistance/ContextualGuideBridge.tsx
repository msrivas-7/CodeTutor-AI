import type { AssistanceDecision } from "./policy";
import type { AssistanceEvidence } from "./evidence";

interface ContextualGuideBridgeProps {
  decision: AssistanceDecision;
  evidence: AssistanceEvidence | null;
  onViewError: () => void;
  onDismiss: () => void;
  compact?: boolean;
}
export function ContextualGuideBridge({
  decision,
  evidence,
  onViewError,
  onDismiss,
  compact = false,
}: ContextualGuideBridgeProps) {
  if (decision.kind !== "result_bridge" || !evidence) return null;

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
        <p
          data-testid="contextual-guide-question"
          role="status"
          aria-live="polite"
          className="ml-9 pr-12 text-sm leading-relaxed text-ink"
        >
          {decision.move.question}
        </p>
      )}
    </section>
  );
}
