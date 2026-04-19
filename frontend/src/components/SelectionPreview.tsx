import type { EditorSelection } from "../types";

// Chip that previews the code the user highlighted in Monaco before they
// send the question. Rendered by both AssistantPanel (editor mode) and
// GuidedTutorPanel (lesson mode) — the markup was copy-pasted between
// them until this extraction.
export function SelectionPreview({
  selection,
  onClear,
}: {
  selection: EditorSelection;
  onClear: () => void;
}) {
  const lineLabel = selection.startLine === selection.endLine
    ? selection.startLine
    : `${selection.startLine}-${selection.endLine}`;
  const previewLines = selection.text
    .replace(/\t/g, "  ")
    .split("\n")
    .slice(0, 2)
    .map((l) => (l.length > 80 ? l.slice(0, 80) + "…" : l))
    .join("\n");
  const truncated = selection.text.split("\n").length > 2;

  return (
    <div className="mb-1.5 rounded-md border border-accent/40 bg-accent/5 px-2 py-1.5">
      <div className="flex items-center gap-1.5">
        <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wider text-accent">
          Selection
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-accent/90">
          {selection.path}:{lineLabel}
        </span>
        <button
          onClick={onClear}
          title="Remove selection"
          aria-label="Remove selection"
          className="shrink-0 rounded px-1 text-[11px] leading-none text-muted transition hover:bg-elevated hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          ×
        </button>
      </div>
      <pre className="mt-1 max-h-10 overflow-hidden whitespace-pre rounded bg-bg/60 px-1.5 py-1 font-mono text-[10px] leading-snug text-ink/80">
        {previewLines}
        {truncated ? "\n…" : ""}
      </pre>
    </div>
  );
}
