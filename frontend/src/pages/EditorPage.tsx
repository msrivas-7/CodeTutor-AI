import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { StatusBadge } from "../components/StatusBadge";
import { FileTree } from "../components/FileTree";
// P-H2: Monaco is ~1.5 MB of JS + workers. Dynamic-importing splits it into
// its own chunk that the landing / lesson-intro screens don't pay for on
// first load; the editor pulls it in when the page actually mounts.
const MonacoPane = lazy(() =>
  import("../components/MonacoPane").then((m) => ({ default: m.MonacoPane })),
);
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
import { FeedbackButton } from "../components/FeedbackButton";
import { Wordmark } from "../components/Wordmark";
import { SessionErrorBanner } from "../components/SessionErrorBanner";
import { SessionRestartBanner } from "../components/SessionRestartBanner";
import { SessionReplacedModal } from "../components/SessionReplacedModal";
import { NarrowViewportGate } from "../components/NarrowViewportGate";
import { SkipToContent } from "../components/SkipToContent";
import { EditorCoach } from "../components/EditorCoach";
import { usePreferencesStore } from "../state/preferencesStore";
import { clamp, clampSide, usePersistedNumber, usePersistedFlag, useNarrowViewport } from "../util/layoutPrefs";
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

  // A20: below 1024 px three columns are too tight. Auto-collapse the files
  // rail once per mount so new arrivals on tablet see a usable two-column
  // layout; user can still open it manually.
  const narrow = useNarrowViewport(1024);
  const autoCollapsedRef = useRef(false);
  useEffect(() => {
    if (narrow && !autoCollapsedRef.current) {
      autoCollapsedRef.current = true;
      setFilesCollapsed(true);
    }
  }, [narrow, setFilesCollapsed]);

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
      <SkipToContent />
      <header className="flex items-center justify-between border-b border-border bg-panel/80 px-4 py-2 backdrop-blur">
        <div className="flex items-center gap-3">
          <button
            onClick={() => nav("/")}
            className="rounded px-2 py-1 text-xs font-medium text-ink/80 transition hover:bg-elevated hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            aria-label="Back to home"
          >
            ← Home
          </button>
          <Wordmark size="sm" />
          <span className="h-4 w-px bg-border" aria-hidden="true" />
          <h1 className="text-[14px] font-medium tracking-tight text-ink">
            Editor
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
          <FeedbackButton />
          <UserMenu />
        </div>
      </header>

      <SessionErrorBanner />
      <SessionRestartBanner />
      <SessionReplacedModal />

      <main id="main-content" className="flex min-h-0 flex-1 overflow-hidden">
        {/* Files panel — collapsible. Cinema Kit Continuity Pass:
            same width-animation pattern as the LessonPage tutor +
            instructions panels. Aside stays mounted; framer
            animates width between 0 (collapsed) and leftW
            (expanded) over 220 ms. The vertical strip-button shows
            only when collapsed; splitter only when expanded. */}
        {filesCollapsed && (
          <button
            onClick={() => setFilesCollapsed(false)}
            title="Show files"
            aria-label="Show files panel"
            className="flex w-6 shrink-0 flex-col items-center justify-start gap-2 border-r border-border bg-panel pt-3 text-muted transition hover:bg-elevated hover:text-ink"
          >
            <span className="text-[12px]" aria-hidden="true">▸</span>
            <span
              className="text-[10px] font-semibold uppercase tracking-wider"
              style={{ writingMode: "vertical-rl" }}
            >
              Files
            </span>
          </button>
        )}
        <motion.aside
          ref={fileTreeRef as React.RefObject<HTMLElement>}
          initial={false}
          animate={{ width: filesCollapsed ? 0 : leftW }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          className="min-h-0 shrink-0 overflow-hidden border-r border-border bg-panel p-3"
          aria-hidden={filesCollapsed ? "true" : undefined}
          {...((filesCollapsed ? { inert: "" } : {}) as Record<string, unknown>)}
        >
          <FileTree onCollapse={() => setFilesCollapsed(true)} />
        </motion.aside>
        {!filesCollapsed && (
          <Splitter
            orientation="vertical"
            onDrag={(dx) => setLeftW((w) => clampSide(w + dx, BOUNDS.left))}
            onDoubleClick={() => setLeftW(DEFAULTS.left)}
          />
        )}

        <section ref={editorRef} className="flex min-w-0 flex-1 flex-col">
          <EditorTabs />
          <div className="min-h-0 flex-1">
            <Suspense fallback={<div className="p-4 text-sm text-muted">Loading editor…</div>}>
              <MonacoPane />
            </Suspense>
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

        {/* Tutor panel — collapsible. Cinema Kit Continuity Pass:
            same width-animation pattern as the file panel above. */}
        {tutorCollapsed && (
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
        )}
        {!tutorCollapsed && (
          <Splitter
            orientation="vertical"
            onDrag={(dx) => setRightW((w) => clampSide(w - dx, BOUNDS.right))}
            onDoubleClick={() => setRightW(DEFAULTS.right)}
          />
        )}
        <motion.aside
          ref={tutorRef as React.RefObject<HTMLElement>}
          initial={false}
          animate={{ width: tutorCollapsed ? 0 : rightW }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          className="min-h-0 shrink-0 overflow-hidden bg-panel"
          aria-hidden={tutorCollapsed ? "true" : undefined}
          {...((tutorCollapsed ? { inert: "" } : {}) as Record<string, unknown>)}
        >
          <AssistantPanel onCollapse={() => setTutorCollapsed(true)} onOpenSettings={() => setShowSettings(true)} />
        </motion.aside>
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
      <NarrowViewportGate />
    </div>
  );
}
