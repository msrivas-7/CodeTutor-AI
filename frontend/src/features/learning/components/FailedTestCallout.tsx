import { useEffect, useRef } from "react";
import type { FunctionTest, TestCaseResult } from "../types";

interface FailedTestCalloutProps {
  failure: TestCaseResult;
  /** The visible test that matched this failure by name, if any. Used to
   *  surface the actual call in the heading instead of the author-chosen
   *  description — "tokenize('Hi!')" is a better identifier than "tokenize
   *  basic words". Undefined for hidden tests (by design — we never leak
   *  their inputs). */
  failingTest?: FunctionTest;
  /** Consecutive Check My Work fails on the SAME failing test. When >= 2 we
   *  reveal the author-tagged category (for hidden tests) and expose the
   *  "Ask tutor why" button. Gating this behind the 2nd fail avoids training
   *  learned-helplessness on the first stumble. */
  consecutiveFails: number;
  onAskTutor?: () => void;
}

// Pull the "last meaningful line" of a Python traceback — typically the
// "ExceptionType: message" line. Beginners don't benefit from seeing the
// harness frames; they want the one line that names what went wrong.
function lastTracebackLine(err: string): string {
  const lines = err.split("\n").map((l) => l.trim()).filter(Boolean);
  return lines[lines.length - 1] ?? err.trim();
}

// Don't auto-focus the callout heading if the user is actively typing — that
// yanks them out of the editor mid-keystroke, which is worse than a
// screen-reader missing the announcement. The live-region on the summary
// pill still notifies SR users; a heading focus is a nice-to-have, not a
// requirement.
function isUserTyping(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return true;
  if (el.isContentEditable) return true;
  // Monaco's editor uses a hidden textarea inside a .monaco-editor container;
  // the textarea check above already catches it, but belt-and-braces.
  if (el.closest?.(".monaco-editor")) return true;
  return false;
}

/**
 * Check My Work's "one thing still failing" banner. Branches on hidden vs
 * visible: for visible tests we can show the mismatch (call + expected +
 * got) because the test itself is public; for hidden tests we keep the copy
 * generic and only reveal the author's `category` breadcrumb after two
 * consecutive fails on the same test.
 *
 * ARIA: role="status" with aria-live="polite" — this is informational, not a
 * modal, so alertdialog was the wrong pattern. Focus moves to the heading on
 * mount *only if* the user isn't mid-keystroke, so we don't yank them out of
 * the editor.
 */
export function FailedTestCallout({ failure, failingTest, consecutiveFails, onAskTutor }: FailedTestCalloutProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!isUserTyping()) {
      // preventScroll: otherwise default focus behavior scrolls ancestors
      // (including body) to bring the heading into view — that was causing a
      // page-level scrollbar to appear and the whole editor to jump up.
      headingRef.current?.focus({ preventScroll: true });
    }
  }, [failure]);

  const canAsk = consecutiveFails >= 2 && !!onAskTutor;
  // First-fail preview: a soft one-liner that tells the learner the tutor is
  // here if the next attempt also struggles. Makes the eventual 2nd-fail
  // "Ask tutor why" button feel discoverable rather than surprise.
  const showFirstFailHint = consecutiveFails < 2 && !!onAskTutor;

  if (failure.hidden) {
    return (
      <div
        className="mt-3 rounded-xl border border-warn/30 bg-warn/5 p-3"
        role="status"
        aria-live="polite"
        aria-labelledby="failed-callout-heading"
      >
        <h3
          ref={headingRef}
          id="failed-callout-heading"
          tabIndex={-1}
          className="flex items-center gap-2 text-xs font-semibold text-warn focus:outline-none"
        >
          <span aria-hidden="true">→</span>
          <span className="sr-only">Almost there:</span>
          One tricky case didn't work yet
        </h3>
        <p className="mt-1.5 text-[11px] leading-relaxed text-ink/80">
          Your function handles the visible examples — there's just one related input it hasn't covered yet. Try sketching 2–3 more inputs on paper and tracing them through your code.
        </p>
        {consecutiveFails >= 2 && failure.category && (
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
            Hint: think about the <code className="rounded bg-elevated px-1 py-0.5 font-mono text-[10px] text-accent">{failure.category}</code> case.
          </p>
        )}
        {canAsk ? (
          <button
            onClick={onAskTutor}
            className="mt-2 rounded-md bg-violet/15 px-2.5 py-1 text-[11px] font-semibold text-violet transition hover:bg-violet/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet"
          >
            Ask tutor why
          </button>
        ) : showFirstFailHint ? (
          <p className="mt-2 text-[10px] italic text-faint">
            If the next try still struggles, you'll be able to ask the tutor to walk through it.
          </p>
        ) : null}
      </div>
    );
  }

  const isError = !!failure.error;
  const tone = isError ? "border-danger/30 bg-danger/5 text-danger" : "border-warn/30 bg-warn/5 text-warn";
  const headingLabel = failingTest?.call
    ? failingTest.call
    : `Example "${failure.name}"`;
  const errorSummary = isError ? lastTracebackLine(failure.error ?? "") : "";

  return (
    <div
      className={`mt-3 rounded-xl border p-3 ${tone}`}
      role="status"
      aria-live="polite"
      aria-labelledby="failed-callout-heading"
    >
      <h3
        ref={headingRef}
        id="failed-callout-heading"
        tabIndex={-1}
        className="flex items-center gap-2 text-xs font-semibold focus:outline-none"
      >
        <span aria-hidden="true">{isError ? "⚠" : "→"}</span>
        <span className="sr-only">{isError ? "Error on" : "Got something else on"}:</span>
        <code className="font-mono text-[11px]">{headingLabel}</code>
      </h3>

      {isError ? (
        <div className="mt-1.5 text-[11px] leading-relaxed">
          <p className="text-ink/80">Your code raised this error when the example ran:</p>
          <code className="mt-1 inline-block rounded-md bg-danger/10 px-2 py-1 font-mono text-[10px] text-danger">
            {errorSummary || "exception raised"}
          </code>
        </div>
      ) : (
        <div className="mt-1.5 space-y-0.5 text-[11px]">
          <div>
            <span className="text-muted">Expected: </span>
            <code className="rounded bg-elevated px-1 py-0.5 font-mono text-[10px] text-accent">{failure.expectedRepr ?? "(unknown)"}</code>
          </div>
          <div>
            <span className="text-muted">Got: </span>
            <code className="rounded bg-warn/10 px-1 py-0.5 font-mono text-[10px] text-warn">{failure.actualRepr ?? "(no value)"}</code>
          </div>
        </div>
      )}

      {canAsk ? (
        <button
          onClick={onAskTutor}
          className="mt-2 rounded-md bg-violet/15 px-2.5 py-1 text-[11px] font-semibold text-violet transition hover:bg-violet/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet"
        >
          Ask tutor why
        </button>
      ) : showFirstFailHint ? (
        <p className="mt-2 text-[10px] italic text-faint">
          If the next try still struggles, you'll be able to ask the tutor to walk through it.
        </p>
      ) : null}
    </div>
  );
}
