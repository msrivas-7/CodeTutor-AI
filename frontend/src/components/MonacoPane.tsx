import Editor, { type Monaco, type OnMount } from "@monaco-editor/react";
import { useEffect, useRef } from "react";
import type { editor as MonacoEditor } from "monaco-editor";
import { useProjectStore, type RevealTarget } from "../state/projectStore";
import { useAIStore } from "../state/aiStore";
import { monacoLangFor } from "../types";

// Custom dark theme tuned to the app palette so the editor feels like part of
// the product instead of a drop-in. Colors lean on the same semantic tokens
// (bg/panel/elevated/border/ink/muted/accent/violet/success).
function defineTheme(monaco: Monaco) {
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
}

export function MonacoPane() {
  const { activeFile, files, setContent, pendingReveal } = useProjectStore();
  const setActiveSelection = useAIStore((s) => s.setActiveSelection);
  const bumpFocusComposer = useAIStore((s) => s.bumpFocusComposer);
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);

  const applyReveal = (t: RevealTarget) => {
    const ed = editorRef.current;
    if (!ed) return;
    const line = Math.max(1, t.line);
    const column = Math.max(1, t.column ?? 1);
    ed.revealLineInCenter(line);
    ed.setPosition({ lineNumber: line, column });
    ed.focus();
  };

  useEffect(() => {
    if (pendingReveal && pendingReveal.path === activeFile) {
      applyReveal(pendingReveal);
    }
  }, [pendingReveal, activeFile]);

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    // Apply any pending reveal recorded before this editor instance existed —
    // typical when clicking a ref that switches the active file, which
    // remounts the Editor (we key on activeFile).
    if (pendingReveal && pendingReveal.path === activeFile) {
      applyReveal(pendingReveal);
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
    editor.onDidChangeCursorSelection(() => {
      captureSelection();
    });

    // Cmd/Ctrl-K: pull focus to the composer, carrying the current selection
    // (if any) along. A keyboard-only path for students who want to ask without
    // reaching for the mouse.
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK, () => {
      captureSelection();
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
      theme="ai-dark"
      beforeMount={defineTheme}
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
        smoothScrolling: true,
        cursorBlinking: "smooth",
        cursorSmoothCaretAnimation: "on",
        padding: { top: 12, bottom: 12 },
        scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
        guides: { indentation: true, bracketPairs: true },
        bracketPairColorization: { enabled: true },
      }}
      loading={<div className="p-4 text-sm text-muted">Loading editor…</div>}
    />
  );
}
