import { useEffect, useState } from "react";
import { StatusBadge } from "./components/StatusBadge";
import { FileTree } from "./components/FileTree";
import { MonacoPane } from "./components/MonacoPane";
import { EditorTabs } from "./components/EditorTabs";
import { OutputPanel } from "./components/OutputPanel";
import { Toolbar } from "./components/Toolbar";
import { AssistantPanel } from "./components/AssistantPanel";
import { StatusBar } from "./components/StatusBar";
import { Splitter } from "./components/Splitter";
import { useSessionLifecycle } from "./hooks/useSessionLifecycle";
import { useGlobalShortcuts } from "./hooks/useGlobalShortcuts";

const LS_LEFT = "ui:leftW";
const LS_RIGHT = "ui:rightW";
const LS_OUT = "ui:outputH";
const LS_TUTOR = "ui:tutorCollapsed";
const LS_FILES = "ui:filesCollapsed";

const DEFAULTS = { left: 240, right: 400, out: 256 };
const BOUNDS = {
  left: [180, 480] as const,
  right: [260, 700] as const,
  out: [80, 600] as const,
};

function loadNum(key: string, fallback: number): number {
  try {
    const v = Number(localStorage.getItem(key));
    return Number.isFinite(v) && v > 0 ? v : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: string | number): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* quota or disabled — ignore */
  }
}

function clamp(v: number, [min, max]: readonly [number, number]): number {
  return Math.max(min, Math.min(max, v));
}

export default function App() {
  useSessionLifecycle();
  useGlobalShortcuts();

  const [leftW, setLeftW] = useState(() => loadNum(LS_LEFT, DEFAULTS.left));
  const [rightW, setRightW] = useState(() => loadNum(LS_RIGHT, DEFAULTS.right));
  const [outputH, setOutputH] = useState(() => loadNum(LS_OUT, DEFAULTS.out));
  const [tutorCollapsed, setTutorCollapsed] = useState(() => {
    try { return localStorage.getItem(LS_TUTOR) === "1"; } catch { return false; }
  });
  const [filesCollapsed, setFilesCollapsed] = useState(() => {
    try { return localStorage.getItem(LS_FILES) === "1"; } catch { return false; }
  });

  useEffect(() => save(LS_LEFT, leftW), [leftW]);
  useEffect(() => save(LS_RIGHT, rightW), [rightW]);
  useEffect(() => save(LS_OUT, outputH), [outputH]);
  useEffect(() => save(LS_TUTOR, tutorCollapsed ? "1" : "0"), [tutorCollapsed]);
  useEffect(() => save(LS_FILES, filesCollapsed ? "1" : "0"), [filesCollapsed]);

  return (
    <div className="flex h-full flex-col bg-bg text-ink">
      <header className="flex items-center justify-between border-b border-border bg-panel/80 px-4 py-2 backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-accent to-violet text-[11px] font-bold text-bg shadow-glow">
            AI
          </div>
          <h1 className="text-sm font-semibold tracking-tight text-ink">
            AI Code Editor
          </h1>
        </div>
        <div className="flex items-center gap-4">
          <Toolbar />
          <StatusBadge />
        </div>
      </header>

      <main className="flex min-h-0 flex-1 overflow-hidden">
        {filesCollapsed ? (
          <button
            onClick={() => setFilesCollapsed(false)}
            title="Show files"
            className="flex w-6 shrink-0 flex-col items-center justify-start gap-2 border-r border-border bg-panel pt-3 text-muted transition hover:bg-elevated hover:text-ink"
          >
            <span className="text-[12px]">▸</span>
            <span
              className="text-[10px] font-semibold uppercase tracking-wider"
              style={{ writingMode: "vertical-rl" }}
            >
              Files
            </span>
          </button>
        ) : (
          <>
            <aside
              style={{ width: leftW }}
              className="min-h-0 shrink-0 overflow-hidden border-r border-border bg-panel p-3"
            >
              <FileTree onCollapse={() => setFilesCollapsed(true)} />
            </aside>

            <Splitter
              orientation="vertical"
              onDrag={(dx) => setLeftW((w) => clamp(w + dx, BOUNDS.left))}
              onDoubleClick={() => setLeftW(DEFAULTS.left)}
            />
          </>
        )}

        <section className="flex min-w-0 flex-1 flex-col">
          <EditorTabs />
          <div className="min-h-0 flex-1">
            <MonacoPane />
          </div>
          <Splitter
            orientation="horizontal"
            onDrag={(dy) => setOutputH((h) => clamp(h - dy, BOUNDS.out))}
            onDoubleClick={() => setOutputH(DEFAULTS.out)}
          />
          <div style={{ height: outputH }} className="min-h-0 shrink-0">
            <OutputPanel />
          </div>
        </section>

        {tutorCollapsed ? (
          // Slim rail with a reveal arrow so the tutor is one click away.
          <button
            onClick={() => setTutorCollapsed(false)}
            title="Show tutor"
            className="flex w-6 shrink-0 flex-col items-center justify-start gap-2 border-l border-border bg-panel pt-3 text-muted transition hover:bg-elevated hover:text-ink"
          >
            <span className="text-[12px]">◂</span>
            <span
              className="text-[10px] font-semibold uppercase tracking-wider"
              style={{ writingMode: "vertical-rl" }}
            >
              Tutor
            </span>
          </button>
        ) : (
          <>
            <Splitter
              orientation="vertical"
              onDrag={(dx) => setRightW((w) => clamp(w - dx, BOUNDS.right))}
              onDoubleClick={() => setRightW(DEFAULTS.right)}
            />
            <aside
              style={{ width: rightW }}
              className="min-h-0 shrink-0 overflow-hidden bg-panel"
            >
              <AssistantPanel onCollapse={() => setTutorCollapsed(true)} />
            </aside>
          </>
        )}
      </main>

      <StatusBar />
    </div>
  );
}
