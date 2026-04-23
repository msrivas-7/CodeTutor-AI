import Editor, { type Monaco, type OnMount } from "@monaco-editor/react";
import { useEffect, useRef } from "react";
import type { editor as MonacoEditor } from "monaco-editor";
import { useProjectStore, type RevealTarget } from "../state/projectStore";
import { useAIStore } from "../state/aiStore";
import { monacoLangFor } from "../types";
import { useEffectiveTheme } from "../util/theme";

// Custom themes tuned to the app palette so the editor feels like part of the
// product. Dark maps to bg/panel/elevated tokens; light uses the inverse
// greyscale with accent-tinted selection so both moods share the same identity.
function defineThemes(monaco: Monaco) {
  monaco.editor.defineTheme("ai-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "", foreground: "e6ecf5" },
      { token: "comment", foreground: "64748b", fontStyle: "italic" },
      { token: "keyword", foreground: "c084fc" },
      { token: "string", foreground: "34d399" },
      { token: "number", foreground: "fbbf24" },
      { token: "type", foreground: "38bdf8" },
      { token: "delimiter", foreground: "94a3b8" },
      { token: "identifier", foreground: "e6ecf5" },
      { token: "function", foreground: "38bdf8" },
      { token: "variable", foreground: "e6ecf5" },
      { token: "namespace", foreground: "c084fc" },
    ],
    colors: {
      "editor.background": "#0b1020",
      "editor.foreground": "#e6ecf5",
      "editor.lineHighlightBackground": "#131b2e",
      "editor.selectionBackground": "#38bdf833",
      "editor.inactiveSelectionBackground": "#38bdf81a",
      "editorLineNumber.foreground": "#475569",
      "editorLineNumber.activeForeground": "#94a3b8",
      "editorCursor.foreground": "#38bdf8",
      "editorIndentGuide.background": "#1a243b",
      "editorIndentGuide.activeBackground": "#334155",
      "editorBracketMatch.background": "#38bdf822",
      "editorBracketMatch.border": "#38bdf866",
      "editorWidget.background": "#131b2e",
      "editorWidget.border": "#1f2a44",
      "editorSuggestWidget.background": "#131b2e",
      "editorSuggestWidget.border": "#1f2a44",
      "editorSuggestWidget.selectedBackground": "#38bdf822",
      "editorGutter.background": "#0b1020",
      "scrollbarSlider.background": "#1f2a4488",
      "scrollbarSlider.hoverBackground": "#2a3753aa",
      "scrollbarSlider.activeBackground": "#38bdf866",
    },
  });
  monaco.editor.defineTheme("ai-light", {
    base: "vs",
    inherit: true,
    rules: [
      { token: "", foreground: "0f172a" },
      { token: "comment", foreground: "94a3b8", fontStyle: "italic" },
      { token: "keyword", foreground: "7c3aed" },
      { token: "string", foreground: "059669" },
      { token: "number", foreground: "b45309" },
      { token: "type", foreground: "0284c7" },
      { token: "delimiter", foreground: "64748b" },
      { token: "identifier", foreground: "0f172a" },
      { token: "function", foreground: "0284c7" },
      { token: "variable", foreground: "0f172a" },
      { token: "namespace", foreground: "7c3aed" },
    ],
    colors: {
      "editor.background": "#ffffff",
      "editor.foreground": "#0f172a",
      "editor.lineHighlightBackground": "#f1f5f9",
      "editor.selectionBackground": "#0ea5e933",
      "editor.inactiveSelectionBackground": "#0ea5e91a",
      "editorLineNumber.foreground": "#94a3b8",
      "editorLineNumber.activeForeground": "#334155",
      "editorCursor.foreground": "#0284c7",
      "editorIndentGuide.background": "#e2e8f0",
      "editorIndentGuide.activeBackground": "#94a3b8",
      "editorBracketMatch.background": "#0ea5e922",
      "editorBracketMatch.border": "#0ea5e966",
      "editorWidget.background": "#f8fafc",
      "editorWidget.border": "#e2e8f0",
      "editorSuggestWidget.background": "#ffffff",
      "editorSuggestWidget.border": "#e2e8f0",
      "editorSuggestWidget.selectedBackground": "#0ea5e922",
      "editorGutter.background": "#ffffff",
      "scrollbarSlider.background": "#94a3b888",
      "scrollbarSlider.hoverBackground": "#64748baa",
      "scrollbarSlider.activeBackground": "#0284c766",
    },
  });
}

// A5: Monaco's cursor + scroll animations aren't covered by our global CSS
// `prefers-reduced-motion` rule because they're driven by canvas/JS inside the
// editor. Resolve the OS-level preference once at mount so the options object
// below can disable them for users who opt out.
const reducedMotion =
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function MonacoPane() {
  // P-C1: scoped selectors — a no-arg `useProjectStore()` re-renders on every
  // file-tree reorder / tab change, dragging Monaco through a full re-render
  // storm on navigation. Files map is shallow-compared so only content edits
  // to the ACTIVE file trigger a pass (Monaco's own model is still the source
  // of truth during typing; we read files[activeFile] only on file switch).
  const activeFile = useProjectStore((s) => s.activeFile);
  const files = useProjectStore((s) => s.files);
  const setContent = useProjectStore((s) => s.setContent);
  const pendingReveal = useProjectStore((s) => s.pendingReveal);
  const setActiveSelection = useAIStore((s) => s.setActiveSelection);
  const bumpFocusComposer = useAIStore((s) => s.bumpFocusComposer);
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const theme = useEffectiveTheme();

  // A14: track the last-applied reveal ticket so activeFile-driven re-runs of
  // the effect don't steal focus back into Monaco after the user has clicked
  // away (e.g. switching tabs after a tutor code-ref reveal). Fresh reveals
  // still focus the editor; replays do not.
  const lastRevealTicket = useRef<number | null>(null);

  const applyReveal = (t: RevealTarget, { focus }: { focus: boolean }) => {
    const ed = editorRef.current;
    if (!ed) return;
    const line = Math.max(1, t.line);
    const column = Math.max(1, t.column ?? 1);
    ed.revealLineInCenter(line);
    ed.setPosition({ lineNumber: line, column });
    if (focus) ed.focus();
  };

  useEffect(() => {
    if (pendingReveal && pendingReveal.path === activeFile) {
      const isFresh = lastRevealTicket.current !== pendingReveal.ticket;
      applyReveal(pendingReveal, { focus: isFresh });
      lastRevealTicket.current = pendingReveal.ticket;
    }
  }, [pendingReveal, activeFile]);

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    // Apply any pending reveal recorded before this editor instance existed —
    // typical when clicking a ref that switches the active file, which
    // remounts the Editor (we key on activeFile). Fresh reveals still focus
    // the editor; replays of an already-applied ticket do not (A14).
    if (pendingReveal && pendingReveal.path === activeFile) {
      const isFresh = lastRevealTicket.current !== pendingReveal.ticket;
      applyReveal(pendingReveal, { focus: isFresh });
      lastRevealTicket.current = pendingReveal.ticket;
    }

    const captureSelection = () => {
      const sel = editor.getSelection();
      const model = editor.getModel();
      const path = activeFile;
      if (sel && model && path && !sel.isEmpty()) {
        setActiveSelection({
          path,
          startLine: sel.startLineNumber,
          endLine: sel.endLineNumber,
          text: model.getValueInRange(sel),
        });
        return true;
      }
      return false;
    };

    // Auto-capture any non-empty selection so just highlighting in the editor
    // attaches that range to the tutor. Collapsing the selection (clicking to
    // move the caret) is NOT treated as a clear — otherwise clicking into the
    // composer to type would drop the context the student just picked. Use the
    // × on the selection chip to dismiss explicitly.
    //
    // P-M5: rAF-throttle the capture path. Monaco fires onDidChangeCursorSelection
    // on every pixel of a drag-select, which previously triggered one aiStore
    // update per fire (and a re-render of every component subscribed to the
    // store). Coalescing to once-per-frame is imperceptible to the user and
    // drops the update rate by ~60x on a fast selection. The trailing blur
    // event forces a final flush so the last state is always captured.
    let pendingSelectionRaf: number | null = null;
    const scheduleCapture = (): void => {
      if (pendingSelectionRaf != null) return;
      pendingSelectionRaf = requestAnimationFrame(() => {
        pendingSelectionRaf = null;
        captureSelection();
      });
    };
    const flushCapture = (): void => {
      if (pendingSelectionRaf != null) {
        cancelAnimationFrame(pendingSelectionRaf);
        pendingSelectionRaf = null;
      }
      captureSelection();
    };
    editor.onDidChangeCursorSelection(scheduleCapture);
    editor.onDidBlurEditorWidget(flushCapture);

    // Cmd/Ctrl-K: pull focus to the composer, carrying the current selection
    // (if any) along. A keyboard-only path for students who want to ask without
    // reaching for the mouse. Flush any pending rAF so the composer sees the
    // very latest selection rather than the one-frame-stale value.
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK, () => {
      flushCapture();
      bumpFocusComposer();
    });
  };

  if (!activeFile) {
    return (
      <div className="flex h-full items-center justify-center bg-bg text-sm text-muted">
        No file open. Create or select one from the file tree.
      </div>
    );
  }

  return (
    <Editor
      key={activeFile}
      path={activeFile}
      language={monacoLangFor(activeFile)}
      value={files[activeFile] ?? ""}
      onChange={(v) => setContent(activeFile, v ?? "")}
      onMount={handleMount}
      theme={theme === "light" ? "ai-light" : "ai-dark"}
      beforeMount={defineThemes}
      options={{
        fontSize: 13,
        fontFamily: "'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace",
        fontLigatures: true,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        automaticLayout: true,
        tabSize: 2,
        wordWrap: "on",
        renderWhitespace: "selection",
        renderLineHighlight: "all",
        smoothScrolling: !reducedMotion,
        cursorBlinking: reducedMotion ? "solid" : "smooth",
        cursorSmoothCaretAnimation: reducedMotion ? "off" : "on",
        // A4: name the editor region so SR announcements include the file
        // path, and let Monaco speak inline suggestions as the user types.
        ariaLabel: `Code editor for ${activeFile}`,
        screenReaderAnnounceInlineSuggestion: true,
        padding: { top: 12, bottom: 12 },
        scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
        guides: { indentation: true, bracketPairs: true },
        bracketPairColorization: { enabled: true },
      }}
      loading={<div className="p-4 text-sm text-muted">Loading editor…</div>}
    />
  );
}
