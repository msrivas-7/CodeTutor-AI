import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { StatusBadge } from "../components/StatusBadge";
import { FileTree } from "../components/FileTree";
import { MonacoPane } from "../components/MonacoPane";
import { EditorTabs } from "../components/EditorTabs";
import { OutputPanel } from "../components/OutputPanel";
import { Toolbar } from "../components/Toolbar";
import { AssistantPanel } from "../components/AssistantPanel";
import { StatusBar } from "../components/StatusBar";
import { Splitter } from "../components/Splitter";
import { useSessionLifecycle } from "../hooks/useSessionLifecycle";
import { useGlobalShortcuts } from "../hooks/useGlobalShortcuts";
import { useEditorProjectPersistence } from "../hooks/useEditorProjectPersistence";
import { useAIStore } from "../state/aiStore";
import { useProjectStore, consumePendingEditorStdin, starterStdin } from "../state/projectStore";
import { useRunStore } from "../state/runStore";
import { SettingsModal } from "../components/SettingsModal";
import { UserMenu } from "../components/UserMenu";
import { SessionErrorBanner } from "../components/SessionErrorBanner";
import { SessionRestartBanner } from "../components/SessionRestartBanner";
import { EditorCoach } from "../components/EditorCoach";
import { usePreferencesStore } from "../state/preferencesStore";
import { clamp, clampSide, usePersistedNumber, usePersistedFlag } from "../util/layoutPrefs";
import { COACH_AUTO_OPEN_MS } from "../util/timings";

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

export default function EditorPage() {
  const nav = useNavigate();
  const switchChatContext = useAIStore((s) => s.switchChatContext);
  const switchProjectContext = useProjectStore((s) => s.switchProjectContext);
  const switchRunContext = useRunStore((s) => s.switchRunContext);
  useSessionLifecycle();
  useGlobalShortcuts();
  useEditorProjectPersistence();

  // Empty deps: the store setters are stable Zustand references that never
  // change between renders, and this effect is a one-shot "entering editor
  // mode" bootstrap — re-running it on every render would reset context
  // mid-session and drop in-flight work.
  useEffect(() => {
    switchChatContext("editor");
    switchProjectContext("editor");
    // Persisted stdin (if any) was captured during auth-time editor-project
    // hydration; consume it here so the first Editor visit after sign-in
    // seeds it. Falls back to the current language's starter stdin so a
    // cold /editor visit (no persisted project yet) still ships the
    // starter's example input — without this fallback, switchRunContext
    // coalesces stdin to "" and the starter prints its "no input" branch.
    const pendingStdin = consumePendingEditorStdin();
    const effectiveStdin =
      pendingStdin !== null ? pendingStdin : starterStdin(useProjectStore.getState().language);
    switchRunContext("editor", { stdin: effectiveStdin });
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  const [leftW, setLeftW] = usePersistedNumber(LS_LEFT, DEFAULTS.left);
  const [rightW, setRightW] = usePersistedNumber(LS_RIGHT, DEFAULTS.right);
  const [outputH, setOutputH] = usePersistedNumber(LS_OUT, DEFAULTS.out);
  const [tutorCollapsed, setTutorCollapsed] = usePersistedFlag(LS_TUTOR, false);
  const [filesCollapsed, setFilesCollapsed] = usePersistedFlag(LS_FILES, false);
  const [showSettings, setShowSettings] = useState(false);
  const [showCoach, setShowCoach] = useState(false);

  const langPickerRef = useRef<HTMLLabelElement>(null);
  const fileTreeRef = useRef<HTMLElement>(null);
  const editorRef = useRef<HTMLElement>(null);
  const runButtonRef = useRef<HTMLButtonElement>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  const tutorRef = useRef<HTMLElement>(null);

  const editorCoachDone = usePreferencesStore((s) => s.editorCoachDone);
  useEffect(() => {
    if (!editorCoachDone) {
      const t = setTimeout(() => setShowCoach(true), COACH_AUTO_OPEN_MS);
      return () => clearTimeout(t);
    }
  }, [editorCoachDone]);

  return (
    <div className="flex h-full flex-col bg-bg text-ink">
      <header className="flex items-center justify-between border-b border-border bg-panel/80 px-4 py-2 backdrop-blur">
        <div className="flex items-center gap-3">
          <button
            onClick={() => nav("/")}
            className="rounded px-2 py-1 text-xs font-medium text-ink/80 transition hover:bg-elevated hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            aria-label="Back to home"
          >
            ← Home
          </button>
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-accent to-violet text-[11px] font-bold text-bg shadow-glow">
            AI
          </div>
          <h1 className="text-sm font-semibold tracking-tight text-ink">
            CodeTutor AI
          </h1>
          <nav className="ml-2 flex items-center overflow-hidden rounded-md border border-border text-[11px]" aria-label="Mode switcher">
            <span
              aria-current="page"
              className="bg-accent/15 px-2.5 py-1 font-semibold text-accent"
            >
              Editor
            </span>
            <button
              onClick={() => nav("/learn")}
              className="border-l border-border bg-transparent px-2.5 py-1 text-muted transition hover:bg-elevated hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
              title="Switch to guided learning mode"
            >
              Learning
            </button>
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <Toolbar langPickerRef={langPickerRef} runButtonRef={runButtonRef} />
          <StatusBadge />
          <UserMenu />
        </div>
      </header>

      <SessionErrorBanner />
      <SessionRestartBanner />

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
              ref={fileTreeRef}
              style={{ width: leftW }}
              className="min-h-0 shrink-0 overflow-hidden border-r border-border bg-panel p-3"
            >
              <FileTree onCollapse={() => setFilesCollapsed(true)} />
            </aside>

            <Splitter
              orientation="vertical"
              onDrag={(dx) => setLeftW((w) => clampSide(w + dx, BOUNDS.left))}
              onDoubleClick={() => setLeftW(DEFAULTS.left)}
            />
          </>
        )}

        <section ref={editorRef} className="flex min-w-0 flex-1 flex-col">
          <EditorTabs />
          <div className="min-h-0 flex-1">
            <MonacoPane />
          </div>
          <Splitter
            orientation="horizontal"
            onDrag={(dy) => setOutputH((h) => clamp(h - dy, BOUNDS.out))}
            onDoubleClick={() => setOutputH(DEFAULTS.out)}
          />
          <div ref={outputRef} style={{ height: outputH }} className="min-h-0 shrink-0">
            <OutputPanel />
          </div>
        </section>

        {tutorCollapsed ? (
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
              onDrag={(dx) => setRightW((w) => clampSide(w - dx, BOUNDS.right))}
              onDoubleClick={() => setRightW(DEFAULTS.right)}
            />
            <aside
              ref={tutorRef}
              style={{ width: rightW }}
              className="min-h-0 shrink-0 overflow-hidden bg-panel"
            >
              <AssistantPanel onCollapse={() => setTutorCollapsed(true)} onOpenSettings={() => setShowSettings(true)} />
            </aside>
          </>
        )}
      </main>

      <StatusBar />
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      {showCoach && (
        <EditorCoach
          refs={{
            langPicker: langPickerRef.current,
            fileTree: fileTreeRef.current,
            editor: editorRef.current,
            runButton: runButtonRef.current,
            outputPanel: outputRef.current,
            tutorPanel: tutorRef.current,
          }}
          onComplete={() => setShowCoach(false)}
        />
      )}
    </div>
  );
}
