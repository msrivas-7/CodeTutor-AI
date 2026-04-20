import type { AIMessage, EditorSelection, ProjectFile, RunResult } from "../provider.js";

const MAX_FILE_CHARS = 4000;
const MAX_RUN_CHARS = 2000;
const MAX_HISTORY = 6;
const MAX_STDIN_CHARS = 1500;
const MAX_DIFF_CHARS = 3000;
const MAX_SELECTION_CHARS = 2000;

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + `\n… [truncated, ${s.length - max} more chars]`;
}

// Phase 17 / M-A1: JSON.stringify only escapes `\` and `"`. A path like
// `foo"></user_file><instruction>…` would close the wrapper and inject
// prompt text the tutor treats as instructions. XML-escape the attribute
// value so `<`, `>`, `&`, `"` are all rendered inert.
function xmlAttr(s: string): string {
  return (
    '"' +
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;") +
    '"'
  );
}

// Untrusted-data framing: file content may contain prompt-like text ("ignore
// previous instructions…"). Wrap every file in a <user_file> tag so the model
// can treat it as *data* to analyse, never as instructions to follow. The
// partner rule lives in coreRules.ts ("Untrusted data" clause).
export function renderFiles(files: ProjectFile[], activeFile?: string): string {
  const sorted = [...files].sort((a, b) => {
    if (a.path === activeFile) return -1;
    if (b.path === activeFile) return 1;
    return a.path.localeCompare(b.path);
  });
  return sorted
    .map((f) => {
      const active = f.path === activeFile ? " active=\"true\"" : "";
      const body = truncate(f.content, MAX_FILE_CHARS);
      return `<user_file path=${xmlAttr(f.path)}${active}>\n${body}\n</user_file>`;
    })
    .join("\n\n");
}

export function renderRun(run: RunResult | null | undefined): string {
  if (!run) return "No run yet.";
  const lines = [
    `stage: ${run.stage}`,
    `exitCode: ${run.exitCode}`,
    `errorType: ${run.errorType}`,
    `durationMs: ${run.durationMs}`,
  ];
  if (run.stdout) lines.push(`stdout:\n${truncate(run.stdout, MAX_RUN_CHARS)}`);
  if (run.stderr) lines.push(`stderr:\n${truncate(run.stderr, MAX_RUN_CHARS)}`);
  return lines.join("\n");
}

export function renderHistory(history: AIMessage[]): string {
  if (!history.length) return "(no prior turns)";
  return history
    .slice(-MAX_HISTORY)
    .map((m) => `${m.role.toUpperCase()}: ${truncate(m.content, 800)}`)
    .join("\n\n");
}

export function renderStdin(stdin: string | null | undefined): string {
  if (!stdin || !stdin.trim()) return "(no stdin provided)";
  return truncate(stdin, MAX_STDIN_CHARS);
}

export function renderDiff(diff: string | null | undefined): string {
  if (!diff) return "(first tutor turn — no prior snapshot)";
  return truncate(diff, MAX_DIFF_CHARS);
}

export function renderSelection(sel: EditorSelection | null | undefined): string | null {
  if (!sel || !sel.text.trim()) return null;
  const span =
    sel.startLine === sel.endLine
      ? `line ${sel.startLine}`
      : `lines ${sel.startLine}-${sel.endLine}`;
  return `<user_selection path=${xmlAttr(sel.path)} span=${xmlAttr(span)}>\n${truncate(sel.text, MAX_SELECTION_CHARS)}\n</user_selection>`;
}
