import { useMemo, useState } from "react";
import type { FunctionTest, TestReport } from "../types";
import { TestExampleCard } from "./TestExampleCard";

interface ExamplesSectionProps {
  tests: FunctionTest[];
  report: TestReport | null;
  running: boolean;
  onRunExamples: () => void;
}

/**
 * Inline collapsible "Examples" section rendered under the lesson markdown.
 * Replaces the earlier tab-based design from UX review: tabs split attention
 * and create a third top-level nav; an accordion inlines the tests next to
 * the reading flow.
 *
 * Pre-run state deliberately avoids a 0/N scoreboard — "try one" is less
 * discouraging than "0 of 5 pass". Hidden tests are never listed; the footer
 * note mentions that additional cases run on Check My Work so learners know
 * to anticipate edge cases without being handed a checklist.
 */
export function ExamplesSection({ tests, report, running, onRunExamples }: ExamplesSectionProps) {
  const [open, setOpen] = useState(true);

  const visible = tests.filter((t) => !t.hidden);
  const visibleById = useMemo(() => {
    const map = new Map<string, (typeof visible)[number]>();
    for (const t of visible) map.set(t.name, t);
    return map;
  }, [visible]);

  const resultsByName = new Map(report?.results.map((r) => [r.name, r] as const) ?? []);
  const visibleResults = visible.map((t) => resultsByName.get(t.name) ?? null);
  const passed = visibleResults.filter((r) => r && r.passed).length;
  const hasRun = visibleResults.some((r) => r !== null);
  const allPassedVisible = hasRun && passed === visible.length;

  // Auto-expand the first failure's index so the learner's eye is drawn to
  // the thing they need to fix. If nothing failed (or nothing ran), we don't
  // scroll; the top of the list is fine.
  const harnessErrored = !!report?.harnessError && !hasRun;
  const summary = harnessErrored
    ? "Your code couldn't run — fix the error and try again"
    : !hasRun
      ? `${visible.length} ${visible.length === 1 ? "example" : "examples"} — try one`
      : allPassedVisible
        ? `All ${visible.length} pass`
        : `${passed} of ${visible.length} pass`;

  // Color easing: don't snap to warn-orange the moment *any* test fails.
  // Partial progress (some-pass) stays neutral muted so the learner doesn't
  // feel scolded for making progress; only go warn when everything failed.
  const summaryColor = harnessErrored
    ? "text-danger"
    : !hasRun
      ? "text-muted"
      : allPassedVisible
        ? "text-success"
        : passed === 0
          ? "text-warn"
          : "text-muted";

  if (visible.length === 0) return null;
  void visibleById;

  return (
    <section
      aria-labelledby="examples-heading"
      className="mt-5 overflow-hidden rounded-xl border border-border bg-panel/40"
    >
      <header className="flex items-center gap-2 px-3 py-2">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 text-left focus:outline-none focus-visible:rounded focus-visible:ring-2 focus-visible:ring-accent"
          aria-expanded={open}
          aria-controls="examples-body"
        >
          <svg
            className={`h-3 w-3 transition ${open ? "rotate-90" : ""}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
          <span id="examples-heading" className="text-xs font-semibold uppercase tracking-wide text-ink/90">
            Examples
          </span>
        </button>
        <span
          className={`text-[11px] ${summaryColor}`}
          role="status"
          aria-live="polite"
        >
          {summary}
        </span>
        <div className="flex-1" />
        <button
          onClick={onRunExamples}
          disabled={running}
          className="flex items-center gap-1 rounded-md bg-accent/15 px-2.5 py-1 text-[11px] font-semibold text-accent transition hover:bg-accent/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
          title="Run every visible example"
          aria-label={running ? "Running examples…" : "Run all visible examples"}
        >
          {running ? (
            <>
              <span className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />
              Running…
            </>
          ) : (
            <>
              <span aria-hidden="true">▶</span> Run examples
            </>
          )}
        </button>
      </header>

      {open && (
        <div id="examples-body" className="space-y-1.5 border-t border-border px-3 py-2.5">
          {visible.map((t, i) => (
            <TestExampleCard key={t.name} test={t} result={visibleResults[i]} />
          ))}
          <p className="mt-1 text-[10px] leading-relaxed text-faint">
            Check My Work also runs a few additional hidden cases to make sure your function handles tricky inputs.
          </p>
        </div>
      )}
    </section>
  );
}
