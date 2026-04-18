import type { FunctionTest, TestCaseResult } from "../types";

type Status = "idle" | "pass" | "miss" | "error";

interface TestExampleCardProps {
  test: FunctionTest;
  result: TestCaseResult | null;
}

// Soft failure vocabulary — never a red X for a miss. Icons: ⬤ idle, ✓ pass,
// → got something else, ⚠ raised an exception. sr-only labels satisfy WCAG
// 1.1.1; the card's role="group" aria-label summarises state so SRs don't
// need to re-read the glyph. No badge chip — color + icon + sr-only is enough
// and avoids the "MISS" shout that contradicted the soft copy.
export function TestExampleCard({ test, result }: TestExampleCardProps) {
  const status: Status = !result
    ? "idle"
    : result.error
      ? "error"
      : result.passed
        ? "pass"
        : "miss";

  const styles = statusStyles[status];

  return (
    <div
      role="group"
      aria-label={`Example ${test.name} — ${statusLabels[status]}`}
      className={`rounded-lg border px-3 py-2 transition ${styles.container}`}
    >
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className={`text-xs ${styles.icon}`}>
          {statusIcons[status]}
        </span>
        <span className="sr-only">{statusLabels[status]}:</span>
        <code className="flex-1 truncate font-mono text-[11px] text-ink">{test.call}</code>
      </div>

      {status === "idle" && (
        <div className="mt-1.5 text-[11px] text-muted">
          Expected: <code className="rounded bg-elevated px-1 py-0.5 font-mono text-[10px] text-accent">{test.expected}</code>
        </div>
      )}

      {status === "pass" && (
        <div className="mt-1.5 text-[11px] text-success/80">
          Returned <code className="rounded bg-success/10 px-1 py-0.5 font-mono text-[10px]">{result!.actualRepr ?? test.expected}</code>
        </div>
      )}

      {status === "miss" && (
        <div className="mt-1.5 flex flex-col gap-0.5 text-[11px]">
          <div>
            <span className="text-muted">Expected: </span>
            <code className="rounded bg-elevated px-1 py-0.5 font-mono text-[10px] text-accent">{result!.expectedRepr ?? test.expected}</code>
          </div>
          <div>
            <span className="text-warn/80">Got: </span>
            <code className="rounded bg-warn/10 px-1 py-0.5 font-mono text-[10px] text-warn">{result!.actualRepr ?? "(no value)"}</code>
          </div>
        </div>
      )}

      {status === "error" && (
        <div className="mt-1.5 text-[11px]">
          <span className="text-danger/80">Error: </span>
          <code className="rounded bg-danger/10 px-1 py-0.5 font-mono text-[10px] text-danger">
            {(result!.error ?? "").split("\n").slice(-1)[0].slice(0, 120) || "exception raised"}
          </code>
        </div>
      )}
    </div>
  );
}

const statusIcons: Record<Status, string> = {
  idle: "⬤",
  pass: "✓",
  miss: "→",
  error: "⚠",
};

const statusLabels: Record<Status, string> = {
  idle: "Not run yet",
  pass: "Passed",
  miss: "Got something else",
  error: "Raised an error",
};

const statusStyles: Record<Status, { container: string; icon: string }> = {
  idle: {
    container: "border-border bg-panel/60",
    icon: "text-faint",
  },
  pass: {
    container: "border-success/30 bg-success/5",
    icon: "text-success",
  },
  miss: {
    container: "border-warn/30 bg-warn/5",
    icon: "text-warn",
  },
  error: {
    container: "border-danger/30 bg-danger/5",
    icon: "text-danger",
  },
};
