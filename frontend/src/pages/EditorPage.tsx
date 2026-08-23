import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
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
import {
  resolveEditorProjectConflict,
  retryEditorProjectSave,
  useEditorProjectPersistence,
} from "../hooks/useEditorProjectPersistence";
import { useAIStore } from "../state/aiStore";
import { useProjectStore, consumePendingEditorStdin, starterStdin } from "../state/projectStore";
import { useRunStore } from "../state/runStore";
import { SettingsModal } from "../components/SettingsModal";
import { UserMenu } from "../components/UserMenu";
import { FeedbackButton } from "../components/FeedbackButton";
import { Wordmark } from "../components/Wordmark";
import { StreakChip } from "../features/learning/components/StreakChip";
import { SessionErrorBanner } from "../components/SessionErrorBanner";
import { SessionRestartBanner } from "../components/SessionRestartBanner";
import { SessionReplacedModal } from "../components/SessionReplacedModal";
import { NarrowViewportGate } from "../components/NarrowViewportGate";
import { SkipToContent } from "../components/SkipToContent";
import { EditorCoach } from "../components/EditorCoach";
import { usePreferencesStore } from "../state/preferencesStore";
import {
  clamp,
  clampSide,
  usePersistedNumber,
  useLocalStorageFlag,
  useNarrowViewport,
} from "../util/layoutPrefs";
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
  const bumpFocusComposer = useAIStore((s) => s.bumpFocusComposer);
  const [tutorComposerElement, setTutorComposerElement] = useState<HTMLTextAreaElement | null>(null);
  const switchProjectContext = useProjectStore((s) => s.switchProjectContext);
  const editorProjectContext = useProjectStore((s) => s.projectContext);
  const [editorReadyContext, setEditorReadyContext] = useState<string | null>(null);
  const handleEditorReadiness = useCallback((key: string) => {
    setEditorReadyContext(key);
  }, []);
  const editorContextReady =
    editorProjectContext === "editor" && editorReadyContext === "editor";
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
  // Phase 27 bug fix: collapse flags moved from server-persisted
  // uiLayout to localStorage so a phone-collapse doesn't leak into
  // a desktop session. See useLessonLayout.ts for the same fix on
  // the lesson page.
  const [tutorCollapsed, setTutorCollapsed] = useLocalStorageFlag(LS_TUTOR, false);
  const tutorOpenNonce = useAIStore((s) => s.tutorOpenNonce);
  const handledTutorOpenNonceRef = useRef(0);
  const pendingTutorOpenFocusRef = useRef(0);
  const [filesCollapsed, setFilesCollapsed] = useLocalStorageFlag(LS_FILES, false);
  const [showSettings, setShowSettings] = useState(false);
  const [showCoach, setShowCoach] = useState(false);
  const [resolvingConflict, setResolvingConflict] = useState(false);
  const [editorFocusRequest, setEditorFocusRequest] = useState<{
    path: string;
    ticket: number;
  } | null>(null);
  const editorFocusTicket = useRef(0);
  const editorSaveConflict = useProjectStore((s) => s.editorSaveConflict);
  const editorSaveError = useProjectStore((s) => s.editorSaveError);

  // A20: below 1024 px three columns are too tight. Auto-collapse the files
  // rail once per mount so new arrivals on tablet see a usable two-column
  // layout; user can still open it manually.
  const narrow = useNarrowViewport(1024);
  const compact = useNarrowViewport(640);
  const workspaceConstrained = useNarrowViewport(1366);
  const filesPaneWidth = compact ? "calc(100vw - 44px)" : leftW;
  const tutorPaneWidth = compact ? "calc(100vw - 44px)" : rightW;
  const autoCollapsedRef = useRef(false);
  const autoCollapsedTutorRef = useRef(false);
  useEffect(() => {
    if (narrow && !autoCollapsedRef.current) {
      autoCollapsedRef.current = true;
      setFilesCollapsed(true);
    }
  }, [narrow, setFilesCollapsed]);
  useEffect(() => {
    if (compact && !autoCollapsedTutorRef.current) {
      autoCollapsedTutorRef.current = true;
      setTutorCollapsed(true);
    }
  }, [compact, setTutorCollapsed]);

  const langPickerRef = useRef<HTMLLabelElement>(null);
  const editorHeadingRef = useRef<HTMLHeadingElement>(null);
  const fileTreeRef = useRef<HTMLElement>(null);
  const editorRef = useRef<HTMLElement>(null);
  const runButtonRef = useRef<HTMLButtonElement>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  const tutorRef = useRef<HTMLElement>(null);
  const filesRestoreRef = useRef<HTMLButtonElement>(null);
  const tutorRestoreRef = useRef<HTMLButtonElement>(null);

  const handleEditorConflictChoice = async (choice: "remote" | "local") => {
    setResolvingConflict(true);
    const resolved = await resolveEditorProjectConflict(choice);
    setResolvingConflict(false);
    const activeFile = useProjectStore.getState().activeFile;
    if (resolved && activeFile) {
      editorFocusTicket.current += 1;
      setEditorFocusRequest({
        path: activeFile,
        ticket: editorFocusTicket.current,
      });
    }
  };

  const handleEditorFocusRequestSettled = (ticket: number) => {
    setEditorFocusRequest((request) =>
      request?.ticket === ticket ? null : request,
    );
  };

  useEffect(() => {
    if (tutorOpenNonce <= handledTutorOpenNonceRef.current) return;
    handledTutorOpenNonceRef.current = tutorOpenNonce;
    pendingTutorOpenFocusRef.current = tutorOpenNonce;
    if (workspaceConstrained) setFilesCollapsed(true);
    setTutorCollapsed(false);
  }, [tutorOpenNonce, workspaceConstrained, setFilesCollapsed, setTutorCollapsed]);

  useLayoutEffect(() => {
    const pendingNonce = pendingTutorOpenFocusRef.current;
    if (pendingNonce === 0 || tutorCollapsed) return;

    let frame: number | null = null;
    let attempts = 0;
    const focusOpenedTutor = () => {
      const target = tutorRef.current;
      if (
        target &&
        document.contains(target) &&
        target.getAttribute("aria-hidden") !== "true" &&
        !target.hasAttribute("inert")
      ) {
        target.focus({ preventScroll: true });
        if (document.activeElement === target) {
          if (pendingTutorOpenFocusRef.current === pendingNonce) {
            pendingTutorOpenFocusRef.current = 0;
          }
          return;
        }
      }

      attempts += 1;
      if (attempts < 4) frame = requestAnimationFrame(focusOpenedTutor);
    };

    // Opening the animated rail and removing `inert` are React commits, not
    // frame-count guarantees. Fulfil the focus handoff only after the final
    // Tutor surface is mounted and observed as document.activeElement.
    focusOpenedTutor();
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [tutorCollapsed, tutorOpenNonce]);

  const editorCoachDone = usePreferencesStore((s) => s.editorCoachDone);
  useEffect(() => {
    if (!editorCoachDone && !compact) {
      const t = setTimeout(() => setShowCoach(true), COACH_AUTO_OPEN_MS);
      return () => clearTimeout(t);
    }
  }, [compact, editorCoachDone]);

  // Onboarding state is account-scoped while panel collapse state is local to
  // the browser. A new account can therefore inherit collapsed rails from a
  // previous user and receive a coach step pointing at an invisible sliver.
  // Keep every surface the coach teaches open for the duration of the tour so
  // the highlighted product controls are genuinely available to try.
  useEffect(() => {
    if (!showCoach) return;
    if (compact) {
      setShowCoach(false);
      setFilesCollapsed(true);
      setTutorCollapsed(true);
      return;
    }
    setFilesCollapsed(false);
    setTutorCollapsed(false);
  }, [compact, showCoach, setFilesCollapsed, setTutorCollapsed]);

  return (
    <div className="flex h-full flex-col bg-bg text-ink">
      <SkipToContent />
      <header className="relative z-30 flex flex-wrap items-center justify-between gap-2 border-b border-border bg-panel/80 px-3 py-2 backdrop-blur sm:px-4">
        <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto sm:gap-3">
          <button
            onClick={() => nav("/start")}
            className="inline-flex min-h-11 items-center rounded-lg px-3 py-2 text-sm font-medium text-ink/80 transition hover:bg-elevated hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            aria-label="Back to home"
          >
            ← Home
          </button>
          <span className="hidden lg:inline-flex"><Wordmark size="sm" /></span>
          <span className="hidden h-4 w-px bg-border lg:inline-block" aria-hidden="true" />
          <h1
            ref={editorHeadingRef}
            tabIndex={-1}
            className="text-[14px] font-medium tracking-tight text-ink focus:outline-none"
          >
            Editor
          </h1>
          <nav className="ml-auto flex items-center overflow-hidden rounded-md border border-border text-[11px] sm:ml-2" aria-label="Mode switcher">
            <span
              aria-current="page"
              className="inline-flex min-h-11 items-center bg-accent/15 px-3 py-2 text-sm font-semibold text-accentInk"
            >
              Editor
            </span>
            <button
              onClick={() => nav("/learn")}
              className="min-h-11 border-l border-border bg-transparent px-3 py-2 text-sm text-muted transition hover:bg-elevated hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
              title="Switch to guided learning mode"
            >
              Learning
            </button>
          </nav>
        </div>
        {/* Phase 21B (iter-3): streak chip absolute-anchored to header
            centre — exact midpoint regardless of left/right content
            widths. */}
        <div className="pointer-events-none absolute left-1/2 hidden -translate-x-1/2 xl:block">
          <div className="pointer-events-auto"><StreakChip /></div>
        </div>
        <div className="flex w-full flex-wrap items-center justify-between gap-2 sm:w-auto sm:justify-end">
          <Toolbar langPickerRef={langPickerRef} runButtonRef={runButtonRef} />
          <StatusBadge />
          <span className="hidden sm:inline-flex"><FeedbackButton /></span>
          <UserMenu />
        </div>
      </header>

      <SessionErrorBanner recoveryFocusRef={runButtonRef} />
      <SessionRestartBanner />
      <SessionReplacedModal />
      {editorSaveConflict && (
        <div
          role="alert"
          className="flex flex-col gap-2 border-b border-warn/40 bg-warn/10 px-4 py-3 text-sm text-ink sm:flex-row sm:items-center"
        >
          <div className="min-w-0 flex-1">
            <div className="font-semibold">This project changed somewhere else.</div>
            <div className="mt-0.5 text-xs text-muted">
              Both versions are safe until you decide which one should be saved.
              {editorSaveError ? ` ${editorSaveError}` : ""}
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={resolvingConflict}
              onClick={() => void handleEditorConflictChoice("remote")}
              className="min-h-11 rounded-lg border border-border bg-panel px-3 py-2 text-xs font-semibold text-muted transition hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
            >
              Use newer saved version
            </button>
            <button
              type="button"
              disabled={resolvingConflict}
              onClick={() => void handleEditorConflictChoice("local")}
              className="min-h-11 rounded-lg bg-warn/20 px-3 py-2 text-xs font-semibold text-warn ring-1 ring-warn/40 transition hover:bg-warn/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warn disabled:opacity-60"
            >
              {resolvingConflict ? "Saving…" : "Keep this version"}
            </button>
          </div>
        </div>
      )}
      {editorSaveError && !editorSaveConflict && (
        <div
          role="alert"
          className="flex min-h-11 flex-wrap items-center gap-3 border-b border-warn/40 bg-warn/10 px-4 py-2 text-sm"
        >
          <span className="min-w-0 flex-1 text-ink">
            {editorSaveError} We'll retry automatically when you're back online.
          </span>
          <button
            type="button"
            onClick={retryEditorProjectSave}
            className="min-h-11 rounded-lg border border-warn/40 px-3 py-2 font-semibold text-warn transition hover:bg-warn/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warn"
          >
            Retry sync
          </button>
        </div>
      )}

      <main id="main-content" className="flex min-h-0 flex-1 overflow-hidden">
        {/* Files panel — collapsible. Cinema Kit Continuity Pass:
            same width-animation pattern as the LessonPage tutor +
            instructions panels. Aside stays mounted; framer
            animates width between 0 (collapsed) and leftW
            (expanded) over 220 ms. The vertical strip-button shows
            only when collapsed; splitter only when expanded. */}
        {filesCollapsed && (
          <button
            ref={filesRestoreRef}
            onClick={() => {
              if (workspaceConstrained) setTutorCollapsed(true);
              setFilesCollapsed(false);
              requestAnimationFrame(() =>
                fileTreeRef.current
                  ?.querySelector<HTMLButtonElement>('[aria-label="Collapse files"]')
                  ?.focus(),
              );
            }}
            title="Show files"
            aria-label="Show files panel"
            className="flex w-11 shrink-0 flex-col items-center justify-start gap-2 border-r border-border bg-panel pt-3 text-muted transition hover:bg-elevated hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
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
          animate={{ width: filesCollapsed ? 0 : filesPaneWidth }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          className="min-h-0 shrink-0 overflow-hidden border-r border-border bg-panel"
          aria-hidden={filesCollapsed ? "true" : undefined}
          {...((filesCollapsed ? { inert: "" } : {}) as Record<string, unknown>)}
        >
          {/* Padding lives on an inner wrapper, NOT the animating
              aside, so the box-sizing math when width animates to 0
              doesn't leave a ~24 px residual strip of bg-panel. The
              other three asides in this app already follow this
              pattern; this one was the odd one out. */}
          <div
            className={`h-full p-3 ${filesCollapsed ? "invisible" : "visible"}`}
            style={{ width: filesPaneWidth, minWidth: filesPaneWidth }}
          >
            <FileTree onCollapse={() => {
              setFilesCollapsed(true);
              requestAnimationFrame(() => filesRestoreRef.current?.focus());
            }} />
          </div>
        </motion.aside>
        {!filesCollapsed && !compact && (
          <Splitter
            orientation="vertical"
            valueNow={leftW}
            valueMin={BOUNDS.left[0]}
            valueMax={BOUNDS.left[1]}
            valueText={`Files panel ${Math.round(leftW)} pixels wide`}
            onDrag={(dx) => setLeftW((w) => clampSide(w + dx, BOUNDS.left))}
            onDoubleClick={() => setLeftW(DEFAULTS.left)}
          />
        )}

        <section ref={editorRef} className="flex min-w-0 flex-1 flex-col">
          <EditorTabs />
          <div className="min-h-0 flex-1">
            <Suspense fallback={<div className="p-4 text-sm text-muted">Loading editor…</div>}>
              <MonacoPane
                focusRequest={editorFocusRequest}
                onFocusRequestSettled={handleEditorFocusRequestSettled}
                readinessKey={editorProjectContext}
                onReadinessConfirmed={handleEditorReadiness}
              />
            </Suspense>
          </div>
          <Splitter
            orientation="horizontal"
            valueNow={outputH}
            valueMin={BOUNDS.out[0]}
            valueMax={BOUNDS.out[1]}
            valueText={`Output panel ${Math.round(outputH)} pixels high`}
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
            ref={tutorRestoreRef}
            onClick={() => {
              if (workspaceConstrained) setFilesCollapsed(true);
              setTutorCollapsed(false);
              requestAnimationFrame(() =>
                tutorRef.current
                  ?.querySelector<HTMLButtonElement>('[aria-label="Collapse tutor"]')
                  ?.focus(),
              );
            }}
            title="Show tutor"
            aria-label="Show tutor panel"
            className="flex w-11 shrink-0 flex-col items-center justify-start gap-2 border-l border-border bg-panel pt-3 text-muted transition hover:bg-elevated hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
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
        {!tutorCollapsed && !compact && (
          <Splitter
            orientation="vertical"
            valueNow={rightW}
            valueMin={BOUNDS.right[0]}
            valueMax={BOUNDS.right[1]}
            valueText={`Tutor panel ${Math.round(rightW)} pixels wide`}
            onDrag={(dx) => setRightW((w) => clampSide(w - dx, BOUNDS.right))}
            onDoubleClick={() => setRightW(DEFAULTS.right)}
          />
        )}
        <motion.aside
          ref={tutorRef as React.RefObject<HTMLElement>}
          tabIndex={-1}
          aria-label="AI tutor"
          initial={false}
          animate={{ width: tutorCollapsed ? 0 : tutorPaneWidth }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          className="min-h-0 shrink-0 overflow-hidden bg-panel"
          aria-hidden={tutorCollapsed ? "true" : undefined}
          {...((tutorCollapsed ? { inert: "" } : {}) as Record<string, unknown>)}
        >
          <AssistantPanel inputLocked={!editorContextReady} onComposerElement={setTutorComposerElement} onCollapse={() => {
            setTutorCollapsed(true);
            requestAnimationFrame(() => tutorRestoreRef.current?.focus());
          }} onOpenSettings={() => setShowSettings(true)} />
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
          onComplete={(outcome) => {
            const destination = outcome === "completed"
              ? tutorComposerElement
              : editorHeadingRef.current;
            destination?.focus({ preventScroll: true });
            setShowCoach(false);
            if (!destination && outcome === "completed") {
              requestAnimationFrame(() => bumpFocusComposer());
            }
          }}
        />
      )}
      <NarrowViewportGate />
    </div>
  );
}
