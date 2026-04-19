import { useState } from "react";
import type { PracticeExercise, ValidationResult } from "../types";
import { Modal } from "../../../components/Modal";

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
          <li key={i} className="flex items-baseline gap-2 text-[11px] leading-relaxed">
            <code className="shrink-0 rounded bg-bg px-1.5 py-0.5 font-mono text-[11px] text-accent">
              {t.call}
            </code>
            <span className="text-muted">→</span>
            <code className="rounded bg-bg px-1.5 py-0.5 font-mono text-[11px] text-ink/80">
              {t.expected}
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
  onSelectExercise: (index: number) => void;
  onExitPractice: () => void;
  onNextExercise: () => void;
  onResetPractice: () => void;
  onCollapse?: () => void;
}

export function PracticeInstructionsView({
  exercises,
  currentIndex,
  completedIds,
  validation,
  onSelectExercise,
  onExitPractice,
  onNextExercise,
  onResetPractice,
  onCollapse,
}: PracticeInstructionsViewProps) {
  const [showHints, setShowHints] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const current = exercises[currentIndex];
  const isComplete = current ? completedIds.includes(current.id) : false;
  const completedCount = completedIds.filter((id) =>
    exercises.some((e) => e.id === id)
  ).length;
  const hasNext = currentIndex < exercises.length - 1;

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
            onClick={() => setConfirmReset(true)}
            title="Reset practice progress for this lesson"
            className="rounded p-1 text-muted transition hover:bg-danger/10 hover:text-danger"
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
            className="rounded p-1 text-muted transition hover:bg-elevated hover:text-ink"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M5.5 3.5L10 8l-4.5 4.5L4 11l3-3-3-3z" />
            </svg>
          </button>
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        <button
          onClick={onExitPractice}
          className="mb-3 flex items-center gap-1 text-[11px] text-muted transition hover:text-ink"
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
                  key={ex.id}
                  onClick={() => onSelectExercise(i)}
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold transition focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
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

        <h2 className="mb-2 text-sm font-bold text-ink">{current.title}</h2>

        <div className="mb-3 rounded-lg border border-violet/20 bg-violet/5 px-3 py-2">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-violet/70">
            Goal
          </div>
          <p className="mt-0.5 text-xs leading-relaxed text-ink/90">{current.goal}</p>
        </div>

        <p className="mb-3 text-xs leading-relaxed text-ink/80">{current.prompt}</p>

        <PracticeTestsMiniList exercise={current} />

        {isComplete && (
          <div className="mb-3 flex items-center gap-2 rounded-lg bg-success/10 px-3 py-2 text-xs text-success">
            <span>✓</span>
            <span>You've completed this challenge.</span>
          </div>
        )}

        {current.hints && current.hints.length > 0 && (
          <div className="border-t border-border pt-3">
            <button
              onClick={() => setShowHints((v) => !v)}
              className="flex items-center gap-1 text-xs font-medium text-accent transition hover:text-accent/80"
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
                {validation.nextHints?.[0] && (
                  <div className="mt-1 text-[11px] opacity-70">
                    {validation.nextHints[0]}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {isComplete && hasNext && (
          <button
            onClick={onNextExercise}
            className="mt-3 w-full rounded-lg bg-violet/20 px-3 py-2 text-xs font-semibold text-violet transition hover:bg-violet/30"
          >
            Next challenge →
          </button>
        )}

        {isComplete && !hasNext && (
          <button
            onClick={onExitPractice}
            className="mt-3 w-full rounded-lg bg-success/20 px-3 py-2 text-xs font-semibold text-success transition hover:bg-success/30"
          >
            All practice done — back to lesson
          </button>
        )}
      </div>

      {confirmReset && (
        <Modal
          onClose={() => setConfirmReset(false)}
          role="alertdialog"
          labelledBy="practice-reset-title"
          position="center"
          panelClassName="mx-4 w-full max-w-xs rounded-xl border border-danger/30 bg-panel p-4 shadow-xl"
        >
          <h3 id="practice-reset-title" className="text-xs font-bold text-ink">Reset practice progress?</h3>
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
            This clears your practice completions for this lesson. Your lesson progress stays intact.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={() => setConfirmReset(false)}
              className="flex-1 rounded-md border border-border px-3 py-1.5 text-[11px] font-medium text-muted transition hover:bg-elevated hover:text-ink"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                onResetPractice();
                setConfirmReset(false);
              }}
              className="flex-1 rounded-md bg-danger/20 px-3 py-1.5 text-[11px] font-semibold text-danger ring-1 ring-danger/40 transition hover:bg-danger/30"
            >
              Reset
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
