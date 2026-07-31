import { useCallback, useEffect, useRef, useState, type MutableRefObject, type RefObject } from "react";
import { useSearchParams } from "react-router-dom";
import type { Options as ConfettiOptions } from "canvas-confetti";
import type { FunctionTest, Lesson, TestReport, ValidationResult } from "../types";
import {
  beginProjectOperation,
  isProjectOperationCurrent,
  useProjectStore,
  type ProjectOperationIdentity,
} from "../../../state/projectStore";
import { useRunStore } from "../../../state/runStore";
import { useAIStore } from "../../../state/aiStore";
import { useProgressStore } from "../stores/progressStore";
import { useValidatorUIStore } from "../stores/validatorUIStore";
import { api } from "../../../api/client";
import { isRetrievalPending, pickFirstFailure, validateLesson } from "../utils/validator";
import { CINEMA_DURATIONS } from "../../../components/cinema/easing";
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
// P-L2: import canvas-confetti on demand. It's ~30 KB and only fires when a
// lesson completes, so paying for it at page load is waste — hoisting the
// import into celebrate() lets the chunk fetch overlap with the completion
// animation itself, and reduced-motion users never fetch it at all.
function celebrate(options: ConfettiOptions) {
  if (typeof window === "undefined") return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  void import("canvas-confetti").then((m) => m.default(options));
}

export interface UseLessonValidatorArgs {
  lesson: Lesson | null;
  courseId: string | undefined;
  lessonId: string | undefined;
  /**
   * Phase 27-v2.1: null on the anon `/try/` path. When null, the
   * three /api/user/* PATCH paths in this hook (completeLesson on
   * Check pass, resetLessonProgress on practice entry, startLesson
   * on lesson re-entry from practice) are skipped — anon never
   * writes to the per-user lesson_progress / course_progress tables.
   * The validator's client-side validation (validateLesson against
   * the lesson's completionRules) runs identically regardless of
   * mode — the Check button still works, the celebration still
   * fires, just no PATCH side-effects on anon.
   */
  learnerId: string | null;
  totalLessons: number;
  sessionId: string | null;
  sessionPhase: string;
  // Holds the "${courseId}/${lessonId}" key once the loader has hydrated
  // this lesson's files into the project store. Consumers truthy-check it.
  initializedRef: RefObject<string | null>;
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
  /**
   * Phase 27-v2.1 audit pass 2 P2 #5: when "anon", `handleRunExamples`
   * early-returns. The path runs `api.snapshotProject` + `api.executeTests`
   * which are auth-required + sessionId-keyed; if a future anon-allowlisted
   * lesson defines `function_tests`, calling these unauth'd would 401 →
   * handle401() → signOut cascade. Today's hello-world has no
   * function_tests so the gate is dormant; landing it now closes the
   * trap door.
   */
  mode?: "authed" | "anon";
  /**
   * Phase A — A1: gates the `retrieval_check` rule (when present in
   * the lesson). LessonPage owns the source of truth; this hook just
   * reflects it into validateLesson(). When the flag flips false→true,
   * the next handleCheck() call (typically fired immediately by the
   * RetrievalCheckPanel correct-answer callback) will see the new
   * value and the lesson can complete. Defaults to false.
   */
  retrievalAnswered?: boolean;
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
  mode = "authed",
  retrievalAnswered = false,
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
  const testOperationRef = useRef<ProjectOperationIdentity | null>(null);
  // Mirror the local `runningTests` flag into runStore so the global
  // Cmd+Enter handler in useLessonRunner can see it. Without this, Cmd+Enter
  // while the test harness is mid-run triggers a fresh snapshot that wipes
  // the workspace under the harness's feet (torn stdout, spurious test
  // failures, or worst case a pass the learner didn't earn).
  useEffect(() => {
    useRunStore.setState({ runningTests });
    return () => useRunStore.setState({ runningTests: false });
  }, [runningTests]);
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
  const projectRevision = useProjectStore((s) => s.revision);

  const beginTestOperation = (): ProjectOperationIdentity => {
    const operation = beginProjectOperation();
    testOperationRef.current = operation;
    return operation;
  };
  const testOperationIsCurrent = (operation: ProjectOperationIdentity): boolean =>
    testOperationRef.current?.id === operation.id &&
    isProjectOperationCurrent(operation);
  const finishTestOperation = (operation: ProjectOperationIdentity): void => {
    if (testOperationRef.current?.id === operation.id) setRunningTests(false);
  };

  // Fresh lesson mount → clear all per-lesson state. Mirrors the loader's
  // reset behaviour but for validator-owned signals.
  useEffect(() => {
    if (!courseId || !lessonId) return;
    autoEnteredPractice.current = false;
    testOperationRef.current = null;
    setRunningTests(false);
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

  // Any executable-source revision invalidates every current Check artifact.
  // Historical attempt counters remain useful, but pass/fail praise and late
  // harness responses are not allowed to describe the new revision.
  useEffect(() => {
    if (!initializedRef.current) return;
    testOperationRef.current = null;
    setRunningTests(false);
    setTestReport(null);
    setValidation(null);
    setPracticeValidation(null);
    setShowComplete(false);
    setHasChecked(false);
  }, [projectRevision, initializedRef]);

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
    // Pass 2 P2 #5: anon path has no sessionId; api.snapshotProject /
    // executeTests are auth+session-keyed and would 401 → cascade.
    // Today's hello-world has no function_tests so this gate is dormant
    // (the existing `!sessionId` check below already early-returns), but
    // landing the explicit mode check now closes the trap door for any
    // future anon-allowlisted lesson with function_tests.
    if (mode === "anon") return;
    if (!sessionId || sessionPhase !== "active" || runningTests || !courseId || !lessonId || !lesson) return;
    if (functionTests.length === 0) return;
    const operation = beginTestOperation();
    setRunningTests(true);
    try {
      const files = useProjectStore.getState().snapshot();
      await api.snapshotProject(sessionId, files);
      if (!testOperationIsCurrent(operation)) return;
      // Always batch visible + hidden in one harness run — a single harness
      // invocation carries the full overhead (docker exec, boot, runtime
      // init); the per-test cost inside is negligible.
      const res = await api.executeTests(sessionId, lesson.language, functionTests);
      if (!testOperationIsCurrent(operation)) return;
      setTestReport(res.report);
    } catch (err) {
      if (testOperationIsCurrent(operation)) {
        setTestReport({
          results: [],
          harnessError: (err as Error).message,
          cleanStdout: "",
        });
      }
    } finally {
      finishTestOperation(operation);
    }
  }, [sessionId, sessionPhase, runningTests, courseId, lessonId, lesson, functionTests, mode]);

  const handleCheck = useCallback(async (overrides?: { retrievalAnswered?: boolean }) => {
    // Phase A — A1: callers (specifically the RetrievalCheckPanel
    // correct-answer callback) need to re-run validation with a value
    // they JUST set, before React has re-rendered. The hook closure
    // captures `retrievalAnswered` at callback-creation time, so reading
    // the prop directly here would yield the stale `false`. The override
    // bridges that gap — we use it if provided, else fall back to the
    // closure-captured value (the normal Check-button path).
    if (!lesson || !courseId || !lessonId || runningTests) return;
    const operation = beginTestOperation();
    const effectiveRetrievalAnswered =
      overrides?.retrievalAnswered ?? retrievalAnswered;
    const files = useProjectStore.getState().snapshot();
    const result = useRunStore.getState().result;

    // Each Check button press is one attempt. Bump here (not in
    // `startLesson`, where it was incorrectly counting page opens).
    // Practice-mode checks have their own per-exercise completion
    // model and don't roll up into the lesson's attemptCount.
    const isRetrievalRecheck = overrides?.retrievalAnswered === true;
    if (!practiceMode && !isRetrievalRecheck) {
      useProgressStore.getState().incrementAttempt(courseId, lessonId);
    }

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
          if (!testOperationIsCurrent(operation)) return;
          const res = await api.executeTests(sessionId, lesson.language, practiceFnTests);
          if (!testOperationIsCurrent(operation)) return;
          practiceReport = res.report;
        } catch (err) {
          if (testOperationIsCurrent(operation)) {
            practiceReport = {
              results: [],
              harnessError: (err as Error).message,
              cleanStdout: "",
            };
          }
        } finally {
          finishTestOperation(operation);
        }
      }
      if (!testOperationIsCurrent(operation)) return;
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
        if (!testOperationIsCurrent(operation)) return;
        const res = await api.executeTests(sessionId!, lesson.language, functionTests);
        if (!testOperationIsCurrent(operation)) return;
        latestReport = res.report;
        setTestReport(res.report);
      } catch (err) {
        if (testOperationIsCurrent(operation)) {
          latestReport = {
            results: [],
            harnessError: (err as Error).message,
            cleanStdout: "",
          };
          setTestReport(latestReport);
        }
      } finally {
        finishTestOperation(operation);
      }
    }

    if (!testOperationIsCurrent(operation)) return;
    const v = validateLesson(result, files, lesson.completionRules, {
      testReport: latestReport,
      language: lesson.language,
      retrievalAnswered: effectiveRetrievalAnswered,
    });
    setValidation(v);
    setHasChecked(true);
    if (!v.passed && !isRetrievalPending(v)) {
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
      // Phase 27-v2.1: skip server-side completion PATCH on anon
      // (learnerId === null). Client-side validation has already
      // flipped to passed; the celebration UI fires regardless.
      // Anon's lesson 1 completion is recorded server-side only at
      // signup-handoff time (POST /api/anon-handoff writes
      // lesson_progress.status=completed atomically with the user
      // creation).
      if (learnerId !== null) {
        completeLesson(learnerId, courseId, lessonId, totalLessons);
      }
      // Cinema Kit — déjà vu beat. Before the confetti explosion,
      // fire a three-ring sonar expanding from the Check button.
      // This is the same RingPulse shape the learner first saw at
      // the end of the /welcome cinematic — different color +
      // size + anchor, but the shape language is identical. The
      // 250 ms hold lets "I passed" register before the
      // celebration lands; without it, button→confetti reads as
      // one motion instead of two beats.
      useValidatorUIStore.getState().bumpSonar();
      // Lesson pass is THE moment in the product — treat it like one.
      // Multi-wave confetti: a large center burst, then two side cannons
      // crossing the screen a beat later. Colors tuned to the brand
      // palette so the celebration doesn't look like a generic party
      // dropped on top of our UI.
      const brandColors = [
        "#22c55e", // success green
        "#3b82f6", // accent blue-ish
        "#a855f7", // violet
        "#eab308", // warm gold
        "#f472b6", // rose pop
      ];
      window.setTimeout(() => {
        if (!testOperationIsCurrent(operation)) return;
        celebrate({
          particleCount: 220,
          spread: 100,
          startVelocity: 48,
          origin: { y: 0.55 },
          colors: brandColors,
        });
        window.setTimeout(() => {
          if (!testOperationIsCurrent(operation)) return;
          celebrate({
            particleCount: 100,
            angle: 60,
            spread: 70,
            startVelocity: 58,
            origin: { x: 0, y: 0.7 },
            colors: brandColors,
          });
          celebrate({
            particleCount: 100,
            angle: 120,
            spread: 70,
            startVelocity: 58,
            origin: { x: 1, y: 0.7 },
            colors: brandColors,
          });
        }, 220);
        if (!testOperationIsCurrent(operation)) return;
        setShowComplete(true);
      }, CINEMA_DURATIONS.sonarHold);
    }
  }, [lesson, courseId, lessonId, completeLesson, learnerId, totalLessons, validation, practiceMode, practiceIndex, completePracticeExercise, sessionId, functionTests, testReport, lastFailedName, retrievalAnswered, runningTests]);

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
    useProjectStore.getState().replaceProject({
      files,
      order,
      activeFile: order[0] ?? entry,
      openTabs: [order[0] ?? entry],
    });
    setPracticeValidation(null);
  }, [lesson, courseId, lessonId]);

  const handleEnterPractice = useCallback(() => {
    if (!lesson?.practiceExercises?.length) return;
    // Phase 27-v2.1 medium-lock: practice exercises are gated behind
    // signup on /try/. The LessonCompletePanel mount routes anon-mode
    // onStartPractice clicks to onAnonNext (opens the wall), so this
    // direct handler shouldn't fire on anon — but defense-in-depth in
    // case a future entry point (e.g., a Practice tab in
    // LessonInstructionsPanel) calls it without the gate. The auto-
    // enter-practice URL path is already gated transitively via
    // lessonProgress[key] being undefined on anon.
    if (mode === "anon") return;
    savedLessonCode.current = useProjectStore.getState().snapshot().reduce(
      (acc, f) => { acc[f.path] = f.content; return acc; },
      {} as Record<string, string>,
    );
    setPracticeMode(true);
    setPracticeIndex(0);
    setShowComplete(false);
    applyPracticeStarter(0);
  }, [lesson, applyPracticeStarter, mode]);

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
      useProjectStore.getState().replaceProject({
        files: { ...savedLessonCode.current },
        order,
        activeFile: order[0],
        openTabs: [order[0]],
      });
      savedLessonCode.current = null;
    }
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
    useProjectStore.getState().replaceProject({
      files,
      order,
      activeFile: order[0],
      openTabs: [order[0]],
    });
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
    // Phase 27-v2.1: skip server-side reset PATCH on anon
    // (learnerId === null). Anon never has lesson_progress to reset.
    if (learnerId !== null) {
      resetLessonProgress(learnerId, courseId, lessonId);
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
    useProjectStore.getState().replaceProject({
      files,
      order,
      activeFile: order[0],
      openTabs: [order[0]],
    });
    setValidation(null);
    setShowComplete(false);
    setConfirmResetLesson(false);
    setResetNonce((n) => n + 1);
    setFailedCheckCount(0);
    setFailedVisibleTests(0);
    setFailedHiddenTests(0);
    setHasChecked(false);
    onResetRunnerFlags?.();
    // Phase 27-v2.1: skip startLesson PATCH on anon.
    if (learnerId !== null) {
      startLesson(learnerId, courseId, lessonId);
    }
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
