import { useCallback, useEffect, useRef, useState, type MutableRefObject, type RefObject } from "react";
import { useSearchParams } from "react-router-dom";
import confetti from "canvas-confetti";
import type { FunctionTest, Lesson, TestReport, ValidationResult } from "../types";
import { useProjectStore } from "../../../state/projectStore";
import { useRunStore } from "../../../state/runStore";
import { useAIStore } from "../../../state/aiStore";
import { useProgressStore } from "../stores/progressStore";
import { api } from "../../../api/client";
import { pickFirstFailure, validateLesson } from "../utils/validator";
import { LANGUAGE_ENTRYPOINT } from "../../../types";
import {
  buildAskTutorPrompt,
  countFailsByVisibility,
  selectCompletionRulesForCheck,
  shouldAutoEnterPractice,
  shouldBouncePrereq,
} from "./lessonGuards";

// Phase 20-P1: confetti respects `prefers-reduced-motion`. Lifted out of
// the page when LessonPage was split — validator is the only place left
// that celebrates lesson/practice completion.
function celebrate(options: confetti.Options) {
  if (typeof window === "undefined") return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  confetti(options);
}

export interface UseLessonValidatorArgs {
  lesson: Lesson | null;
  courseId: string | undefined;
  lessonId: string | undefined;
  learnerId: string;
  totalLessons: number;
  sessionId: string | null;
  sessionPhase: string;
  initializedRef: RefObject<boolean>;
  // Practice-mode state lives on the page so the loader (for auto-save
  // keying) and the validator (for the check/run/enter-practice flows)
  // share one source of truth without re-deriving it.
  practiceMode: boolean;
  setPracticeMode: (v: boolean) => void;
  practiceIndex: number;
  setPracticeIndex: (v: number) => void;
  savedLessonCode: MutableRefObject<Record<string, string> | null>;
  // Tutor pane coordination — same contract as useLessonRunner: auto-expand
  // when nudging the tutor with a pre-seeded question.
  tutorCollapsed: boolean;
  setTutorCollapsed: (v: boolean) => void;
  // Reset hooks owned by the runner so "Reset Lesson" can clear hasRun /
  // hasEdited alongside the validator-owned counters.
  onResetRunnerFlags?: () => void;
}

export function useLessonValidator({
  lesson,
  courseId,
  lessonId,
  learnerId,
  totalLessons,
  sessionId,
  sessionPhase,
  initializedRef,
  practiceMode,
  setPracticeMode,
  practiceIndex,
  setPracticeIndex,
  savedLessonCode,
  tutorCollapsed,
  setTutorCollapsed,
  onResetRunnerFlags,
}: UseLessonValidatorArgs) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [showComplete, setShowComplete] = useState(false);
  const [hasChecked, setHasChecked] = useState(false);
  const [failedCheckCount, setFailedCheckCount] = useState(0);
  const [failedVisibleTests, setFailedVisibleTests] = useState(0);
  const [failedHiddenTests, setFailedHiddenTests] = useState(0);
  const [practiceValidation, setPracticeValidation] = useState<ValidationResult | null>(null);
  const [testReport, setTestReport] = useState<TestReport | null>(null);
  const [runningTests, setRunningTests] = useState(false);
  const [lastFailedName, setLastFailedName] = useState<string | null>(null);
  const [sameFailStreak, setSameFailStreak] = useState(0);
  const [resetNonce, setResetNonce] = useState(0);
  const [confirmResetLesson, setConfirmResetLesson] = useState(false);
  const autoEnteredPractice = useRef(false);

  const completeLesson = useProgressStore((s) => s.completeLesson);
  const completePracticeExercise = useProgressStore((s) => s.completePracticeExercise);
  const resetLessonProgress = useProgressStore((s) => s.resetLessonProgress);
  const resetPracticeProgress = useProgressStore((s) => s.resetPracticeProgress);
  const saveCode = useProgressStore((s) => s.saveCode);
  const startLesson = useProgressStore((s) => s.startLesson);
  const setPendingAsk = useAIStore((s) => s.setPendingAsk);
  const projectFiles = useProjectStore((s) => s.files);

  // Fresh lesson mount → clear all per-lesson state. Mirrors the loader's
  // reset behaviour but for validator-owned signals.
  useEffect(() => {
    if (!courseId || !lessonId) return;
    autoEnteredPractice.current = false;
    setValidation(null);
    setShowComplete(false);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId, lessonId]);

  // Invalidate the test report when code changes — stale pass/fail marks
  // would mislead (green ✓ on a card while the user just broke the function).
  useEffect(() => {
    if (initializedRef.current) setTestReport(null);
  }, [projectFiles, initializedRef]);

  // Collects every FunctionTest authored across function_tests rules on the
  // lesson (most have at most one such rule, but the schema allows multiple).
  // Practice exercises aren't included — those stay on legacy
  // expected_stdout / required_file_contains.
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
      // invocation carries the full overhead (docker exec, boot, runtime
      // init); the per-test cost inside is negligible.
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
      const practiceRules = selectCompletionRulesForCheck(lesson, true, practiceIndex);
      const practiceFnTests = practiceRules
        .filter((r) => r.type === "function_tests")
        .flatMap((r) => r.tests ?? []);
      let practiceReport: TestReport | null = null;
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
    // validates against a fresh report. Ensures the callout reflects the
    // current code, not a stale Run-examples result.
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
      // QA-H5: a harness error (docker exec hiccup, network timeout) surfaces
      // as v.passed=false + testReport.harnessError. That's infrastructure
      // noise — not the learner struggling. Only genuine validation
      // outcomes (expected_stdout mismatch, real test failures) bump the
      // counters that drive the coach nudges.
      const harnessErrored = Boolean(latestReport?.harnessError);
      if (!harnessErrored) {
        setFailedCheckCount((c) => c + 1);
        if (latestReport && functionTests.length > 0) {
          const { visibleFails, hiddenFails } = countFailsByVisibility(latestReport);
          if (visibleFails > 0) setFailedVisibleTests((c) => c + 1);
          else if (hiddenFails > 0) setFailedHiddenTests((c) => c + 1);
        }
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
  // per lesson load, only if the lesson is actually completed + has
  // exercises. Clears the query param so exiting practice doesn't
  // re-trigger.
  useEffect(() => {
    if (!lesson || !courseId || !lessonId) return;
    if (autoEnteredPractice.current) return;
    if (searchParams.get("mode") !== "practice") return;
    const currentLp = useProgressStore.getState().lessonProgress[`${courseId}/${lessonId}`];
    const canEnter = shouldAutoEnterPractice({
      hasLesson: true,
      modeParam: searchParams.get("mode"),
      lessonStatus: currentLp?.status,
      practiceExerciseCount: lesson.practiceExercises?.length ?? 0,
    });
    if (!canEnter) {
      setSearchParams({}, { replace: true });
      return;
    }
    autoEnteredPractice.current = true;
    handleEnterPractice();
    setSearchParams({}, { replace: true });
  }, [lesson, courseId, lessonId, searchParams, setSearchParams, handleEnterPractice]);

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

  const handleSelectPracticeExercise = useCallback(
    (index: number) => {
      setPracticeIndex(index);
      applyPracticeStarter(index);
    },
    [applyPracticeStarter],
  );

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

  const handleResetLessonProgress = useCallback(() => {
    if (!lesson || !courseId || !lessonId) return;
    // QA-M4: re-check prereqs before the mutating startLesson at the bottom
    // of this handler. Reset sets existingStatus → not_started, so if a
    // prereq was since reset too (or a course update re-locked this lesson),
    // the guard must fire and bounce — otherwise startLesson would write a
    // fresh in_progress row that self-unlocks a lesson the learner isn't
    // entitled to. resetLessonProgress has already cleared the old row in
    // memory + fired the server patch, so we must check prereq state from
    // the post-reset snapshot.
    const progressState = useProgressStore.getState();
    const completedIds =
      progressState.courseProgress[courseId]?.completedLessonIds ?? [];
    if (
      shouldBouncePrereq({
        lessonPrerequisiteIds: lesson.prerequisiteLessonIds,
        completedLessonIds: completedIds,
        existingStatus: "not_started",
      })
    ) {
      // No direct reset → skip the mutating startLesson; the user is about
      // to be bounced by the loader on the next navigate anyway. Still clear
      // the editor state so a stale view doesn't linger until navigation.
      setConfirmResetLesson(false);
      return;
    }
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
    setFailedCheckCount(0);
    setFailedVisibleTests(0);
    setFailedHiddenTests(0);
    setHasChecked(false);
    onResetRunnerFlags?.();
    startLesson(learnerId, courseId, lessonId);
  }, [lesson, courseId, lessonId, learnerId, resetLessonProgress, startLesson, onResetRunnerFlags]);

  // "Ask tutor why" from the FailedTestCallout. For visible tests we can
  // share call + expected + got so the tutor coaches concretely; for hidden
  // tests we keep inputs private and only describe the shape of the
  // problem — the tutor's job is to coach the learner toward generating
  // their own edge-case hypothesis, not to reveal the hidden case.
  const handleAskTutorAboutFailure = useCallback(() => {
    const fail = pickFirstFailure(testReport);
    if (!fail) return;
    setPendingAsk(buildAskTutorPrompt(fail));
    if (tutorCollapsed) setTutorCollapsed(false);
  }, [testReport, setPendingAsk, tutorCollapsed, setTutorCollapsed]);

  const passedVisibleTests = testReport
    ? testReport.results.filter((r) => !r.hidden && r.passed).length
    : 0;

  return {
    validation,
    practiceValidation,
    showComplete,
    setShowComplete,
    hasChecked,
    failedCheckCount,
    failedVisibleTests,
    failedHiddenTests,
    sameFailStreak,
    testReport,
    runningTests,
    practiceMode,
    practiceIndex,
    resetNonce,
    confirmResetLesson,
    setConfirmResetLesson,
    functionTests,
    passedVisibleTests,
    handleCheck,
    handleRunExamples,
    handleReset,
    handleResetLessonProgress,
    handleEnterPractice,
    handleExitPractice,
    handleSelectPracticeExercise,
    handleNextPracticeExercise,
    handleResetPracticeProgress,
    handleAskTutorAboutFailure,
  };
}
