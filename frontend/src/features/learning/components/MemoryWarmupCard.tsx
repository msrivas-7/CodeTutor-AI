import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import type {
  MemoryWarmupAnswer,
  MemoryWarmupPrompt,
} from "../../../api/client";

interface MemoryWarmupCardProps {
  loading: boolean;
  warmup: MemoryWarmupPrompt | null;
  answer: MemoryWarmupAnswer | null;
  submitting: boolean;
  loadError: string | null;
  answerError: string | null;
  onSubmit: (choiceIndex: number) => Promise<void>;
  onRetryAnswer: () => Promise<void>;
  onRetryLoad: () => void;
  onContinue: () => void;
}

function inlineCode(text: string) {
  return text.split(/(`[^`]+`)/g).map((part, index) =>
    part.startsWith("`") && part.endsWith("`") ? (
      <code
        key={index}
        className="rounded-md border border-border bg-bg/80 px-1.5 py-0.5 font-mono text-[0.9em] text-accent"
      >
        {part.slice(1, -1)}
      </code>
    ) : (
      part
    ),
  );
}

function conceptLabel(tag: string): string {
  return tag.replaceAll("-", " ");
}

export function MemoryWarmupCard({
  loading,
  warmup,
  answer,
  submitting,
  loadError,
  answerError,
  onSubmit,
  onRetryAnswer,
  onRetryLoad,
  onContinue,
}: MemoryWarmupCardProps) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [lastSubmittedIndex, setLastSubmittedIndex] = useState<number | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    setSelectedIndex(null);
    setLastSubmittedIndex(null);
  }, [warmup?.episodeId]);

  useEffect(() => {
    if (answer && !answer.isCorrect) setSelectedIndex(null);
  }, [answer?.attemptNumber, answer?.isCorrect]);

  useEffect(() => {
    if (!loading) headingRef.current?.focus();
  }, [loading, answer?.completed, loadError]);

  if (loading) {
    return (
      <main
        id="main-content"
        className="flex min-h-0 flex-1 items-center justify-center px-5 py-10"
        role="status"
        aria-live="polite"
      >
        <div className="w-full max-w-xl text-center">
          <div className="mx-auto mb-5 h-12 w-12 rounded-full border border-accent/30 bg-accent/10 shadow-glow" />
          <p className="font-display text-xl text-ink">Finding one useful memory…</p>
          <p className="mt-2 text-sm text-muted">A quick recall before the next idea.</p>
        </div>
      </main>
    );
  }

  if (loadError || (!warmup && answerError)) {
    return (
      <main
        id="main-content"
        className="flex min-h-0 flex-1 items-center justify-center px-5 py-10"
      >
        <section className="w-full max-w-xl rounded-2xl border border-warn/30 bg-panel p-6 shadow-xl sm:p-8">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-warn">
            Memory check unavailable
          </p>
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="mt-3 font-display text-2xl text-ink outline-none sm:text-3xl"
          >
            Your lesson is ready.
          </h1>
          <p role="alert" className="mt-3 text-sm leading-relaxed text-muted">
            {loadError ?? answerError}
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={onRetryLoad}
              className="min-h-11 rounded-xl border border-border px-5 py-2.5 text-sm font-semibold text-ink transition hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={onContinue}
              className="min-h-11 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-bg transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-panel"
            >
              Continue to lesson
            </button>
          </div>
        </section>
      </main>
    );
  }

  if (!warmup) return null;

  if (answer?.completed) {
    return (
      <main
        id="main-content"
        className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-5 py-8"
      >
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-success/30 bg-panel p-6 shadow-xl sm:p-8"
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-[radial-gradient(circle_at_top,rgba(34,197,94,0.16),transparent_68%)]"
          />
          <div className="relative">
            <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-success/15 text-xl text-success ring-1 ring-success/30">
              ✓
            </div>
            <h1
              ref={headingRef}
              tabIndex={-1}
              className="font-display text-3xl text-ink outline-none"
            >
              Memory refreshed.
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-muted">
              {answer.firstAttemptCorrect
                ? "You recalled it independently. That is stronger evidence than simply seeing it again."
                : "You rebuilt the idea with feedback. That still counts as useful practice—not independent recall yet."}
            </p>
            <div className="mt-4 flex flex-wrap gap-2" aria-label="Concepts refreshed">
              {warmup.conceptTags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-success/20 bg-success/10 px-2.5 py-1 text-[11px] text-success"
                >
                  {conceptLabel(tag)}
                </span>
              ))}
            </div>
            <button
              type="button"
              onClick={onContinue}
              className="mt-7 min-h-11 w-full rounded-xl bg-success px-5 py-2.5 text-sm font-semibold text-bg transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-success focus-visible:ring-offset-2 focus-visible:ring-offset-panel sm:w-auto"
            >
              Continue to lesson
            </button>
          </div>
        </motion.section>
      </main>
    );
  }

  const wrong = answer && !answer.isCorrect;
  return (
    <main
      id="main-content"
      className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-4 py-6 sm:px-6 sm:py-10"
    >
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-2xl rounded-2xl border border-border bg-panel p-5 shadow-xl sm:p-8"
        aria-labelledby="memory-warmup-title"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-violet">
            Quick recall · one question
          </p>
          <span className="rounded-full border border-border bg-bg/60 px-2.5 py-1 text-[10px] text-muted">
            No AI · checked by the course
          </span>
        </div>
        <h1
          ref={headingRef}
          id="memory-warmup-title"
          tabIndex={-1}
          className="mt-4 font-display text-2xl leading-tight text-ink outline-none sm:text-3xl"
        >
          Before you jump in
        </h1>
        <p className="mt-2 text-sm text-muted">
          Bring one earlier idea back to mind. Choose from memory first.
        </p>
        <fieldset className="mt-6">
          <legend className="text-base font-semibold leading-relaxed text-ink sm:text-lg">
            {inlineCode(warmup.prompt)}
          </legend>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {warmup.choices.map((choice, index) => {
              const selected = selectedIndex === index;
              const selectedWrong = wrong && lastSubmittedIndex === index;
              return (
                <label
                  key={choice}
                  className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm transition motion-reduce:transition-none ${
                    selectedWrong
                      ? "border-danger/50 bg-danger/10 text-danger"
                      : selected
                        ? "border-violet/60 bg-violet/10 text-ink ring-1 ring-violet/30"
                        : "border-border bg-bg/40 text-muted hover:border-violet/35 hover:bg-elevated hover:text-ink"
                  }`}
                >
                  <input
                    type="radio"
                    name="memory-warmup-choice"
                    value={index}
                    checked={selected}
                    disabled={submitting}
                    onChange={() => setSelectedIndex(index)}
                    className="h-4 w-4 shrink-0 accent-violet"
                  />
                  <span>{inlineCode(choice)}</span>
                </label>
              );
            })}
          </div>
        </fieldset>

        {wrong && (
          <div
            role="status"
            aria-live="polite"
            className="mt-5 rounded-xl border border-warn/30 bg-warn/10 px-4 py-3"
          >
            <p className="text-sm font-semibold text-warn">Not quite—use the clue and try once more.</p>
            <p className="mt-1 text-sm leading-relaxed text-muted">
              {inlineCode(answer.explanation)}
            </p>
          </div>
        )}

        {answerError && (
          <div role="alert" className="mt-5 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3">
            <p className="text-sm font-semibold text-danger">Answer not checked</p>
            <p className="mt-1 text-sm text-muted">{answerError}</p>
            <div className="mt-3 flex flex-wrap gap-3">
              <button
                type="button"
                disabled={submitting}
                onClick={() => void onRetryAnswer()}
                className="min-h-11 rounded-lg border border-border px-4 py-2 text-sm font-semibold text-ink hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
              >
                Retry answer
              </button>
              <button
                type="button"
                onClick={onContinue}
                className="min-h-11 px-3 py-2 text-sm font-medium text-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Continue anyway
              </button>
            </div>
          </div>
        )}

        {!answerError && (
          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs leading-relaxed text-faint">
              {wrong ? "Feedback-supported recall is recorded separately." : "First attempts matter, so take your best guess."}
            </p>
            <button
              type="button"
              disabled={selectedIndex === null || submitting}
              onClick={() => {
                if (selectedIndex !== null) {
                  setLastSubmittedIndex(selectedIndex);
                  void onSubmit(selectedIndex);
                }
              }}
              className="min-h-11 rounded-xl bg-violet px-5 py-2.5 text-sm font-semibold text-bg transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet focus-visible:ring-offset-2 focus-visible:ring-offset-panel disabled:cursor-not-allowed disabled:opacity-45"
            >
              {submitting ? "Checking…" : wrong ? "Try this answer" : "Check my recall"}
            </button>
          </div>
        )}
      </motion.section>
    </main>
  );
}
