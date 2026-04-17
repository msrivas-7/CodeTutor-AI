import { useState } from "react";
import type { LessonMeta } from "../types";
import { CoachRail } from "./CoachRail";

export interface CoachState {
  hasEdited: boolean;
  hasRun: boolean;
  hasError: boolean;
  hasChecked: boolean;
  checkPassed: boolean;
  failedCheckCount: number;
  lessonComplete: boolean;
  tutorConfigured: boolean;
}

interface LessonInstructionsPanelProps {
  meta: LessonMeta;
  content: string;
  onCollapse?: () => void;
  coachState?: CoachState;
}

export function LessonInstructionsPanel({ meta, content, onCollapse, coachState }: LessonInstructionsPanelProps) {
  const [showHints, setShowHints] = useState(false);
  const hints = extractHints(content);
  const mainContent = stripHintsSection(content);

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

      <div className="flex-1 overflow-y-auto px-4 py-3">
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
              <ol className="mt-2 space-y-1.5 pl-4">
                {hints.map((hint, i) => (
                  <li key={i} className="text-xs text-muted list-decimal">
                    {hint}
                  </li>
                ))}
              </ol>
            )}
          </div>
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
        <ol key={`ol-${i}`} className="my-1 space-y-0.5 pl-4">
          {items.map((item, j) => (
            <li key={j} className="list-decimal text-xs">{renderInline(item)}</li>
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
