import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import confetti from "canvas-confetti";
import type { Lesson } from "../types";
import { loadFullLesson, loadCourse } from "../content/courseLoader";
import { useProgressStore, loadSavedCode } from "../stores/progressStore";
import { useLearnerStore } from "../stores/learnerStore";
import { LessonInstructionsPanel } from "../components/LessonInstructionsPanel";
import { GuidedTutorPanel } from "../components/GuidedTutorPanel";
import { MonacoPane } from "../../../components/MonacoPane";
import { EditorTabs } from "../../../components/EditorTabs";
import { OutputPanel } from "../../../components/OutputPanel";
import { Splitter } from "../../../components/Splitter";
import { SettingsModal } from "../../../components/SettingsModal";
import { useSessionLifecycle } from "../../../hooks/useSessionLifecycle";
import { useProjectStore } from "../../../state/projectStore";
import { useSessionStore } from "../../../state/sessionStore";
import { useRunStore } from "../../../state/runStore";
import { useAIStore } from "../../../state/aiStore";
import { api } from "../../../api/client";
import { validateLesson } from "../utils/validator";
import { LessonCompletePanel } from "../components/LessonCompletePanel";
import { WorkspaceCoach, isOnboardingDone } from "../components/WorkspaceCoach";
import type { ValidationResult } from "../types";

const LS_OUT_H = "ui:lesson:outputH";
const LS_INSTR_W = "ui:lesson:instrW";
const LS_TUTOR_W = "ui:lesson:tutorW";
const LS_INSTR_COLLAPSED = "ui:lesson:instrCollapsed";
const LS_TUTOR_COLLAPSED = "ui:lesson:tutorCollapsed";

const DEFAULT_OUT = 200;
const DEFAULT_INSTR = 320;
const DEFAULT_TUTOR = 340;
const BOUNDS_OUT = [80, 500] as const;
const BOUNDS_INSTR = [240, 520] as const;
const BOUNDS_TUTOR = [260, 600] as const;

function clamp(v: number, [min, max]: readonly [number, number]) {
  return Math.max(min, Math.min(max, v));
}

function loadNum(key: string, fallback: number): number {
  try {
    const v = Number(localStorage.getItem(key));
    return Number.isFinite(v) && v > 0 ? v : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: string | number): void {
  try { localStorage.setItem(key, String(value)); } catch { /* */ }
}

export default function LessonPage() {
  const { courseId, lessonId } = useParams<{
    courseId: string;
    lessonId: string;
  }>();
  const nav = useNavigate();
  const { identity } = useLearnerStore();
  const startLesson = useProgressStore((s) => s.startLesson);
  const completeLesson = useProgressStore((s) => s.completeLesson);
  const incrementRun = useProgressStore((s) => s.incrementRun);
  const saveCode = useProgressStore((s) => s.saveCode);
  const saveOutput = useProgressStore((s) => s.saveOutput);
  const resetLessonProgress = useProgressStore((s) => s.resetLessonProgress);
  const lessonProgressMap = useProgressStore((s) => s.lessonProgress);

  const switchChatContext = useAIStore((s) => s.switchChatContext);
  const switchProjectContext = useProjectStore((s) => s.switchProjectContext);
  const switchRunContext = useRunStore((s) => s.switchRunContext);
  useSessionLifecycle();

  useEffect(() => {
    if (!courseId || !lessonId) return;
    const ctxKey = `lesson:${courseId}/${lessonId}`;
    switchChatContext(ctxKey);
    switchRunContext(ctxKey);
  }, [courseId, lessonId]);  // eslint-disable-line react-hooks/exhaustive-deps

  const sessionId = useSessionStore((s) => s.sessionId);
  const sessionPhase = useSessionStore((s) => s.phase);
  const running = useRunStore((s) => s.running);
  const setRunning = useRunStore((s) => s.setRunning);
  const setResult = useRunStore((s) => s.setResult);
  const setRunError = useRunStore((s) => s.setError);
  const lastResult = useRunStore((s) => s.result);
  const setPendingAsk = useAIStore((s) => s.setPendingAsk);

  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [totalLessons, setTotalLessons] = useState(10);
  const [lessonOrder, setLessonOrder] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [showComplete, setShowComplete] = useState(false);
  const [resumed, setResumed] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [resetNonce, setResetNonce] = useState(0);
  const [confirmResetLesson, setConfirmResetLesson] = useState(false);
  const [hasEdited, setHasEdited] = useState(false);
  const [hasRun, setHasRun] = useState(false);
  const [hasChecked, setHasChecked] = useState(false);
  const [failedCheckCount, setFailedCheckCount] = useState(0);
  const [outputH, setOutputH] = useState(() => loadNum(LS_OUT_H, DEFAULT_OUT));
  const [instrW, setInstrW] = useState(() => loadNum(LS_INSTR_W, DEFAULT_INSTR));
  const [tutorW, setTutorW] = useState(() => loadNum(LS_TUTOR_W, DEFAULT_TUTOR));
  const [instrCollapsed, setInstrCollapsed] = useState(() => {
    try { return localStorage.getItem(LS_INSTR_COLLAPSED) === "1"; } catch { return false; }
  });
  const [tutorCollapsed, setTutorCollapsed] = useState(() => {
    try { return localStorage.getItem(LS_TUTOR_COLLAPSED) === "1"; } catch { return false; }
  });
  const initialized = useRef(false);
  const resumedTimer = useRef<ReturnType<typeof setTimeout>>();
  const [showCoach, setShowCoach] = useState(false);
  const instrRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLElement>(null);
  const runBtnRef = useRef<HTMLButtonElement>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  const checkBtnRef = useRef<HTMLButtonElement>(null);
  const tutorRef = useRef<HTMLElement>(null);

  useEffect(() => {
    return () => clearTimeout(resumedTimer.current);
  }, []);

  useEffect(() => save(LS_OUT_H, outputH), [outputH]);
  useEffect(() => save(LS_INSTR_W, instrW), [instrW]);
  useEffect(() => save(LS_TUTOR_W, tutorW), [tutorW]);
  useEffect(() => save(LS_INSTR_COLLAPSED, instrCollapsed ? "1" : "0"), [instrCollapsed]);
  useEffect(() => save(LS_TUTOR_COLLAPSED, tutorCollapsed ? "1" : "0"), [tutorCollapsed]);

  useEffect(() => {
    if (!courseId || !lessonId) return;
    initialized.current = false;
    setLoading(true);
    setValidation(null);
    setShowComplete(false);
    setHasEdited(false);
    setHasRun(false);
    setHasChecked(false);
    setFailedCheckCount(0);
    Promise.all([
      loadFullLesson(courseId, lessonId),
      loadCourse(courseId),
    ])
      .then(([l, course]) => {
        setLesson(l);
        setTotalLessons(course.lessonOrder.length);
        setLessonOrder(course.lessonOrder);
        startLesson(identity.learnerId, courseId, lessonId);
      })
      .catch(() => setLesson(null))
      .finally(() => setLoading(false));
  }, [courseId, lessonId, identity.learnerId, startLesson]);

  useEffect(() => {
    if (!lesson || !courseId || !lessonId || initialized.current) return;
    initialized.current = true;

    const savedCode = loadSavedCode(courseId, lessonId);

    const files: Record<string, string> = {};
    const order: string[] = [];

    if (savedCode && Object.keys(savedCode).length > 0) {
      for (const [path, content] of Object.entries(savedCode)) {
        files[path] = content;
        order.push(path);
      }
      setResumed(true);
      resumedTimer.current = setTimeout(() => setResumed(false), 3000);
    } else {
      for (const f of lesson.starterFiles) {
        files[f.path] = f.content;
        order.push(f.path);
      }
    }

    if (order.length === 0) {
      files["main.py"] = "# Write your code here\n";
      order.push("main.py");
    }

    const ctxKey = `lesson:${courseId}/${lessonId}`;
    switchProjectContext(ctxKey, {
      language: "python",
      files,
      order,
      activeFile: order[0],
      openTabs: [order[0]],
    });
  }, [lesson, courseId, lessonId]);  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!lesson || loading) return;
    if (!isOnboardingDone()) {
      const timer = setTimeout(() => setShowCoach(true), 600);
      return () => clearTimeout(timer);
    }
  }, [lesson, loading]);

  const handleRun = useCallback(async () => {
    if (!sessionId || sessionPhase !== "active" || running || !courseId || !lessonId) return;
    setRunning(true);
    setRunError(null);
    try {
      const files = useProjectStore.getState().snapshot();
      await api.snapshotProject(sessionId, files);
      const stdin = useRunStore.getState().stdin || undefined;
      const result = await api.execute(sessionId, "python", stdin);
      setResult(result);
      setHasRun(true);
      incrementRun(courseId, lessonId);
      if (result.stdout) {
        saveOutput(courseId, lessonId, result.stdout);
      }
      const codeMap: Record<string, string> = {};
      for (const f of files) codeMap[f.path] = f.content;
      saveCode(courseId, lessonId, codeMap);
    } catch (err) {
      setRunError((err as Error).message);
    } finally {
      setRunning(false);
    }
  }, [sessionId, sessionPhase, running, courseId, lessonId, setRunning, setRunError, setResult, incrementRun, saveOutput, saveCode]);

  const handleReset = useCallback(() => {
    if (!lesson || !courseId || !lessonId) return;
    const files: Record<string, string> = {};
    const order: string[] = [];
    for (const f of lesson.starterFiles) {
      files[f.path] = f.content;
      order.push(f.path);
    }
    if (order.length === 0) {
      files["main.py"] = "# Write your code here\n";
      order.push("main.py");
    }
    useProjectStore.setState({
      files,
      order,
      activeFile: order[0],
      openTabs: [order[0]],
    });
    useRunStore.getState().setResult(null);
    useRunStore.getState().setError(null);
    setValidation(null);
    setShowComplete(false);
    saveCode(courseId, lessonId, files);
  }, [lesson, courseId, lessonId, saveCode]);

  const handleCheck = useCallback(() => {
    if (!lesson || !courseId || !lessonId) return;
    const files = useProjectStore.getState().snapshot();
    const result = useRunStore.getState().result;
    const v = validateLesson(result, files, lesson.completionRules);
    setValidation(v);
    setHasChecked(true);
    if (!v.passed) setFailedCheckCount((c) => c + 1);
    if (v.passed && !validation?.passed) {
      completeLesson(identity.learnerId, courseId, lessonId, totalLessons);
      confetti({ particleCount: 120, spread: 70, origin: { y: 0.7 } });
      setShowComplete(true);
    }
  }, [lesson, courseId, lessonId, completeLesson, identity.learnerId, totalLessons, validation]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        handleRun();
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [handleRun]);

  const projectFiles = useProjectStore((s) => s.files);

  useEffect(() => {
    if (initialized.current) setHasEdited(true);
  }, [projectFiles]);

  // Auto-save code to localStorage on edits (debounced)
  useEffect(() => {
    if (!courseId || !lessonId || !initialized.current) return;
    const timer = setTimeout(() => {
      const snap = useProjectStore.getState().snapshot();
      if (snap.length === 0) return;
      const codeMap: Record<string, string> = {};
      for (const f of snap) codeMap[f.path] = f.content;
      saveCode(courseId, lessonId, codeMap);
    }, 2000);
    return () => clearTimeout(timer);
  }, [projectFiles, courseId, lessonId, saveCode]);

  if (!courseId || !lessonId) return null;

  const lp = lessonProgressMap[`${courseId}/${lessonId}`];
  const canRun = !!sessionId && sessionPhase === "active" && !running;
  const hasStderr = !!(lastResult?.stderr?.trim());
  const tutorConfigured = useAIStore((s) => s.keyStatus === "valid" && !!s.selectedModel);

  const coachState = {
    hasEdited,
    hasRun,
    hasError: hasStderr,
    hasChecked,
    checkPassed: !!validation?.passed,
    failedCheckCount,
    lessonComplete: lp?.status === "completed" || !!validation?.passed,
    tutorConfigured,
  };

  const handleExplainError = useCallback(() => {
    if (!lastResult?.stderr) return;
    const errText = lastResult.stderr.trim().slice(0, 500);
    setPendingAsk(`I got this error when I ran my code:\n\`\`\`\n${errText}\n\`\`\`\nCan you help me understand what went wrong?`);
    if (tutorCollapsed) setTutorCollapsed(false);
  }, [lastResult, setPendingAsk, tutorCollapsed]);

  const handleResetLessonProgress = useCallback(() => {
    if (!lesson || !courseId || !lessonId) return;
    resetLessonProgress(identity.learnerId, courseId, lessonId);
    const files: Record<string, string> = {};
    const order: string[] = [];
    for (const f of lesson.starterFiles) {
      files[f.path] = f.content;
      order.push(f.path);
    }
    if (order.length === 0) {
      files["main.py"] = "# Write your code here\n";
      order.push("main.py");
    }
    useProjectStore.setState({ files, order, activeFile: order[0], openTabs: [order[0]] });
    useRunStore.getState().setResult(null);
    useRunStore.getState().setError(null);
    setValidation(null);
    setShowComplete(false);
    setConfirmResetLesson(false);
    setResetNonce((n) => n + 1);
    setHasEdited(false);
    setHasRun(false);
    setHasChecked(false);
    setFailedCheckCount(0);
    startLesson(identity.learnerId, courseId, lessonId);
  }, [lesson, courseId, lessonId, identity.learnerId, resetLessonProgress, startLesson]);

  const nextLessonId = (() => {
    if (!lessonId || lessonOrder.length === 0) return null;
    const idx = lessonOrder.indexOf(lessonId);
    return idx >= 0 && idx < lessonOrder.length - 1 ? lessonOrder[idx + 1] : null;
  })();
  const showNext = (validation?.passed || lp?.status === "completed") && nextLessonId;

  return (
    <div className="flex h-full flex-col bg-bg text-ink">
      <header className="flex items-center gap-3 border-b border-border bg-panel/80 px-4 py-2 backdrop-blur">
        <button
          onClick={() => nav(`/learn/course/${courseId}`)}
          className="rounded px-2 py-1 text-xs text-muted transition hover:bg-elevated hover:text-ink"
        >
          ← Back
        </button>
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-accent to-violet text-[11px] font-bold text-bg shadow-glow">
          AI
        </div>
        <h1 className="truncate text-sm font-semibold tracking-tight">
          Lesson {lesson?.order}: {lesson?.title ?? "Loading..."}
        </h1>

        <div className="ml-auto flex items-center gap-3">
          {lp && (
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
              lp.status === "completed"
                ? "bg-green-500/15 text-green-400"
                : lp.status === "in_progress"
                  ? "bg-accent/15 text-accent"
                  : "bg-elevated text-muted"
            }`}>
              {lp.status === "completed" ? "Completed" : lp.status === "in_progress" ? "In progress" : "Not started"}
            </span>
          )}
          {sessionPhase === "starting" && (
            <span className="text-[10px] text-muted">Starting session...</span>
          )}
          {sessionPhase === "reconnecting" && (
            <span className="text-[10px] text-yellow-400">Reconnecting...</span>
          )}
          <button
            onClick={() => setShowSettings(true)}
            className="rounded p-1.5 text-muted transition hover:bg-elevated hover:text-ink"
            title="Settings"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 5a3 3 0 100 6 3 3 0 000-6zm0 4.5a1.5 1.5 0 110-3 1.5 1.5 0 010 3z" />
              <path d="M13.87 9.4l1.09.64a.5.5 0 01.17.68l-1.5 2.6a.5.5 0 01-.68.18l-1.08-.63a5.44 5.44 0 01-1.78 1.03l-.17 1.25a.5.5 0 01-.5.44h-3a.5.5 0 01-.5-.44L5.75 13.9a5.44 5.44 0 01-1.78-1.03l-1.08.63a.5.5 0 01-.68-.17l-1.5-2.6a.5.5 0 01.17-.68l1.09-.64a5.38 5.38 0 010-2l-1.09-.65a.5.5 0 01-.17-.68l1.5-2.6a.5.5 0 01.68-.17l1.08.63A5.44 5.44 0 015.75 2.1l.17-1.25A.5.5 0 016.42.4h3a.5.5 0 01.5.44l.17 1.26c.67.25 1.28.6 1.78 1.03l1.08-.63a.5.5 0 01.68.17l1.5 2.6a.5.5 0 01-.17.68l-1.09.65a5.38 5.38 0 010 2z" />
            </svg>
          </button>
        </div>
      </header>

      {loading ? (
        <div className="flex flex-1 items-center justify-center">
          <span className="skeleton h-4 w-32 rounded" />
        </div>
      ) : lesson ? (
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {/* Instructions panel — collapsible */}
          {instrCollapsed ? (
            <button
              onClick={() => setInstrCollapsed(false)}
              title="Show instructions"
              className="flex w-6 shrink-0 flex-col items-center justify-start gap-2 border-r border-border bg-panel pt-3 text-muted transition hover:bg-elevated hover:text-ink"
            >
              <span className="text-[12px]">▸</span>
              <span
                className="text-[10px] font-semibold uppercase tracking-wider"
                style={{ writingMode: "vertical-rl" }}
              >
                Instructions
              </span>
            </button>
          ) : (
            <>
              <div ref={instrRef} style={{ width: instrW }} className="shrink-0 overflow-hidden border-r border-border">
                <LessonInstructionsPanel
                  meta={lesson}
                  content={lesson.content}
                  onCollapse={() => setInstrCollapsed(true)}
                  coachState={coachState}
                />
              </div>
              <Splitter
                orientation="vertical"
                onDrag={(dx) => setInstrW((w) => clamp(w + dx, BOUNDS_INSTR))}
                onDoubleClick={() => setInstrW(DEFAULT_INSTR)}
              />
            </>
          )}

          {/* Editor + Output */}
          <section ref={editorRef as React.RefObject<HTMLElement>} className="flex min-w-0 flex-1 flex-col">
            {resumed && (
              <div className="flex items-center gap-2 border-b border-accent/20 bg-accent/5 px-3 py-1.5 text-[11px] text-accent animate-pulse">
                <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="1 4 1 10 7 10" />
                  <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                </svg>
                Resuming where you left off
              </div>
            )}
            <EditorTabs />
            <div className="min-h-0 flex-1">
              <MonacoPane />
            </div>
            <Splitter
              orientation="horizontal"
              onDrag={(dy) => setOutputH((h) => clamp(h - dy, BOUNDS_OUT))}
              onDoubleClick={() => setOutputH(DEFAULT_OUT)}
            />
            <div ref={outputRef} style={{ height: outputH }} className="min-h-0 shrink-0">
              <OutputPanel />
            </div>

            {/* Run toolbar */}
            <div className="flex items-center gap-2 border-t border-border bg-panel/80 px-4 py-1.5">
              <button
                ref={runBtnRef}
                onClick={handleRun}
                disabled={!canRun}
                className={`flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-xs font-semibold transition ${
                  canRun
                    ? "bg-accent text-bg hover:bg-accent/90"
                    : "bg-accent/20 text-accent opacity-50"
                }`}
              >
                {running ? (
                  <>
                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    Running...
                  </>
                ) : (
                  <>
                    <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor">
                      <polygon points="5 3 19 12 5 21 5 3" />
                    </svg>
                    Run
                  </>
                )}
              </button>
              <button
                ref={checkBtnRef}
                onClick={handleCheck}
                disabled={running}
                className={`flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-xs font-semibold transition ${
                  !running
                    ? "bg-green-500/20 text-green-400 hover:bg-green-500/30"
                    : "bg-green-500/10 text-green-400 opacity-50"
                }`}
              >
                <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Check Solution
              </button>
              <button
                onClick={handleReset}
                disabled={running}
                className="rounded-lg px-3 py-1.5 text-[11px] text-muted transition hover:bg-elevated hover:text-ink disabled:opacity-40"
                title="Reset code to starter"
              >
                Reset Code
              </button>
              <button
                onClick={() => setConfirmResetLesson(true)}
                disabled={running}
                className="rounded-lg px-3 py-1.5 text-[11px] text-muted transition hover:bg-red-500/10 hover:text-red-400 disabled:opacity-40"
                title="Reset all lesson progress (attempts, runs, hints, code)"
              >
                Reset Lesson
              </button>
              {hasStderr && !running && (
                <button
                  onClick={handleExplainError}
                  className="flex items-center gap-1 rounded-lg bg-red-500/10 px-3 py-1.5 text-[11px] font-medium text-red-400 ring-1 ring-red-500/20 transition hover:bg-red-500/20"
                  title="Ask the tutor to explain this error"
                >
                  <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  Explain Error
                </button>
              )}
              <span className="text-[10px] text-faint">Cmd+Enter</span>
              <div className="flex-1" />
              {validation && !validation.passed && (
                <div className="flex flex-col gap-0.5 rounded-lg bg-red-500/10 px-3 py-1 text-xs font-medium text-red-400">
                  <span>{validation.feedback[0] ?? "Not quite."}</span>
                  {validation.nextHints?.[0] && (
                    <span className="text-[10px] font-normal opacity-70">{validation.nextHints[0]}</span>
                  )}
                </div>
              )}
              {validation?.passed && (
                <div className="flex items-center gap-2 rounded-lg bg-green-500/15 px-3 py-1.5 text-xs font-medium text-green-400">
                  <span className="text-base">🎉</span>
                  <div className="flex flex-col">
                    <span>Lesson complete!</span>
                    {lesson?.conceptTags && lesson.conceptTags.length > 0 && (
                      <span className="text-[10px] font-normal text-green-400/70">
                        You practiced: {lesson.conceptTags.join(", ")}
                      </span>
                    )}
                  </div>
                </div>
              )}
              {showNext && (
                <button
                  onClick={() => nav(`/learn/course/${courseId}/lesson/${nextLessonId}`)}
                  className="flex items-center gap-1.5 rounded-lg bg-violet/20 px-4 py-1.5 text-xs font-semibold text-violet transition hover:bg-violet/30"
                >
                  Next Lesson →
                </button>
              )}
              {lp && (
                <span className="text-[10px] text-faint">
                  Runs: {lp.runCount} | Hints: {lp.hintCount} | Attempts: {lp.attemptCount}
                </span>
              )}
            </div>
          </section>

          {/* Guided tutor panel — collapsible + resizable */}
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
                onDrag={(dx) => setTutorW((w) => clamp(w - dx, BOUNDS_TUTOR))}
                onDoubleClick={() => setTutorW(DEFAULT_TUTOR)}
              />
              <aside
                ref={tutorRef as React.RefObject<HTMLElement>}
                style={{ width: tutorW }}
                className="min-h-0 shrink-0 overflow-hidden bg-panel"
              >
                <GuidedTutorPanel
                  lessonMeta={lesson}
                  totalLessons={totalLessons}
                  progressSummary={
                    lp
                      ? `attempt ${lp.attemptCount}, ${lp.runCount} runs, ${lp.hintCount} hints used`
                      : "first attempt"
                  }
                  onCollapse={() => setTutorCollapsed(true)}
                  resetNonce={resetNonce}
                />
              </aside>
            </>
          )}
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center text-sm text-muted">
          Lesson not found
        </div>
      )}

      {showComplete && lesson && (
        <LessonCompletePanel
          lesson={lesson}
          onDismiss={() => setShowComplete(false)}
          onNext={nextLessonId ? () => nav(`/learn/course/${courseId}/lesson/${nextLessonId}`) : undefined}
        />
      )}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      {showCoach && (
        <WorkspaceCoach
          refs={{
            instructions: instrRef.current,
            editor: editorRef.current,
            runButton: runBtnRef.current,
            outputPanel: outputRef.current,
            checkButton: checkBtnRef.current,
            tutorPanel: tutorRef.current,
          }}
          onComplete={() => setShowCoach(false)}
        />
      )}
      {confirmResetLesson && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-bg/80 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-sm rounded-xl border border-red-500/30 bg-panel p-5 shadow-xl">
            <h2 className="text-sm font-bold text-ink">Reset Lesson Progress?</h2>
            <p className="mt-2 text-xs leading-relaxed text-muted">
              This will clear all progress for this lesson — attempts, runs, hints, saved code, and completion status. You'll start fresh as if you've never opened this lesson.
            </p>
            <div className="mt-4 flex items-center gap-2">
              <button
                onClick={() => setConfirmResetLesson(false)}
                className="flex-1 rounded-lg border border-border px-4 py-2 text-xs font-medium text-muted transition hover:bg-elevated hover:text-ink"
              >
                Cancel
              </button>
              <button
                onClick={handleResetLessonProgress}
                className="flex-1 rounded-lg bg-red-500/15 px-4 py-2 text-xs font-semibold text-red-400 ring-1 ring-red-500/30 transition hover:bg-red-500/25"
              >
                Reset Lesson
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
