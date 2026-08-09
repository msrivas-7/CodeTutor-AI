import { useEffect, useRef, useState } from "react";
import type { FunctionTest, PracticeExercise, TestReport, ValidationResult } from "../types";
import { Modal } from "../../../components/Modal";
import { pickFirstFailure } from "../utils/validator";

function expectedTestOutcome(test: FunctionTest): string {
  if (test.expectedError) {
    const message = test.expectedError.message
      ? `(${JSON.stringify(test.expectedError.message)})`
      : "";
    return `throws ${test.expectedError.type}${message}`;
  }
  return test.expected ?? "(expected result unavailable)";
}

function PracticeTestsMiniList({ exercise }: { exercise: PracticeExercise }) {
  const rule = exercise.completionRules.find((r) => r.type === "function_tests");
  const visible = rule?.tests?.filter((t) => !t.hidden) ?? [];
  if (visible.length === 0) return null;

  return (
    <section
      aria-labelledby={`practice-tests-${exercise.id}`}
      className="mb-3 rounded-lg border border-border bg-elevated/40 px-3 py-2"
    >
      <h3
        id={`practice-tests-${exercise.id}`}
        className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted"
      >
        Your code should pass
      </h3>
      <ul className="space-y-1">
        {visible.map((t, i) => (
          <li key={i} className="min-w-0 space-y-1 text-xs leading-relaxed">
            <code className="block min-w-0 whitespace-pre-wrap break-words rounded bg-bg px-2 py-1 font-mono text-xs text-accent [overflow-wrap:anywhere]">
              {t.call}
            </code>
            <span className="block text-[10px] font-semibold uppercase tracking-wider text-muted">
              Expected
            </span>
            <code className="block min-w-0 whitespace-pre-wrap break-words rounded bg-bg px-2 py-1 font-mono text-xs text-ink/80 [overflow-wrap:anywhere]">
              {expectedTestOutcome(t)}
            </code>
          </li>
        ))}
      </ul>
    </section>
  );
}

interface PracticeInstructionsViewProps {
  exercises: PracticeExercise[];
  currentIndex: number;
  completedIds: string[];
  validation: ValidationResult | null;
  testReport?: TestReport | null;
  saveError?: string | null;
  workspaceTransitioning?: boolean;
  workspaceTransitionError?: string | null;
  onSelectExercise: (index: number) => void;
  onExitPractice: () => void;
  onNextExercise: () => void;
  onResetPractice: () => Promise<boolean>;
  onHintReveal?: () => void;
  onCollapse?: () => void;
}

export function PracticeInstructionsView({
  exercises,
  currentIndex,
  completedIds,
  validation,
  testReport,
  saveError,
  workspaceTransitioning = false,
  workspaceTransitionError = null,
  onSelectExercise,
  onExitPractice,
  onNextExercise,
  onResetPractice,
  onHintReveal,
  onCollapse,
}: PracticeInstructionsViewProps) {
  const [showHints, setShowHints] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resettingPractice, setResettingPractice] = useState(false);
  const [resetAttempted, setResetAttempted] = useState(false);
  const current = exercises[currentIndex];
  const isComplete = current ? completedIds.includes(current.id) : false;
  // A saved completion is historical progress, but it must not contradict the
  // learner's latest check. Keep the navigation dot checked while suppressing
  // the current-code success banner and advance action after a failed recheck.
  const showCurrentCompletion = isComplete && validation?.passed !== false;
  const completedCount = completedIds.filter((id) =>
    exercises.some((e) => e.id === id)
  ).length;
  const hasNext = currentIndex < exercises.length - 1;
  const firstFailure = pickFirstFailure(testReport);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const wasTransitioningRef = useRef(workspaceTransitioning);

  useEffect(() => {
    setShowHints(false);
  }, [current?.id]);

  useEffect(() => {
    if (wasTransitioningRef.current && !workspaceTransitioning) {
      headingRef.current?.focus({ preventScroll: true });
    }
    wasTransitioningRef.current = workspaceTransitioning;
  }, [workspaceTransitioning]);

  if (!current) return null;

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      <header className="flex items-center gap-2 border-b border-border bg-violet/5 px-4 py-2">
        <div className="flex items-center gap-1.5">
          <span className="rounded-full bg-violet/20 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-violet">
            Practice
          </span>
          <span className="text-xs font-semibold text-ink">
            {currentIndex + 1} of {exercises.length}
          </span>
        </div>
        <span className="ml-auto text-[10px] text-muted">
          {completedCount}/{exercises.length} done
        </span>
        {completedCount > 0 && (
          <button
            onClick={() => {
              setResetAttempted(false);
              setConfirmReset(true);
            }}
            title="Reset practice progress for this lesson"
            aria-label="Reset practice progress"
            className="flex h-11 w-11 items-center justify-center rounded-lg text-muted transition hover:bg-danger/10 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="1 4 1 10 7 10" />
              <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
            </svg>
          </button>
        )}
        {onCollapse && (
          <button
            onClick={onCollapse}
            title="Collapse"
            aria-label="Collapse practice instructions"
            className="flex h-11 w-11 items-center justify-center rounded-lg text-muted transition hover:bg-elevated hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M5.5 3.5L10 8l-4.5 4.5L4 11l3-3-3-3z" />
            </svg>
          </button>
        )}
      </header>

      {/* tabIndex=0 so keyboard users can scroll the body with arrow keys.
          Without it, axe flags `scrollable-region-focusable` (serious). */}
      <div className="flex-1 overflow-y-auto px-4 py-3" tabIndex={0}>
        <button
          type="button"
          onClick={onExitPractice}
          className="mb-3 flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm text-muted transition hover:bg-elevated hover:text-ink"
        >
          ← Back to lesson
        </button>

        {exercises.length > 1 && (
          <div className="mb-3 flex flex-wrap gap-1">
            {exercises.map((ex, i) => {
              const done = completedIds.includes(ex.id);
              const active = i === currentIndex;
              return (
                <button
                  type="button"
                  key={ex.id}
                  onClick={() => onSelectExercise(i)}
                  disabled={workspaceTransitioning}
                  className={`flex h-11 w-11 items-center justify-center rounded-full text-sm font-bold transition focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                    active
                      ? "bg-violet text-bg ring-2 ring-violet/40"
                      : done
                        ? "bg-success/20 text-success"
                        : "bg-elevated text-muted hover:bg-elevated/70"
                  }`}
                  title={ex.title}
                  aria-label={`Exercise ${i + 1}: ${ex.title}${done ? " (completed)" : ""}`}
                  aria-current={active ? "true" : undefined}
                >
                  {done ? "✓" : i + 1}
                </button>
              );
            })}
          </div>
        )}

        <h2
          ref={headingRef}
          tabIndex={-1}
          className="mb-2 text-sm font-bold text-ink focus:outline-none"
        >
          {current.title}
        </h2>

        {workspaceTransitioning && (
          <div
            role="status"
            aria-live="polite"
            className="mb-3 rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-xs text-accent"
          >
            Opening this challenge… The editor will unlock when its starter is ready.
          </div>
        )}

        {workspaceTransitionError && (
          <div
            role="alert"
            className="mb-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger"
          >
            {workspaceTransitionError}
          </div>
        )}

        <div className="mb-3 rounded-lg border border-violet/20 bg-violet/5 px-3 py-2">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-violet/70">
            Goal
          </div>
          <p className="mt-0.5 text-xs leading-relaxed text-ink/90">{current.goal}</p>
        </div>

        <p className="mb-3 text-xs leading-relaxed text-ink/80">{current.prompt}</p>

        <PracticeTestsMiniList exercise={current} />

        {showCurrentCompletion && (
          <div className="mb-3 flex items-center gap-2 rounded-lg bg-success/10 px-3 py-2 text-xs text-success">
            <span>✓</span>
            <span>You've completed this challenge.</span>
          </div>
        )}

        {current.hints && current.hints.length > 0 && (
          <div className="border-t border-border pt-3">
            <button
              onClick={() => {
                if (!showHints) onHintReveal?.();
                setShowHints((v) => !v);
              }}
              className="flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm font-medium text-accentInk transition hover:bg-accent/5"
            >
              <svg
                className={`h-3 w-3 transition-transform duration-200 ${showHints ? "rotate-90" : ""}`}
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
              {showHints ? "Hide hints" : "Show hints"}
            </button>
            {showHints && (
              <ol className="mt-2 list-decimal space-y-1.5 pl-5">
                {current.hints.map((hint, i) => (
                  <li key={i} className="text-xs text-muted">
                    {hint}
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}

        {validation && (
          <div className="mt-3 space-y-1.5">
            {validation.passed ? (
              <div className="rounded-lg bg-success/10 px-3 py-2 text-xs text-success">
                <div className="font-semibold">Nice work!</div>
                <div className="mt-0.5 opacity-80">{validation.feedback[0]}</div>
              </div>
            ) : (
              <div role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">
                <div className="font-semibold">Not quite yet.</div>
                <div className="mt-0.5 opacity-80">{validation.feedback[0]}</div>
                {firstFailure && firstFailure.evidence !== "source" && !firstFailure.hidden && (
                  <dl className="mt-2 grid grid-cols-[auto,minmax(0,1fr)] gap-x-2 gap-y-1 rounded-md bg-bg/50 p-2 font-mono text-[10px]">
                    <dt className="font-sans text-muted">Example</dt>
                    <dd className="min-w-0 break-words text-ink">{firstFailure.name}</dd>
                    <dt className="font-sans text-muted">Expected</dt>
                    <dd className="min-w-0 break-words text-ink">{firstFailure.expectedRepr ?? "(unknown)"}</dd>
                    <dt className="font-sans text-muted">Got</dt>
                    <dd className="min-w-0 break-words text-danger">{firstFailure.error ?? firstFailure.actualRepr ?? "(no value)"}</dd>
                  </dl>
                )}
                {validation.nextHints?.[0] && (
                  <div className="mt-1 text-[11px] opacity-70">
                    {validation.nextHints[0]}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {showCurrentCompletion && hasNext && (
          <button
            type="button"
            onClick={onNextExercise}
            disabled={workspaceTransitioning}
            className="mt-3 min-h-11 w-full rounded-lg bg-violet/20 px-3 py-2 text-sm font-semibold text-violet transition hover:bg-violet/30"
          >
            Next challenge →
          </button>
        )}

        {showCurrentCompletion && !hasNext && (
          <button
            type="button"
            onClick={onExitPractice}
            disabled={workspaceTransitioning}
            className="mt-3 min-h-11 w-full rounded-lg bg-success/20 px-3 py-2 text-sm font-semibold text-success transition hover:bg-success/30"
          >
            All practice done — back to lesson
          </button>
        )}
      </div>

      {confirmReset && (
        <Modal
          onClose={() => {
            if (!resettingPractice) setConfirmReset(false);
          }}
          role="alertdialog"
          labelledBy="practice-reset-title"
          position="center"
          panelClassName="mx-4 w-full max-w-xs rounded-xl border border-danger/30 bg-panel p-4 shadow-xl"
        >
          <h3 id="practice-reset-title" className="text-lg font-bold text-ink">Reset practice progress?</h3>
          <p className="mt-2 text-base leading-relaxed text-muted sm:text-body">
            This clears your practice completions for this lesson. Your lesson progress stays intact.
          </p>
          {resetAttempted && saveError && (
            <div
              role="alert"
              className="mt-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
            >
              Nothing was cleared. {saveError}
            </div>
          )}
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={() => setConfirmReset(false)}
              disabled={resettingPractice}
              className="min-h-11 flex-1 rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted transition hover:bg-elevated hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                setResettingPractice(true);
                setResetAttempted(true);
                void onResetPractice()
                  .then((reset) => {
                    if (reset) setConfirmReset(false);
                  })
                  .finally(() => setResettingPractice(false));
              }}
              disabled={resettingPractice}
              className="min-h-11 flex-1 rounded-lg bg-danger/20 px-3 py-2 text-sm font-semibold text-danger ring-1 ring-danger/40 transition hover:bg-danger/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger"
            >
              {resettingPractice ? "Resetting…" : "Reset"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
