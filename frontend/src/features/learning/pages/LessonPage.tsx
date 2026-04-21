import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import confetti from "canvas-confetti";

// Phase 20-P1: confetti respects `prefers-reduced-motion`. The media query
// covers users who get motion-sick from flying particles and users on low-end
// devices who've globally disabled animations. Running it once at module load
// is fine — the setting doesn't change between the user's first and last
// lesson-complete in a session, and re-reading per-call costs nothing either.
function celebrate(options: confetti.Options) {
  if (typeof window === "undefined") return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  confetti(options);
}
import type { Lesson } from "../types";
import { loadFullLesson, loadCourse, loadAllLessonMetas } from "../content/courseLoader";
import { conceptsAvailableBefore } from "../content/conceptGraph";
import { useProgressStore, loadSavedCode } from "../stores/progressStore";
import { useAuthStore } from "../../../auth/authStore";
import { LessonInstructionsPanel } from "../components/LessonInstructionsPanel";
import { PracticeInstructionsView } from "../components/PracticeInstructionsView";
import { GuidedTutorPanel } from "../components/GuidedTutorPanel";
import { MonacoPane } from "../../../components/MonacoPane";
import { EditorTabs } from "../../../components/EditorTabs";
import { OutputPanel } from "../../../components/OutputPanel";
import { Splitter } from "../../../components/Splitter";
import { SettingsModal } from "../../../components/SettingsModal";
import { UserMenu } from "../../../components/UserMenu";
import { FeedbackButton } from "../../../components/FeedbackButton";
import { SessionErrorBanner } from "../../../components/SessionErrorBanner";
import { SessionRestartBanner } from "../../../components/SessionRestartBanner";
import { NarrowViewportGate } from "../../../components/NarrowViewportGate";
import { Modal } from "../../../components/Modal";
import { useSessionLifecycle } from "../../../hooks/useSessionLifecycle";
import { useProjectStore } from "../../../state/projectStore";
import { useSessionStore } from "../../../state/sessionStore";
import { useRunStore } from "../../../state/runStore";
import { useAIStore } from "../../../state/aiStore";
import { api } from "../../../api/client";
import { validateLesson, pickFirstFailure } from "../utils/validator";
import { LessonCompletePanel } from "../components/LessonCompletePanel";
import { WorkspaceCoach } from "../components/WorkspaceCoach";
import { usePreferencesStore } from "../../../state/preferencesStore";
import { computeMastery, formatTimeSpent } from "../utils/mastery";
import { FailedTestCallout } from "../components/FailedTestCallout";
import type { FunctionTest, TestReport, ValidationResult } from "../types";
import { LANGUAGE_ENTRYPOINT } from "../../../types";
import { useShortcutLabels } from "../../../util/platform";
import { clamp, clampSide, usePersistedNumber, usePersistedFlag } from "../../../util/layoutPrefs";
import { COACH_AUTO_OPEN_MS, RESUME_TOAST_MS } from "../../../util/timings";

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

export default function LessonPage() {
  const { courseId, lessonId } = useParams<{
    courseId: string;
    lessonId: string;
  }>();
  const nav = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const user = useAuthStore((s) => s.user);
  const learnerId = user!.id;
  const startLesson = useProgressStore((s) => s.startLesson);
  const completeLesson = useProgressStore((s) => s.completeLesson);
  const incrementRun = useProgressStore((s) => s.incrementRun);
  const saveCode = useProgressStore((s) => s.saveCode);
  const saveOutput = useProgressStore((s) => s.saveOutput);
  const resetLessonProgress = useProgressStore((s) => s.resetLessonProgress);
  const completePracticeExercise = useProgressStore((s) => s.completePracticeExercise);
  const savePracticeCode = useProgressStore((s) => s.savePracticeCode);
  const resetPracticeProgress = useProgressStore((s) => s.resetPracticeProgress);
  const incrementLessonTime = useProgressStore((s) => s.incrementLessonTime);
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
  const [priorConcepts, setPriorConcepts] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [showComplete, setShowComplete] = useState(false);
  const [resumed, setResumed] = useState(false);
  const [resetNonce, setResetNonce] = useState(0);
  const [confirmResetLesson, setConfirmResetLesson] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [resetMenuOpen, setResetMenuOpen] = useState(false);
  const resetMenuRef = useRef<HTMLDivElement>(null);
  const [hasEdited, setHasEdited] = useState(false);
  const [hasRun, setHasRun] = useState(false);
  const [hasChecked, setHasChecked] = useState(false);
  const [failedCheckCount, setFailedCheckCount] = useState(0);
  // Wave 2 CoachRail signals — split the generic failedCheckCount into
  // visible vs. hidden buckets so the rail can distinguish "passing the
  // visible examples but blowing up on hidden edges" from "nothing works".
  const [failedVisibleTests, setFailedVisibleTests] = useState(0);
  const [failedHiddenTests, setFailedHiddenTests] = useState(0);
  const [practiceMode, setPracticeMode] = useState(false);
  const [practiceIndex, setPracticeIndex] = useState(0);
  const [practiceValidation, setPracticeValidation] = useState<ValidationResult | null>(null);
  const [testReport, setTestReport] = useState<TestReport | null>(null);
  const [runningTests, setRunningTests] = useState(false);
  // Used to gate "Ask tutor why" on consecutive fails of the SAME test name.
  const [lastFailedName, setLastFailedName] = useState<string | null>(null);
  const [sameFailStreak, setSameFailStreak] = useState(0);
  const savedLessonCode = useRef<Record<string, string> | null>(null);
  const [outputH, setOutputH] = usePersistedNumber(LS_OUT_H, DEFAULT_OUT);
  const [instrW, setInstrW] = usePersistedNumber(LS_INSTR_W, DEFAULT_INSTR);
  const [tutorW, setTutorW] = usePersistedNumber(LS_TUTOR_W, DEFAULT_TUTOR);
  const [instrCollapsed, setInstrCollapsed] = usePersistedFlag(LS_INSTR_COLLAPSED, false);
  const [tutorCollapsed, setTutorCollapsed] = usePersistedFlag(LS_TUTOR_COLLAPSED, false);
  const initialized = useRef(false);
  const resumedTimer = useRef<ReturnType<typeof setTimeout>>();
  const [showCoach, setShowCoach] = useState(false);
  const keys = useShortcutLabels();
  const instrRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLElement>(null);
  const runBtnRef = useRef<HTMLButtonElement>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  const checkBtnRef = useRef<HTMLButtonElement>(null);
  const tutorRef = useRef<HTMLElement>(null);

  useEffect(() => {
    return () => clearTimeout(resumedTimer.current);
  }, []);

  useEffect(() => {
    if (!resetMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (resetMenuRef.current && !resetMenuRef.current.contains(e.target as Node)) {
        setResetMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setResetMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [resetMenuOpen]);

  useEffect(() => {
    if (!courseId || !lessonId) return;
    let cancelled = false;
    initialized.current = false;
    autoEnteredPractice.current = false;
    setLoading(true);
    setValidation(null);
    setShowComplete(false);
    setHasEdited(false);
    setHasRun(false);
    setHasChecked(false);
    setFailedCheckCount(0);
    setFailedVisibleTests(0);
    setFailedHiddenTests(0);
    setPracticeMode(false);
    setPracticeIndex(0);
    setPracticeValidation(null);
    setTestReport(null);
    setLastFailedName(null);
    setSameFailStreak(0);
    savedLessonCode.current = null;
    Promise.all([
      loadFullLesson(courseId, lessonId),
      loadCourse(courseId),
      loadAllLessonMetas(courseId),
    ])
      .then(([l, course, metas]) => {
        if (cancelled) return;
        setLesson(l);
        setTotalLessons(course.lessonOrder.length);
        setLessonOrder(course.lessonOrder);
        const metaMap = new Map(metas.map((m) => [m.id, m]));
        setPriorConcepts(conceptsAvailableBefore(course, metaMap, lessonId));
        startLesson(learnerId, courseId, lessonId);
      })
      .catch(() => {
        if (cancelled) return;
        setLesson(null);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [courseId, lessonId, learnerId, startLesson]);

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
      resumedTimer.current = setTimeout(() => setResumed(false), RESUME_TOAST_MS);
    } else {
      for (const f of lesson.starterFiles) {
        files[f.path] = f.content;
        order.push(f.path);
      }
    }

    const entry = LANGUAGE_ENTRYPOINT[lesson.language];
    if (order.length === 0) {
      files[entry] = "# Write your code here\n";
      order.push(entry);
    }

    const ctxKey = `lesson:${courseId}/${lessonId}`;
    switchProjectContext(ctxKey, {
      language: lesson.language,
      files,
      order,
      activeFile: order[0],
      openTabs: [order[0]],
    });
  }, [lesson, courseId, lessonId]);  // eslint-disable-line react-hooks/exhaustive-deps

  const workspaceCoachDone = usePreferencesStore((s) => s.workspaceCoachDone);
  useEffect(() => {
    if (!lesson || loading) return;
    if (!workspaceCoachDone) {
      const timer = setTimeout(() => setShowCoach(true), COACH_AUTO_OPEN_MS);
      return () => clearTimeout(timer);
    }
  }, [lesson, loading, workspaceCoachDone]);

  const handleRun = useCallback(async () => {
    if (!sessionId || sessionPhase !== "active" || running || !courseId || !lessonId || !lesson) return;
    setRunning(true);
    setRunError(null);
    try {
      const files = useProjectStore.getState().snapshot();
      await api.snapshotProject(sessionId, files);
      const stdin = useRunStore.getState().stdin || undefined;
      const result = await api.execute(sessionId, lesson.language, stdin);
      setResult(result);
      setHasRun(true);
      incrementRun(courseId, lessonId);
      if (!practiceMode) {
        if (result.stdout) {
          saveOutput(courseId, lessonId, result.stdout);
        }
        const codeMap: Record<string, string> = {};
        for (const f of files) codeMap[f.path] = f.content;
        saveCode(courseId, lessonId, codeMap);
      }
    } catch (err) {
      setRunError((err as Error).message);
    } finally {
      setRunning(false);
    }
  }, [sessionId, sessionPhase, running, courseId, lessonId, lesson, setRunning, setRunError, setResult, incrementRun, saveOutput, saveCode, practiceMode]);

  const applyPracticeStarter = useCallback((exerciseIndex: number) => {
    if (!lesson?.practiceExercises || !courseId || !lessonId) return;
    const exercise = lesson.practiceExercises[exerciseIndex];
    if (!exercise) return;
    const entry = LANGUAGE_ENTRYPOINT[lesson.language];
    // Prefer the learner's persisted WIP for this specific exercise. Falls
    // back to the authored starter only on first visit or after an explicit
    // practice reset (which clears the persisted map).
    const lp = useProgressStore.getState().lessonProgress[`${courseId}/${lessonId}`];
    const persisted = lp?.practiceExerciseCode?.[exercise.id];
    const files = persisted && Object.keys(persisted).length > 0
      ? persisted
      : { [entry]: exercise.starterCode ?? "# Write your code here\n" };
    const order = Object.keys(files);
    useProjectStore.setState({
      files,
      order,
      activeFile: order[0] ?? entry,
      openTabs: [order[0] ?? entry],
    });
    useRunStore.getState().setResult(null);
    useRunStore.getState().setError(null);
    setPracticeValidation(null);
  }, [lesson, courseId, lessonId]);

  const handleReset = useCallback(() => {
    if (!lesson || !courseId || !lessonId) return;
    if (practiceMode) {
      applyPracticeStarter(practiceIndex);
      return;
    }
    const files: Record<string, string> = {};
    const order: string[] = [];
    for (const f of lesson.starterFiles) {
      files[f.path] = f.content;
      order.push(f.path);
    }
    const entry = LANGUAGE_ENTRYPOINT[lesson.language];
    if (order.length === 0) {
      files[entry] = "# Write your code here\n";
      order.push(entry);
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
  }, [lesson, courseId, lessonId, saveCode, practiceMode, practiceIndex, applyPracticeStarter]);

  // Collects every FunctionTest authored across function_tests rules on the
  // lesson (most lessons have at most one such rule, but the schema allows
  // multiple). Practice exercises aren't included — those stay on legacy
  // expected_stdout / required_file_contains only for Wave 1.
  const functionTests: FunctionTest[] = (() => {
    if (!lesson || practiceMode) return [];
    const out: FunctionTest[] = [];
    for (const r of lesson.completionRules) {
      if (r.type === "function_tests" && Array.isArray(r.tests)) out.push(...r.tests);
    }
    return out;
  })();

  const handleRunExamples = useCallback(async () => {
    if (!sessionId || sessionPhase !== "active" || runningTests || !courseId || !lessonId || !lesson) return;
    if (functionTests.length === 0) return;
    setRunningTests(true);
    try {
      const files = useProjectStore.getState().snapshot();
      await api.snapshotProject(sessionId, files);
      // Always batch visible + hidden in one harness run — a single harness
      // invocation carries the full overhead (docker exec, boot, runtime init);
      // the per-test cost inside is negligible, so there's no reason to split.
      const res = await api.executeTests(sessionId, lesson.language, functionTests);
      setTestReport(res.report);
    } catch (err) {
      setTestReport({
        results: [],
        harnessError: (err as Error).message,
        cleanStdout: "",
      });
    } finally {
      setRunningTests(false);
    }
  }, [sessionId, sessionPhase, runningTests, courseId, lessonId, lesson, functionTests]);

  const handleCheck = useCallback(async () => {
    if (!lesson || !courseId || !lessonId) return;
    const files = useProjectStore.getState().snapshot();
    const result = useRunStore.getState().result;

    if (practiceMode) {
      const exercise = lesson.practiceExercises?.[practiceIndex];
      if (!exercise) return;
      const practiceFnTests = exercise.completionRules
        .filter((r) => r.type === "function_tests")
        .flatMap((r) => r.tests ?? []);
      let practiceReport: typeof testReport = null;
      if (practiceFnTests.length > 0 && sessionId) {
        setRunningTests(true);
        try {
          await api.snapshotProject(sessionId, files);
          const res = await api.executeTests(sessionId, lesson.language, practiceFnTests);
          practiceReport = res.report;
        } catch (err) {
          practiceReport = {
            results: [],
            harnessError: (err as Error).message,
            cleanStdout: "",
          };
        } finally {
          setRunningTests(false);
        }
      }
      const v = validateLesson(result, files, exercise.completionRules, {
        testReport: practiceReport,
        language: lesson.language,
      });
      setPracticeValidation(v);
      if (v.passed) {
        const current = useProgressStore.getState().lessonProgress[`${courseId}/${lessonId}`];
        const alreadyDone = (current?.practiceCompletedIds ?? []).includes(exercise.id);
        completePracticeExercise(courseId, lessonId, exercise.id);
        if (!alreadyDone) {
          celebrate({ particleCount: 80, spread: 55, origin: { y: 0.7 } });
        }
      }
      return;
    }

    // For lessons with function_tests, run the harness now so Check My Work
    // validates against a fresh report. This guarantees the callout reflects
    // the current code, not a stale Run-examples result.
    let latestReport = testReport;
    if (functionTests.length > 0) {
      setRunningTests(true);
      try {
        await api.snapshotProject(sessionId!, files);
        const res = await api.executeTests(sessionId!, lesson.language, functionTests);
        latestReport = res.report;
        setTestReport(res.report);
      } catch (err) {
        latestReport = {
          results: [],
          harnessError: (err as Error).message,
          cleanStdout: "",
        };
        setTestReport(latestReport);
      } finally {
        setRunningTests(false);
      }
    }

    const v = validateLesson(result, files, lesson.completionRules, {
      testReport: latestReport,
      language: lesson.language,
    });
    setValidation(v);
    setHasChecked(true);
    if (!v.passed) {
      setFailedCheckCount((c) => c + 1);
      // Split counters: visible-fail means ≥1 visible test failed THIS
      // check; hidden-fail means visible all passed but ≥1 hidden failed.
      // Only applies when function_tests ran — otherwise only
      // failedCheckCount moves (legacy behavior).
      if (latestReport && functionTests.length > 0) {
        const visibleFails = latestReport.results.filter((r) => !r.hidden && !r.passed).length;
        const hiddenFails = latestReport.results.filter((r) => r.hidden && !r.passed).length;
        if (visibleFails > 0) setFailedVisibleTests((c) => c + 1);
        else if (hiddenFails > 0) setFailedHiddenTests((c) => c + 1);
      }
      const fail = pickFirstFailure(latestReport);
      if (fail) {
        setSameFailStreak((streak) => (fail.name === lastFailedName ? streak + 1 : 1));
        setLastFailedName(fail.name);
      } else {
        setSameFailStreak(0);
        setLastFailedName(null);
      }
    } else {
      setSameFailStreak(0);
      setLastFailedName(null);
    }
    if (v.passed && !validation?.passed) {
      completeLesson(learnerId, courseId, lessonId, totalLessons);
      celebrate({ particleCount: 120, spread: 70, origin: { y: 0.7 } });
      setShowComplete(true);
    }
  }, [lesson, courseId, lessonId, completeLesson, learnerId, totalLessons, validation, practiceMode, practiceIndex, completePracticeExercise, sessionId, functionTests, testReport, lastFailedName]);

  const handleEnterPractice = useCallback(() => {
    if (!lesson?.practiceExercises?.length) return;
    savedLessonCode.current = useProjectStore.getState().snapshot().reduce(
      (acc, f) => { acc[f.path] = f.content; return acc; },
      {} as Record<string, string>,
    );
    setPracticeMode(true);
    setPracticeIndex(0);
    setShowComplete(false);
    applyPracticeStarter(0);
  }, [lesson, applyPracticeStarter]);

  // Auto-enter practice mode when navigated with ?mode=practice. Fires once
  // per lesson load, only if the lesson is actually completed + has exercises.
  // Clears the query param so exiting practice doesn't get re-triggered.
  const autoEnteredPractice = useRef(false);
  useEffect(() => {
    if (loading || !lesson || !courseId || !lessonId) return;
    if (autoEnteredPractice.current) return;
    if (searchParams.get("mode") !== "practice") return;
    const currentLp = useProgressStore.getState().lessonProgress[`${courseId}/${lessonId}`];
    if (currentLp?.status !== "completed" || !lesson.practiceExercises?.length) {
      setSearchParams({}, { replace: true });
      return;
    }
    autoEnteredPractice.current = true;
    handleEnterPractice();
    setSearchParams({}, { replace: true });
  }, [loading, lesson, courseId, lessonId, searchParams, setSearchParams, handleEnterPractice]);

  const handleExitPractice = useCallback(() => {
    setPracticeMode(false);
    setPracticeValidation(null);
    if (savedLessonCode.current) {
      const order = Object.keys(savedLessonCode.current);
      useProjectStore.setState({
        files: { ...savedLessonCode.current },
        order,
        activeFile: order[0],
        openTabs: [order[0]],
      });
      savedLessonCode.current = null;
    }
    useRunStore.getState().setResult(null);
    useRunStore.getState().setError(null);
  }, []);

  const handleSelectPracticeExercise = useCallback((index: number) => {
    setPracticeIndex(index);
    applyPracticeStarter(index);
  }, [applyPracticeStarter]);

  const handleNextPracticeExercise = useCallback(() => {
    if (!lesson?.practiceExercises) return;
    const next = practiceIndex + 1;
    if (next >= lesson.practiceExercises.length) return;
    setPracticeIndex(next);
    applyPracticeStarter(next);
  }, [lesson, practiceIndex, applyPracticeStarter]);

  const handleResetPracticeProgress = useCallback(() => {
    if (!courseId || !lessonId) return;
    resetPracticeProgress(courseId, lessonId);
    setPracticeValidation(null);
    applyPracticeStarter(practiceIndex);
  }, [courseId, lessonId, resetPracticeProgress, practiceIndex, applyPracticeStarter]);

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

  // Invalidate the test report when code changes — stale pass/fail marks
  // would mislead (green ✓ on a card while the user just broke the function).
  useEffect(() => {
    if (initialized.current) setTestReport(null);
  }, [projectFiles]);

  // Auto-save code on edits (debounced). Lesson-mode writes to `lastCode`;
  // practice-mode writes to `practiceExerciseCode[exerciseId]` so switching
  // between exercises doesn't clobber the main lesson buffer.
  useEffect(() => {
    if (!courseId || !lessonId || !initialized.current) return;
    const timer = setTimeout(() => {
      const snap = useProjectStore.getState().snapshot();
      if (snap.length === 0) return;
      const codeMap: Record<string, string> = {};
      for (const f of snap) codeMap[f.path] = f.content;
      if (practiceMode) {
        const exercise = lesson?.practiceExercises?.[practiceIndex];
        if (exercise) savePracticeCode(courseId, lessonId, exercise.id, codeMap);
      } else {
        saveCode(courseId, lessonId, codeMap);
      }
    }, 2000);
    return () => clearTimeout(timer);
  }, [projectFiles, courseId, lessonId, saveCode, savePracticeCode, practiceMode, practiceIndex, lesson]);

  // Time-spent tracking — tick only while the document is visible and the
  // lesson isn't yet complete. Uses a lastTick ref so we credit real elapsed
  // ms; caps deltas at 60s so a long hidden/suspended span can't inflate time.
  useEffect(() => {
    if (!courseId || !lessonId || practiceMode) return;
    let lastTick = Date.now();
    const TICK_MS = 30_000;
    const MAX_DELTA = 60_000;

    const credit = () => {
      const now = Date.now();
      const delta = Math.min(now - lastTick, MAX_DELTA);
      lastTick = now;
      const current = useProgressStore.getState().lessonProgress[`${courseId}/${lessonId}`];
      if (current?.status === "completed") return;
      if (delta > 0 && document.visibilityState === "visible") {
        incrementLessonTime(courseId, lessonId, delta);
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        lastTick = Date.now();
      } else {
        credit();
      }
    };

    const interval = setInterval(credit, TICK_MS);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      credit();
    };
  }, [courseId, lessonId, practiceMode, incrementLessonTime]);

  if (!courseId || !lessonId) return null;

  const lp = lessonProgressMap[`${courseId}/${lessonId}`];
  const canRun = !!sessionId && sessionPhase === "active" && !running;
  const hasStderr = !!(lastResult?.stderr?.trim());
  const tutorConfigured = useAIStore((s) => !!s.selectedModel) && usePreferencesStore((s) => s.hasOpenaiKey);

  const passedVisibleTests = testReport
    ? testReport.results.filter((r) => !r.hidden && r.passed).length
    : 0;

  const coachState = {
    hasEdited,
    hasRun,
    hasError: hasStderr,
    hasChecked,
    checkPassed: !!validation?.passed,
    failedCheckCount,
    lessonComplete: lp?.status === "completed" || !!validation?.passed,
    tutorConfigured,
    hasFunctionTests: functionTests.length > 0,
    failedVisibleTests,
    failedHiddenTests,
    passedVisibleTests,
  };

  const handleExplainError = useCallback(() => {
    if (!lastResult?.stderr) return;
    const errText = lastResult.stderr.trim().slice(0, 500);
    setPendingAsk(`I got this error when I ran my code:\n\`\`\`\n${errText}\n\`\`\`\nCan you help me understand what went wrong?`);
    if (tutorCollapsed) setTutorCollapsed(false);
  }, [lastResult, setPendingAsk, tutorCollapsed]);

  // "Ask tutor why" from the FailedTestCallout. For visible tests we can
  // share the call + expected + got so the tutor can help concretely; for
  // hidden tests we keep the inputs private and only describe the shape of
  // the problem — the tutor's job is to coach the learner toward generating
  // their own edge-case hypothesis, not to reveal the hidden case.
  const handleAskTutorAboutFailure = useCallback(() => {
    const fail = pickFirstFailure(testReport);
    if (!fail) return;
    const prompt = fail.hidden
      ? `My function passes the visible examples but Check My Work says a related edge case still fails${fail.category ? ` (category: ${fail.category})` : ""}. What kinds of inputs should I test beyond the examples, and how would I trace my code through them?`
      : fail.error
        ? `When my function ran on the "${fail.name}" example, it raised this error:\n\`\`\`\n${(fail.error ?? "").trim().slice(0, 400)}\n\`\`\`\nCan you help me understand what caused it?`
        : `The "${fail.name}" example returned \`${fail.actualRepr ?? "(no value)"}\` but expected \`${fail.expectedRepr ?? "(unknown)"}\`. Can you help me see why my code gives the wrong answer here?`;
    setPendingAsk(prompt);
    if (tutorCollapsed) setTutorCollapsed(false);
  }, [testReport, setPendingAsk, tutorCollapsed]);

  const handleResetLessonProgress = useCallback(() => {
    if (!lesson || !courseId || !lessonId) return;
    resetLessonProgress(learnerId, courseId, lessonId);
    const files: Record<string, string> = {};
    const order: string[] = [];
    for (const f of lesson.starterFiles) {
      files[f.path] = f.content;
      order.push(f.path);
    }
    const entry = LANGUAGE_ENTRYPOINT[lesson.language];
    if (order.length === 0) {
      files[entry] = "# Write your code here\n";
      order.push(entry);
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
    setFailedVisibleTests(0);
    setFailedHiddenTests(0);
    startLesson(learnerId, courseId, lessonId);
  }, [lesson, courseId, lessonId, learnerId, resetLessonProgress, startLesson]);

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
          aria-label="Back to course"
        >
          ← Back
        </button>
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-accent to-violet text-[11px] font-bold text-bg shadow-glow">
          AI
        </div>
        <h1
          className="truncate text-sm font-semibold tracking-tight"
          title={lesson ? `Lesson ${lesson.order}: ${lesson.title}` : undefined}
        >
          Lesson {lesson?.order}: {lesson?.title ?? "Loading..."}
        </h1>
        <nav className="ml-2 flex shrink-0 items-center overflow-hidden rounded-md border border-border text-[11px]" aria-label="Mode switcher">
          <button
            onClick={() => nav("/editor")}
            className="bg-transparent px-2.5 py-1 text-muted transition hover:bg-elevated hover:text-ink"
            title="Switch to free-form editor"
            aria-label="Switch to editor mode"
          >
            Editor
          </button>
          <span className="border-l border-border bg-violet/15 px-2.5 py-1 font-semibold text-violet">Learning</span>
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {sessionPhase === "starting" && (
            <span className="flex items-center gap-1 text-[10px] text-muted">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-muted" />
              Starting session…
            </span>
          )}
          {sessionPhase === "reconnecting" && (
            <span className="text-[10px] text-yellow-300">Reconnecting…</span>
          )}
          {lp && (() => {
            const practiceTotal = lesson?.practiceExercises?.length ?? 0;
            const practiceDone = practiceTotal > 0
              ? (lp.practiceCompletedIds ?? []).filter((id) => lesson!.practiceExercises!.some((e) => e.id === id)).length
              : 0;
            const practiceAllDone = practiceTotal > 0 && practiceDone === practiceTotal;
            return (
              <div className="flex items-center overflow-hidden rounded-full">
                <span className={`px-2.5 py-0.5 text-[10px] font-medium ${
                  lp.status === "completed"
                    ? "bg-success/20 text-success"
                    : lp.status === "in_progress"
                      ? "bg-accent/20 text-accent"
                      : "bg-elevated text-muted"
                }`}>
                  {lp.status === "completed" ? "✓ Completed" : lp.status === "in_progress" ? "In progress" : "Not started"}
                </span>
                {!practiceMode && practiceTotal > 0 && lp.status === "completed" && (
                  <button
                    onClick={handleEnterPractice}
                    className={`border-l border-bg/40 px-2.5 py-0.5 text-[10px] font-semibold transition ${
                      practiceAllDone
                        ? "bg-success/20 text-success hover:bg-success/30"
                        : "bg-violet/20 text-violet hover:bg-violet/30"
                    }`}
                    title={practiceAllDone ? "Replay practice" : "Practice this lesson's concepts"}
                    aria-label={practiceAllDone ? "Replay practice, all exercises complete" : `Practice ${practiceDone} of ${practiceTotal}`}
                  >
                    {practiceAllDone ? `✓ Practice ${practiceDone}/${practiceTotal}` : `Practice ${practiceDone}/${practiceTotal}`}
                  </button>
                )}
              </div>
            );
          })()}
          {!practiceMode && showNext && (
            <button
              onClick={() => nav(`/learn/course/${courseId}/lesson/${nextLessonId}`)}
              className="rounded-md border border-violet/30 bg-violet/10 px-2.5 py-1 text-[11px] font-semibold text-violet transition hover:bg-violet/20"
              title="Go to the next lesson"
              aria-label="Go to next lesson"
            >
              Next →
            </button>
          )}
          <FeedbackButton />
          <UserMenu />
        </div>
      </header>

      <SessionErrorBanner />
      <SessionRestartBanner />

      {loading ? (
        <div
          className="flex min-h-0 flex-1 overflow-hidden"
          role="status"
          aria-live="polite"
          aria-label="Loading lesson"
        >
          <span className="sr-only">Loading…</span>
          <div className="flex w-[320px] shrink-0 flex-col gap-3 border-r border-border bg-panel p-4">
            <span className="skeleton h-4 w-2/3 rounded" />
            <span className="skeleton h-3 w-5/6 rounded" />
            <span className="skeleton h-3 w-3/4 rounded" />
            <span className="skeleton h-3 w-4/5 rounded" />
            <span className="skeleton h-3 w-1/2 rounded" />
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex-1 space-y-2 bg-bg p-6">
              <span className="skeleton h-3 w-1/3 rounded" />
              <span className="skeleton mt-4 block h-3 w-1/2 rounded" />
              <span className="skeleton mt-2 block h-3 w-3/4 rounded" />
              <span className="skeleton mt-2 block h-3 w-2/3 rounded" />
            </div>
            <div className="h-[200px] border-t border-border bg-panel p-4">
              <span className="skeleton h-3 w-1/4 rounded" />
            </div>
          </div>
          <div className="flex w-[340px] shrink-0 flex-col gap-3 border-l border-border bg-panel p-4">
            <span className="skeleton h-3 w-1/3 rounded" />
            <span className="skeleton h-10 w-full rounded-md" />
          </div>
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
                {practiceMode && lesson.practiceExercises ? (
                  <PracticeInstructionsView
                    exercises={lesson.practiceExercises}
                    currentIndex={practiceIndex}
                    completedIds={lp?.practiceCompletedIds ?? []}
                    validation={practiceValidation}
                    onSelectExercise={handleSelectPracticeExercise}
                    onExitPractice={handleExitPractice}
                    onNextExercise={handleNextPracticeExercise}
                    onResetPractice={handleResetPracticeProgress}
                    onCollapse={() => setInstrCollapsed(true)}
                  />
                ) : (
                  <LessonInstructionsPanel
                    meta={lesson}
                    content={lesson.content}
                    onCollapse={() => setInstrCollapsed(true)}
                    coachState={coachState}
                    functionTests={functionTests}
                    testReport={testReport}
                    runningTests={runningTests}
                    onRunExamples={functionTests.length > 0 ? handleRunExamples : undefined}
                    checkFailure={hasChecked && !validation?.passed ? pickFirstFailure(testReport) : null}
                    checkFailureStreak={sameFailStreak}
                    onAskTutorAboutFailure={handleAskTutorAboutFailure}
                  />
                )}
              </div>
              <Splitter
                orientation="vertical"
                onDrag={(dx) => setInstrW((w) => clampSide(w + dx, BOUNDS_INSTR))}
                onDoubleClick={() => setInstrW(DEFAULT_INSTR)}
              />
            </>
          )}

          {/* Editor + Output */}
          <section ref={editorRef as React.RefObject<HTMLElement>} className="flex min-w-0 flex-1 flex-col">
            {resumed && (
              <div className="flex items-center gap-2 border-b border-accent/20 bg-accent/5 px-3 py-1.5 text-[11px] text-accent">
                <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="1 4 1 10 7 10" />
                  <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                </svg>
                Your code was restored — resuming where you left off
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

            {/* Run toolbar — 2 rows: primary actions (+ overflow menu), validation feedback.
                Secondary actions (Reset Code / Reset Lesson) + stats are tucked behind ⋯ so
                the toolbar stays a single visual strip. */}
            <div className="border-t border-border bg-panel/80">
              {/* Row 1 — Primary actions */}
              <div className="flex items-center gap-2 px-4 py-1.5">
                <button
                  ref={runBtnRef}
                  onClick={handleRun}
                  disabled={!canRun}
                  className={`flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                    canRun
                      ? "bg-accent text-bg hover:bg-accent/90"
                      : "bg-elevated text-muted cursor-not-allowed"
                  }`}
                  title={canRun ? `Run your code (${keys.run})` : sessionPhase !== "active" ? "Waiting for session to start…" : running ? "Already running…" : "Run code"}
                  aria-label={canRun ? `Run code (${keys.runPhrase})` : sessionPhase !== "active" ? "Run code — waiting for session" : "Run code"}
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
                  disabled={running || runningTests}
                  className={`flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-violet ${
                    !running && !runningTests
                      ? "bg-violet/20 text-violet hover:bg-violet/30"
                      : "bg-elevated text-muted cursor-not-allowed"
                  }`}
                  title="Verify your solution against the lesson's checks"
                  aria-label="Check my work against lesson requirements"
                >
                  <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="7" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                  {runningTests ? "Checking…" : "Check My Work"}
                </button>
                {/* Reserve a fixed slot for Explain Error to avoid layout shift when stderr toggles */}
                <div className="min-w-[128px]">
                  {hasStderr && !running && (
                    <button
                      onClick={handleExplainError}
                      className="flex items-center gap-1 rounded-lg bg-danger/15 px-3 py-1.5 text-[11px] font-medium text-danger ring-1 ring-danger/40 transition hover:bg-danger/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-danger"
                      title="Ask the tutor to explain this error"
                      aria-label="Explain error with AI tutor"
                    >
                      <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="8" x2="12" y2="12" />
                        <line x1="12" y1="16" x2="12.01" y2="16" />
                      </svg>
                      Explain Error
                    </button>
                  )}
                </div>
                {!canRun && sessionPhase !== "active" && (
                  <span className="text-[10px] italic text-faint">Waiting for session…</span>
                )}
                <div className="flex-1" />
                {practiceMode && (
                  <div className="flex items-center overflow-hidden rounded-full ring-1 ring-violet/30">
                    <span className="bg-violet/15 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-violet">
                      Practice Mode
                    </span>
                    <button
                      onClick={handleExitPractice}
                      className="border-l-2 border-violet/40 bg-violet/25 px-2.5 py-1 text-[10px] font-semibold text-violet transition hover:bg-violet/40 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-violet"
                      title="Exit practice and return to the lesson"
                      aria-label="Exit practice mode and return to lesson"
                    >
                      <span aria-hidden="true">✕ </span>Exit
                    </button>
                  </div>
                )}
                {!practiceMode && showNext && (
                  <button
                    onClick={() => nav(`/learn/course/${courseId}/lesson/${nextLessonId}`)}
                    className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-violet to-accent px-4 py-1.5 text-xs font-semibold text-bg shadow-glow transition hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet"
                    aria-label="Go to next lesson"
                  >
                    Next Lesson →
                  </button>
                )}
                <div ref={resetMenuRef} className="relative">
                  <button
                    onClick={() => setResetMenuOpen((v) => !v)}
                    aria-label="More lesson actions"
                    aria-haspopup="menu"
                    aria-expanded={resetMenuOpen}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition hover:bg-elevated hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    title="More actions"
                  >
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <circle cx="5" cy="12" r="1.6" />
                      <circle cx="12" cy="12" r="1.6" />
                      <circle cx="19" cy="12" r="1.6" />
                    </svg>
                  </button>
                  {resetMenuOpen && (
                    // Opens UPWARD (bottom-full) — the kebab sits low in the
                    // viewport (between editor and output panel) so a downward
                    // dropdown falls off-screen.
                    <div
                      role="menu"
                      className="absolute right-0 bottom-full z-40 mb-1 w-48 overflow-hidden rounded-lg border border-border bg-panel/95 p-1 shadow-xl backdrop-blur"
                    >
                      <button
                        role="menuitem"
                        onClick={() => { setResetMenuOpen(false); handleReset(); }}
                        disabled={running}
                        className="block w-full rounded-md px-3 py-1.5 text-left text-xs text-ink transition hover:bg-elevated disabled:cursor-not-allowed disabled:opacity-40"
                        title="Reset code to starter"
                      >
                        Reset Code
                      </button>
                      <div className="my-0.5 border-t border-border/50" />
                      <button
                        role="menuitem"
                        onClick={() => { setResetMenuOpen(false); setConfirmResetLesson(true); }}
                        disabled={running}
                        className="block w-full rounded-md px-3 py-1.5 text-left text-xs font-medium text-danger/80 transition hover:bg-danger/10 hover:text-danger disabled:cursor-not-allowed disabled:opacity-40"
                        title="Reset all lesson progress (attempts, runs, hints, code) — destructive"
                      >
                        Reset Lesson
                      </button>
                    </div>
                  )}
                </div>
              </div>
              {/* Row 2 — Validation feedback (own row so it never collides with primary actions). Caps height so long hints can't push the toolbar off-screen. */}
              {!practiceMode && validation && !validation.passed && (
                <div
                  role="alert"
                  className="mx-4 mt-1.5 flex max-h-24 flex-col gap-0.5 overflow-y-auto rounded-lg bg-danger/10 px-3 py-1.5 text-xs font-medium text-danger"
                >
                  <span>{validation.feedback[0] ?? "Not quite."}</span>
                  {validation.nextHints?.[0] && (
                    <span className="text-[11px] font-normal opacity-80">{validation.nextHints[0]}</span>
                  )}
                </div>
              )}
              {/* Row 3 — Stats strip. Ambient motivation (time/attempts/runs/hints),
                  always visible. No controls here — Resets live in Row 1's ⋯ menu. */}
              {lp && (
                <div className="flex items-center px-4 pb-1.5 pt-1">
                  <div className="flex-1" />
                  <span
                    className="text-[10px] text-faint"
                    title="Time is estimated from active tabs. Long idle periods and hidden tabs are excluded."
                  >
                    {formatTimeSpent(lp.timeSpentMs)} · {lp.attemptCount} attempts · {lp.runCount} runs · {lp.hintCount} hints
                  </span>
                </div>
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
                onDrag={(dx) => setTutorW((w) => clampSide(w - dx, BOUNDS_TUTOR))}
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
                  priorConcepts={priorConcepts}
                  progressSummary={
                    lp
                      ? `attempt ${lp.attemptCount}, ${lp.runCount} runs, ${lp.hintCount} hints used`
                      : "first attempt"
                  }
                  onCollapse={() => setTutorCollapsed(true)}
                  onOpenSettings={() => setShowSettings(true)}
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
          completedPracticeIds={lp?.practiceCompletedIds ?? []}
          mastery={computeMastery(lp, lesson)?.level ?? null}
          timeSpentMs={lp?.timeSpentMs}
          onDismiss={() => setShowComplete(false)}
          onNext={nextLessonId ? () => nav(`/learn/course/${courseId}/lesson/${nextLessonId}`) : undefined}
          onStartPractice={lesson.practiceExercises?.length ? () => { setShowComplete(false); handleEnterPractice(); } : undefined}
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
        <Modal
          onClose={() => setConfirmResetLesson(false)}
          role="alertdialog"
          labelledBy="reset-lesson-title"
          position="center"
          panelClassName="mx-4 w-full max-w-sm rounded-xl border border-danger/30 bg-panel p-5 shadow-xl"
        >
          <h2 id="reset-lesson-title" className="text-sm font-bold text-ink">Reset Lesson Progress?</h2>
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
              className="flex-1 rounded-lg bg-danger/20 px-4 py-2 text-xs font-semibold text-danger ring-1 ring-danger/40 transition hover:bg-danger/30"
            >
              Reset Lesson
            </button>
          </div>
        </Modal>
      )}
      <NarrowViewportGate />
    </div>
  );
}
