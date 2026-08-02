import { useEffect, useRef, useState } from "react";
import { useProjectStore } from "../state/projectStore";
import { TutorResponseView } from "./TutorResponseViews";
import type { SavedTutorMessage } from "../api/client";
import type { TutorSections } from "../types";

// Phase 21A: "Saved · N" accordion above live tutor history.
//
// Design (per /Users/mehul/.claude/plans/hazy-wishing-wren.md):
//   - Furniture already in the room: renders with opacity-1 from first
//     paint when there are saved messages. The live history below is the
//     new arrival — it fades in. Component returns null if 0 saved.
//   - Header copy: "Saved · N" — text-meta, text-muted, weight 500. No
//     icon in header. Letter-spacing 0.01em. Past-tense, possessive.
//   - Collapsed by default. Chevron at right edge fades in 600ms after
//     first paint so the accordion lands as a presence first, becomes
//     interactive second.
//   - Per-row Remove: hover-only. Bookmark glyph (filled) at left at
//     opacity-0.6, lifts to 0.9 on row-hover; × at right edge 0 → 0.7.
//   - Reduced-motion: instant chevron + instant row removal.

const HOUSE_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

interface Props {
  messages: SavedTutorMessage[];
  loading: boolean;
  onRemove: (id: string) => void;
  label?: string;
}

export function SavedTutorAccordion({ messages, loading, onRemove, label }: Props) {
  const [expanded, setExpanded] = useState(false);
  // Chevron defers its arrival so the accordion presence registers first.
  const [chevronReady, setChevronReady] = useState(false);
  // 600ms post-mount, the chevron fades in. Reduced-motion users skip
  // the deferral via the `motion-reduce:transition-none` rule on the
  // chevron itself (it's still rendered with opacity-1 immediately).
  const [pendingRemoval, setPendingRemoval] = useState<string | null>(null);
  const removeTimer = useRef<number | null>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => setChevronReady(true), 600);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => () => {
    if (removeTimer.current !== null) window.clearTimeout(removeTimer.current);
  }, []);

  const requestRemove = (id: string) => {
    if (removeTimer.current !== null) window.clearTimeout(removeTimer.current);
    setPendingRemoval(id);
    removeTimer.current = window.setTimeout(() => {
      onRemove(id);
      setPendingRemoval(null);
      removeTimer.current = null;
    }, 5_000);
  };
  const undoRemove = () => {
    if (removeTimer.current !== null) window.clearTimeout(removeTimer.current);
    removeTimer.current = null;
    setPendingRemoval(null);
  };
  const visibleMessages = messages.filter((message) => message.id !== pendingRemoval);

  // Empty state: render nothing. Apple does not show empty bins.
  if (messages.length === 0 && !loading) return null;
  if (messages.length === 0) return null; // also nothing during a fresh first-load

  return (
    <section
      aria-label="Saved tutor messages"
      // Peer band between the panel header and the chat scroll area.
      // shrink-0 so it never gets squeezed when the chat grows.
      className="shrink-0 border-b border-border bg-elevated/20"
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-[11px] font-medium text-muted transition-colors hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        style={{ letterSpacing: "0.01em" }}
      >
        <span className="inline-flex items-center gap-1.5">
          <svg
            aria-hidden="true"
            width="11"
            height="11"
            viewBox="0 0 16 16"
            fill="currentColor"
            className="text-accent/70"
          >
            <path d="M3.5 2h9a.5.5 0 0 1 .5.5v11.4a.3.3 0 0 1-.48.24L8 10.5l-4.52 3.64A.3.3 0 0 1 3 13.9V2.5a.5.5 0 0 1 .5-.5z" />
          </svg>
          <span>{label ?? (messages[0]?.courseId ? "Saved for this lesson" : "Saved in this project")} · {messages.length}</span>
        </span>
        <svg
          aria-hidden="true"
          width="10"
          height="10"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="motion-reduce:transition-none"
          style={{
            opacity: chevronReady ? 0.7 : 0,
            transition: `opacity 240ms ${HOUSE_EASE}, transform 240ms ${HOUSE_EASE}`,
            transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
          }}
        >
          <path d="M5 3l5 5-5 5" />
        </svg>
      </button>
      {expanded && (
        <div
          // Bound the expanded panel so it never crowds the chat. Internal
          // scroll handles overflow. 40vh = comfortable peek without
          // dominating the panel.
          className="flex max-h-[40vh] flex-col gap-1.5 overflow-y-auto border-t border-border px-3 pb-2.5 pt-2"
          style={{ animation: `savedAccordionExpand 320ms ${HOUSE_EASE}` }}
        >
          {visibleMessages.map((m, idx) => (
            <SavedRow
              key={m.id}
              message={m}
              onRemove={() => requestRemove(m.id)}
              staggerMs={idx * 40}
            />
          ))}
        </div>
      )}
      {pendingRemoval && (
        <div role="status" className="flex min-h-11 items-center justify-between border-t border-border bg-panel px-3 py-2 text-xs text-muted">
          <span>Saved message removed</span>
          <button type="button" onClick={undoRemove} className="min-h-11 rounded-lg px-3 py-2 font-semibold text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">Undo</button>
        </div>
      )}
      <style>{`
        @keyframes savedAccordionExpand {
          from { opacity: 0; transform: translateY(-2px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes savedRowEnter {
          from { opacity: 0; transform: translateY(-4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          [data-saved-row-enter] { animation: none !important; }
        }
      `}</style>
    </section>
  );
}

function SavedRow({
  message,
  onRemove,
  staggerMs,
}: {
  message: SavedTutorMessage;
  onRemove: () => void;
  staggerMs: number;
}) {
  const [hover, setHover] = useState(false);

  // Saved messages preserve the structured `sections` if present; fall
  // back to plain content rendering for older saves.
  const sections = (message.sections ?? null) as TutorSections | null;
  const currentFiles = useProjectStore((state) => state.files);
  const savedContext = message.sections?.__savedContext as
    | { activeFile?: string; files?: Array<{ path: string; content: string }> }
    | undefined;
  const sourceChanged = !!savedContext?.files?.some(
    (file) => currentFiles[file.path] !== file.content,
  );
  const displaySections = sections
    ? {
        ...sections,
        citations: sourceChanged ? null : sections.citations,
        walkthrough: sourceChanged
          ? sections.walkthrough?.map((step) => ({ ...step, path: null, line: null }))
          : sections.walkthrough,
      }
    : null;

  return (
    <div
      data-saved-row-enter
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="group relative rounded-md border border-border bg-bg/40 p-2"
      style={{
        animation: `savedRowEnter 240ms ${HOUSE_EASE} ${staggerMs}ms backwards`,
      }}
    >
      <div className="flex items-start gap-2">
        {/* Filled bookmark, leading. Hover lifts opacity. */}
        <span
          aria-hidden="true"
          className="mt-0.5 inline-flex h-3 w-3 shrink-0 items-center justify-center text-accent transition-opacity"
          style={{
            opacity: hover ? 0.9 : 0.6,
            transitionDuration: "120ms",
            transitionTimingFunction: HOUSE_EASE,
          }}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 16 16"
            fill="currentColor"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          >
            <path d="M3.5 2h9a.5.5 0 0 1 .5.5v11.4a.3.3 0 0 1-.48.24L8 10.5l-4.52 3.64A.3.3 0 0 1 3 13.9V2.5a.5.5 0 0 1 .5-.5z" />
          </svg>
        </span>
        <div className="min-w-0 flex-1 text-[12px] text-ink">
          <div className="mb-2 text-[10px] leading-relaxed text-muted">
            Saved {new Date(message.createdAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
            {savedContext?.activeFile ? ` · ${savedContext.activeFile}` : ""}
          </div>
          {sourceChanged && (
            <div role="note" className="mb-2 rounded-md border border-warn/40 bg-warn/10 px-2 py-1.5 text-[11px] leading-relaxed text-warnInk">
              Your code has changed since this was saved. References stay disabled so they cannot jump to the wrong source.
            </div>
          )}
          {displaySections ? (
            <TutorResponseView sections={displaySections} />
          ) : (
            <div className="whitespace-pre-wrap break-words leading-relaxed">
              {message.content}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          aria-label="Remove from saved"
          className="shrink-0 rounded p-0.5 text-muted transition-opacity hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 motion-reduce:transition-none"
          style={{
            opacity: hover ? 0.9 : 0.55,
            transitionDuration: "120ms",
            transitionTimingFunction: HOUSE_EASE,
          }}
        >
          <svg
            aria-hidden="true"
            width="12"
            height="12"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          >
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>
    </div>
  );
}
