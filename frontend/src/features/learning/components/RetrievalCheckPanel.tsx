// Phase A — A1 (funnel-edge pedagogy): the retrieval check that fires
// AFTER the executable rules pass but BEFORE the celebration mounts.
//
// Without this gate, lesson completion measures clicks (did the
// expected stdout appear?) instead of learning (does the learner
// actually understand what they typed?). A learner who pasted from
// a friend or guessed their way past the substring rule clears the
// funnel today — Phase A's lesson-2-reach metric becomes uninformative.
//
// Lesson author defines the rule shape in lesson.json; this component
// renders one question + N choices and reports a correct/wrong answer
// upward via callback. LessonPage manages the answered-once-per-learner
// localStorage gate (so a returning learner who already passed the
// retrieval doesn't re-prove it).
//
// Design choices:
//   - Single attempt OR retry on wrong answer? → retry. Wrong answers
//     reveal the explanation so the learner reads it before trying
//     again; locking them out of progression after a single mistake
//     would feel punitive.
//   - Auto-advance on correct, or require a confirm tap? → auto-advance
//     after a brief "✓ correct" hold so the celebration lands as a
//     continuation rather than a new beat. Keeps the cinematic flow.
//   - Multi-line `question` strings (with code blocks): rendered with
//     <pre> so indentation + linebreaks survive. Plain text and code
//     mix in one field — keeps the lesson schema simple.

import { useState } from "react";

export interface RetrievalCheckPanelProps {
  question: string;
  choices: string[];
  correctIndex: number;
  explanation?: string;
  onCorrect: () => void;
}

export function RetrievalCheckPanel({
  question,
  choices,
  correctIndex,
  explanation,
  onCorrect,
}: RetrievalCheckPanelProps) {
  const [picked, setPicked] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [confirming, setConfirming] = useState(false);

  function handlePick(i: number) {
    if (revealed && picked === correctIndex) return; // already won; no-op
    setPicked(i);
    setRevealed(true);
    if (i === correctIndex) {
      // Hold the green tick for 600ms so it registers as a beat, then
      // call onCorrect — LessonPage re-runs the validator + the
      // celebration sonar fires.
      setConfirming(true);
      window.setTimeout(() => {
        onCorrect();
      }, 600);
    }
  }

  function handleRetry() {
    setRevealed(false);
    setPicked(null);
  }

  const isWrong = revealed && picked !== correctIndex;

  return (
    <div
      role="dialog"
      aria-label="Quick check before you finish"
      className="rounded-lg border border-accent/40 bg-panel p-5 shadow-lg"
    >
      <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-accent">
        Quick check
      </div>
      <pre className="mb-4 whitespace-pre-wrap font-sans text-sm text-ink">{question}</pre>

      <div className="flex flex-col gap-2">
        {choices.map((choice, i) => {
          const isPicked = picked === i;
          const isCorrect = i === correctIndex;
          let stateClass = "border-border bg-bg hover:border-accent/60";
          if (revealed) {
            if (isCorrect) stateClass = "border-success bg-success/10 text-success";
            else if (isPicked) stateClass = "border-warn bg-warn/10 text-warn";
            else stateClass = "border-border bg-bg opacity-50";
          }
          return (
            <button
              key={i}
              type="button"
              onClick={() => handlePick(i)}
              disabled={confirming}
              className={`rounded-md border px-3 py-2 text-left text-sm transition disabled:cursor-default ${stateClass}`}
            >
              {choice}
            </button>
          );
        })}
      </div>

      {isWrong && (
        <div className="mt-4 rounded-md border border-warn/40 bg-warn/10 p-3 text-xs leading-relaxed text-warn">
          {explanation ?? "Not quite — try again."}
          <button
            type="button"
            onClick={handleRetry}
            className="ml-2 inline-flex items-center font-semibold underline underline-offset-2 hover:text-warn/80"
          >
            Try again
          </button>
        </div>
      )}

      {confirming && (
        <div className="mt-4 text-xs font-semibold text-success">
          ✓ Correct — finishing your lesson…
        </div>
      )}
    </div>
  );
}
