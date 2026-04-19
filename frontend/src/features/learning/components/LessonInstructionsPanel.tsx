import { useEffect, useState } from "react";
import type { FunctionTest, LessonMeta, TestCaseResult, TestReport } from "../types";
import { CoachRail } from "./CoachRail";
import { ExamplesSection } from "./ExamplesSection";
import { FailedTestCallout } from "./FailedTestCallout";

export interface CoachState {
  hasEdited: boolean;
  hasRun: boolean;
  hasError: boolean;
  hasChecked: boolean;
  checkPassed: boolean;
  failedCheckCount: number;
  lessonComplete: boolean;
  tutorConfigured: boolean;
  hasFunctionTests?: boolean;
  failedVisibleTests?: number;
  failedHiddenTests?: number;
  passedVisibleTests?: number;
}

interface LessonInstructionsPanelProps {
  meta: LessonMeta;
  content: string;
  onCollapse?: () => void;
  coachState?: CoachState;
  functionTests?: FunctionTest[];
  testReport?: TestReport | null;
  runningTests?: boolean;
  onRunExamples?: () => void;
  /** The single failure to surface after Check My Work. Rendered as a
   *  FailedTestCallout above the markdown when set. */
  checkFailure?: TestCaseResult | null;
  /** Consecutive Check My Work fails on the same failure. Controls the
   *  "Ask tutor why" gate inside FailedTestCallout. */
  checkFailureStreak?: number;
  onAskTutorAboutFailure?: () => void;
}

export function LessonInstructionsPanel({
  meta,
  content,
  onCollapse,
  coachState,
  functionTests,
  testReport,
  runningTests,
  onRunExamples,
  checkFailure,
  checkFailureStreak,
  onAskTutorAboutFailure,
}: LessonInstructionsPanelProps) {
  const [showHints, setShowHints] = useState(false);
  const hints = extractHints(content);
  const mainContent = stripHintsSection(content);

  const hasExamples = !!(functionTests && functionTests.length > 0 && onRunExamples);
  const [tab, setTab] = useState<"instructions" | "examples">("instructions");
  const activeTab = hasExamples ? tab : "instructions";

  // When a Check My Work fails, auto-switch to the Examples tab so the callout
  // and the example list are both visible without the learner having to hunt.
  useEffect(() => {
    if (hasExamples && checkFailure) setTab("examples");
  }, [hasExamples, checkFailure]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex items-center gap-2 border-b border-border px-4 py-2">
        <h2 className="flex-1 truncate text-sm font-semibold">{meta.title}</h2>
        <span className="text-[10px] text-muted">~{meta.estimatedMinutes} min</span>
        {onCollapse && (
          <button
            onClick={onCollapse}
            title="Collapse instructions"
            className="rounded p-1 text-muted transition hover:bg-elevated hover:text-ink"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M5.5 3.5L10 8l-4.5 4.5L4 11l3-3-3-3z" />
            </svg>
          </button>
        )}
      </header>

      {hasExamples && (
        <div role="tablist" aria-label="Lesson sections" className="flex shrink-0 border-b border-border">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "instructions"}
            onClick={() => setTab("instructions")}
            className={`flex-1 px-3 py-1.5 text-[11px] font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent ${
              activeTab === "instructions"
                ? "border-b-2 border-accent text-ink"
                : "border-b-2 border-transparent text-muted hover:text-ink"
            }`}
          >
            Instructions
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "examples"}
            onClick={() => setTab("examples")}
            className={`flex-1 px-3 py-1.5 text-[11px] font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent ${
              activeTab === "examples"
                ? "border-b-2 border-accent text-ink"
                : "border-b-2 border-transparent text-muted hover:text-ink"
            }`}
          >
            Examples
            {checkFailure && activeTab !== "examples" && (
              <span
                className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-warn align-middle"
                aria-label="failing example"
              />
            )}
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {activeTab === "instructions" ? (
          <>
            {coachState && <CoachRail {...coachState} />}
            <div className="mb-3 flex flex-wrap gap-1.5">
              {meta.objectives.map((obj) => (
                <span
                  key={obj}
                  className="rounded-full bg-violet/10 px-2 py-0.5 text-[10px] font-medium text-violet"
                >
                  {obj}
                </span>
              ))}
            </div>

            <div className="prose-learning text-sm leading-relaxed text-ink/90">
              <MarkdownContent text={mainContent} />
            </div>

            {hints.length > 0 && (
              <div className="mt-4 border-t border-border pt-3">
                <button
                  onClick={() => setShowHints(!showHints)}
                  className="flex items-center gap-1 text-xs font-medium text-accent transition hover:text-accent/80"
                >
                  <svg
                    className={`h-3 w-3 transition ${showHints ? "rotate-90" : ""}`}
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
                    {hints.map((hint, i) => (
                      <li key={i} className="text-xs text-muted">
                        {hint}
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            )}
          </>
        ) : (
          <>
            {checkFailure && (
              <FailedTestCallout
                failure={checkFailure}
                failingTest={functionTests?.find((t) => t.name === checkFailure.name && !t.hidden)}
                consecutiveFails={checkFailureStreak ?? 1}
                onAskTutor={onAskTutorAboutFailure}
              />
            )}
            <ExamplesSection
              tests={functionTests!}
              report={testReport ?? null}
              running={!!runningTests}
              onRunExamples={onRunExamples!}
            />
          </>
        )}
      </div>
    </div>
  );
}

function MarkdownContent({ text }: { text: string }) {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith("### ")) {
      elements.push(<h3 key={i} className="mb-1 mt-3 text-xs font-bold uppercase tracking-wide text-muted">{line.slice(4)}</h3>);
    } else if (line.startsWith("## ")) {
      elements.push(<h2 key={i} className="mb-1 mt-4 text-sm font-bold">{line.slice(3)}</h2>);
    } else if (line.startsWith("# ")) {
      elements.push(<h1 key={i} className="mb-2 mt-4 text-base font-bold">{line.slice(2)}</h1>);
    } else if (line.startsWith("```")) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      elements.push(
        <pre key={`code-${i}`} className="my-2 overflow-x-auto rounded-lg bg-elevated p-3 text-xs">
          <code>{codeLines.join("\n")}</code>
        </pre>
      );
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      const items: string[] = [line.slice(2)];
      while (i + 1 < lines.length && (lines[i + 1].startsWith("- ") || lines[i + 1].startsWith("* "))) {
        i++;
        items.push(lines[i].slice(2));
      }
      elements.push(
        <ul key={`ul-${i}`} className="my-1 space-y-0.5 pl-4">
          {items.map((item, j) => (
            <li key={j} className="list-disc text-xs">{renderInline(item)}</li>
          ))}
        </ul>
      );
    } else if (/^\d+\.\s/.test(line)) {
      const items: string[] = [line.replace(/^\d+\.\s/, "")];
      while (i + 1 < lines.length && /^\d+\.\s/.test(lines[i + 1])) {
        i++;
        items.push(lines[i].replace(/^\d+\.\s/, ""));
      }
      elements.push(
        <ol key={`ol-${i}`} className="my-1 list-decimal space-y-0.5 pl-5">
          {items.map((item, j) => (
            <li key={j} className="text-xs">{renderInline(item)}</li>
          ))}
        </ol>
      );
    } else if (line.trim() === "") {
      elements.push(<div key={i} className="h-2" />);
    } else {
      elements.push(<p key={i} className="text-xs leading-relaxed">{renderInline(line)}</p>);
    }

    i++;
  }

  return <>{elements}</>;
}

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={i} className="rounded bg-elevated px-1 py-0.5 text-[11px] text-accent">
          {part.slice(1, -1)}
        </code>
      );
    }
    const boldParts = part.split(/(\*\*[^*]+\*\*)/g);
    return boldParts.map((bp, j) => {
      if (bp.startsWith("**") && bp.endsWith("**")) {
        return <strong key={`${i}-${j}`}>{bp.slice(2, -2)}</strong>;
      }
      return bp;
    });
  });
}

function extractHints(content: string): string[] {
  const hintsMatch = content.match(/## Hints[\s\S]*?(?=\n## |$)/i);
  if (!hintsMatch) return [];
  const section = hintsMatch[0];
  const hints: string[] = [];
  for (const line of section.split("\n")) {
    const m = line.match(/^\d+\.\s+(.+)/);
    if (m) hints.push(m[1]);
  }
  return hints;
}

function stripHintsSection(content: string): string {
  return content.replace(/## Hints[\s\S]*?(?=\n## |$)/i, "").trim();
}
