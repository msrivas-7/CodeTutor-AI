import { useCallback, useEffect, useRef, useState, type MutableRefObject, type RefObject } from "react";
import { flushSync } from "react-dom";
import { useSearchParams } from "react-router-dom";
import type { Options as ConfettiOptions } from "canvas-confetti";
import type { FunctionTest, Lesson, SourceCheck, TestReport, ValidationResult } from "../types";
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
import { ApiError } from "../../../api/ApiError";
import { isRetrievalPending, pickFirstFailure, validateLesson } from "../utils/validator";
import { CINEMA_DURATIONS } from "../../../components/cinema/easing";
import { LANGUAGE_ENTRYPOINT } from "../../../types";
import {
  buildAskTutorPrompt,
  countFailsByVisibility,
  lessonWorkspaceContextKey,
  selectPracticeWorkspaceFiles,
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

interface PracticeEvidenceSession {
  startedAt: number;
  attemptCount: number;
  startingTutorHintCount: number;
  authoredHintCount: number;
}

interface TutorUndoSnapshot {
  history: ReturnType<typeof useAIStore.getState>["history"];
  conversationSummary: string | null;
  summarizedThrough: number;
  sessionUsage: ReturnType<typeof useAIStore.getState>["sessionUsage"];
  tutorProgressToken: string | null;
  lastTurnFiles: Record<string, string> | null;
  runsSinceLastTurn: number;
  editsSinceLastTurn: number;
}

interface ResetUndoSnapshot {
  files: Record<string, string>;
  order: string[];
  activeFile: string | null;
  openTabs: string[];
  result: ReturnType<typeof useRunStore.getState>["result"];
  error: string | null;
  stdin: string;
  validation: ValidationResult | null;
  practiceValidation: ValidationResult | null;
  hadRun: boolean;
  tutor: TutorUndoSnapshot;
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
  onRestoreRunnerFlags?: (hadRun: boolean) => void;
  resetInteractionRef?: MutableRefObject<boolean>;
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
  /**
   * Anonymous progress must reach sessionStorage in the same interaction
   * that earns it. A later React effect is useful for general workspace
   * autosave, but an immediate reload can interrupt that effect.
   */
  onAnonProgressCommitted?: (progress: {
    completed: boolean;
    practiceCompletedIds: string[];
  }) => void;
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
  onRestoreRunnerFlags,
  resetInteractionRef,
  mode = "authed",
  retrievalAnswered = false,
  onAnonProgressCommitted,
}: UseLessonValidatorArgs) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [showComplete, setShowComplete] = useState(false);
  const [completionPresentationPending, setCompletionPresentationPending] = useState(false);
  const [completionSaving, setCompletionSaving] = useState(false);
  const [completionSaveError, setCompletionSaveError] = useState<string | null>(null);
  const [hasChecked, setHasChecked] = useState(false);
  const [failedCheckCount, setFailedCheckCount] = useState(0);
  const [failedVisibleTests, setFailedVisibleTests] = useState(0);
  const [failedHiddenTests, setFailedHiddenTests] = useState(0);
  const [practiceValidation, setPracticeValidation] = useState<ValidationResult | null>(null);
  const [localLessonCompleted, setLocalLessonCompleted] = useState(false);
  const [localPracticeCompletedIds, setLocalPracticeCompletedIds] = useState<string[]>([]);
  const localPracticeCompletedIdsRef = useRef<string[]>([]);
  const [practiceSaveError, setPracticeSaveError] = useState<string | null>(null);
  const [practiceSaving, setPracticeSaving] = useState(false);
  const [practiceRetryAt, setPracticeRetryAt] = useState<number | null>(null);
  const [testReport, setTestReport] = useState<TestReport | null>(null);
  const [practiceTestReport, setPracticeTestReport] = useState<TestReport | null>(null);
  const [practiceTransitioning, setPracticeTransitioning] = useState(false);
  const [practiceTransitionError, setPracticeTransitionError] = useState<string | null>(null);
  const [practiceContentCommit, setPracticeContentCommit] = useState<{
    ticket: number;
    path: string;
    content: string;
  } | null>(null);
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
  const [resettingLesson, setResettingLesson] = useState(false);
  const [resetLessonError, setResetLessonError] = useState<string | null>(null);
  const [confirmResetCode, setConfirmResetCode] = useState(false);
  const [resetCodeError, setResetCodeError] = useState<string | null>(null);
  const [resetUndo, setResetUndo] = useState<ResetUndoSnapshot | null>(null);
  const [resettingCode, setResettingCode] = useState(false);
  const [resetContentCommit, setResetContentCommit] = useState<{
    ticket: number;
    path: string;
    content: string;
  } | null>(null);
  const resetUndoRevisionRef = useRef<number | null>(null);
  // Monaco settles editor-content commits with a monotonic ticket. Reset and
  // practice transitions share the same counter so a later request can never
  // be mistaken for an already-settled request from the other flow.
  const contentCommitTicketRef = useRef(0);
  const pendingResetUndoRef = useRef<ResetUndoSnapshot | null>(null);
  const autoEnteredPractice = useRef(false);
  const practiceEvidence = useRef(new Map<string, PracticeEvidenceSession>());

  const completeLesson = useProgressStore((s) => s.completeLesson);
  const completePracticeExercise = useProgressStore((s) => s.completePracticeExercise);
  const resetLessonProgress = useProgressStore((s) => s.resetLessonProgress);
  const resetPracticeProgress = useProgressStore((s) => s.resetPracticeProgress);
  const saveCode = useProgressStore((s) => s.saveCode);
  const savePracticeCode = useProgressStore((s) => s.savePracticeCode);
  const startLesson = useProgressStore((s) => s.startLesson);
  const setPendingAsk = useAIStore((s) => s.setPendingAsk);
  const projectRevision = useProjectStore((s) => s.revision);
  const currentRunRevision = useRunStore((s) => s.runRevision);
  const currentRunResult = useRunStore((s) => s.result);
  const currentRunError = useRunStore((s) => s.error);

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
    setCompletionPresentationPending(false);
    setCompletionSaving(false);
    setCompletionSaveError(null);
    setHasChecked(false);
    setFailedCheckCount(0);
    setFailedVisibleTests(0);
    setFailedHiddenTests(0);
    setPracticeMode(false);
    setPracticeIndex(0);
    setPracticeValidation(null);
    setLocalLessonCompleted(false);
    setLocalPracticeCompletedIds([]);
    localPracticeCompletedIdsRef.current = [];
    setPracticeSaveError(null);
    setPracticeSaving(false);
    setPracticeRetryAt(null);
    setTestReport(null);
    setPracticeTestReport(null);
    setPracticeTransitioning(false);
    setPracticeTransitionError(null);
    setPracticeContentCommit(null);
    setLastFailedName(null);
    setSameFailStreak(0);
    setConfirmResetCode(false);
    setResetCodeError(null);
    setResetUndo(null);
    setResettingCode(false);
    setResetContentCommit(null);
    if (resetInteractionRef) resetInteractionRef.current = false;
    resetUndoRevisionRef.current = null;
    pendingResetUndoRef.current = null;
    savedLessonCode.current = null;
    practiceEvidence.current.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => {
      if (resetInteractionRef) resetInteractionRef.current = false;
    };
  }, [courseId, lessonId, resetInteractionRef]);

  useEffect(() => {
    if (!resetUndo || resetUndoRevisionRef.current === null) return;
    if (projectRevision === resetUndoRevisionRef.current) return;
    setResetUndo(null);
    resetUndoRevisionRef.current = null;
  }, [projectRevision, resetUndo]);

  useEffect(() => {
    if (!resetUndo || (!currentRunResult && !currentRunError)) return;
    setResetUndo(null);
    resetUndoRevisionRef.current = null;
  }, [currentRunResult, currentRunError, resetUndo]);

  // Starting a fresh execution invalidates any visible Check verdict, even
  // when the source itself has not changed. Otherwise a learner can see an
  // old "Run your code first" or failed-output banner while the new run has
  // already produced different evidence. Clear presentation state at the
  // moment Run begins. `runRevision` is monotonic because a very fast program
  // can flip the transient running flag true and false inside one React batch.
  // Attempt history remains intact and the next Check evaluates the newly
  // committed result.
  useEffect(() => {
    if (!initializedRef.current) return;
    testOperationRef.current = null;
    setRunningTests(false);
    setTestReport(null);
    setPracticeTestReport(null);
    setValidation(null);
    setPracticeValidation(null);
    setPracticeSaveError(null);
    setShowComplete(false);
    setCompletionPresentationPending(false);
    setHasChecked(false);
  }, [currentRunRevision, initializedRef]);

  // Any executable-source revision invalidates every current Check artifact.
  // Historical attempt counters remain useful, but pass/fail praise and late
  // harness responses are not allowed to describe the new revision.
  useEffect(() => {
    if (!initializedRef.current) return;
    testOperationRef.current = null;
    setRunningTests(false);
    setTestReport(null);
    setPracticeTestReport(null);
    setValidation(null);
    setPracticeValidation(null);
    setPracticeSaveError(null);
    setShowComplete(false);
    setCompletionPresentationPending(false);
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

  const sourceChecks: SourceCheck[] = (() => {
    if (!lesson || practiceMode) return [];
    return lesson.completionRules
      .filter((rule) => rule.type === "source_checks")
      .flatMap((rule) => rule.checks ?? []);
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
    if (functionTests.length === 0 && sourceChecks.length === 0) return;
    const operation = beginTestOperation();
    setRunningTests(true);
    try {
      const files = useProjectStore.getState().snapshot();
      await api.snapshotProject(sessionId, files);
      if (!testOperationIsCurrent(operation)) return;
      // Always batch visible + hidden in one harness run — a single harness
      // invocation carries the full overhead (docker exec, boot, runtime
      // init); the per-test cost inside is negligible.
      const res = await api.executeTests(sessionId, lesson.language, functionTests, sourceChecks);
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
  }, [sessionId, sessionPhase, runningTests, courseId, lessonId, lesson, functionTests, sourceChecks, mode]);

  const handleCheck = useCallback(async (overrides?: { retrievalAnswered?: boolean }) => {
    if (completionSaving || resetInteractionRef?.current) return;
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
      setPracticeSaveError(null);
      const lessonProgress = useProgressStore.getState().lessonProgress[`${courseId}/${lessonId}`];
      const evidence = practiceEvidence.current.get(exercise.id) ?? {
        startedAt: Date.now(),
        attemptCount: 0,
        startingTutorHintCount: lessonProgress?.hintCount ?? 0,
        authoredHintCount: 0,
      };
      evidence.attemptCount = Math.min(100, evidence.attemptCount + 1);
      practiceEvidence.current.set(exercise.id, evidence);
      const practiceRules = selectCompletionRulesForCheck(lesson, true, practiceIndex);
      const practiceFnTests = practiceRules
        .filter((r) => r.type === "function_tests")
        .flatMap((r) => r.tests ?? []);
      const practiceSourceChecks = practiceRules
        .filter((r) => r.type === "source_checks")
        .flatMap((r) => r.checks ?? []);
      let practiceReport: TestReport | null = null;
      if ((practiceFnTests.length > 0 || practiceSourceChecks.length > 0) && sessionId) {
        setRunningTests(true);
        try {
          await api.snapshotProject(sessionId, files);
          if (!testOperationIsCurrent(operation)) return;
          const res = await api.executeTests(
            sessionId,
            lesson.language,
            practiceFnTests,
            practiceSourceChecks,
          );
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
      setPracticeTestReport(practiceReport);
      const v = validateLesson(result, files, exercise.completionRules, {
        testReport: practiceReport,
        language: lesson.language,
      });
      if (!v.passed) setPracticeValidation(v);
      if (v.passed) {
        const current = useProgressStore.getState().lessonProgress[`${courseId}/${lessonId}`];
        const alreadyDone = (learnerId === null
          ? localPracticeCompletedIdsRef.current
          : current?.practiceCompletedIds ?? []
        ).includes(exercise.id);
        if (!alreadyDone) {
          if (learnerId === null) {
            const next = [...localPracticeCompletedIdsRef.current, exercise.id];
            localPracticeCompletedIdsRef.current = next;
            setLocalPracticeCompletedIds(next);
            onAnonProgressCommitted?.({
              completed: localLessonCompleted,
              practiceCompletedIds: next,
            });
            setPracticeValidation(v);
            setPracticeSaveError(null);
            celebrate({ particleCount: 80, spread: 55, origin: { y: 0.7 } });
            return;
          }
          if (practiceRetryAt !== null && Date.now() < practiceRetryAt) {
            const seconds = Math.max(1, Math.ceil((practiceRetryAt - Date.now()) / 1000));
            setPracticeSaveError(`Your solution is safe here. Retry saving in ${seconds}s.`);
            return;
          }
          const tutorHintCount = Math.max(
            0,
            (current?.hintCount ?? 0) - evidence.startingTutorHintCount,
          );
          setRunningTests(true);
          setPracticeSaving(true);
          try {
            const recorded = await completePracticeExercise(
              courseId,
              lessonId,
              exercise.id,
              {
                requestId: crypto.randomUUID(),
                attemptCount: Math.max(1, evidence.attemptCount),
                hintCount: Math.min(
                  100,
                  tutorHintCount + evidence.authoredHintCount,
                ),
                timeSpentMs: Math.min(
                  24 * 60 * 60 * 1_000,
                  Math.max(0, Date.now() - evidence.startedAt),
                ),
                modelAssisted: tutorHintCount > 0,
              },
            );
            if (!testOperationIsCurrent(operation)) return;
            if (recorded) {
              setPracticeValidation(v);
              setPracticeSaveError(null);
              setPracticeRetryAt(null);
              celebrate({ particleCount: 80, spread: 55, origin: { y: 0.7 } });
            }
          } catch (error) {
            if (!testOperationIsCurrent(operation)) return;
            const retrySeconds =
              error instanceof ApiError ? error.retryAfterSeconds : null;
            const retryAt = retrySeconds
              ? Date.now() + retrySeconds * 1000
              : null;
            setPracticeRetryAt(retryAt);
            setPracticeSaveError(
              retryAt
                ? `Your solution passed and is still in the editor. Retry saving when the countdown ends.`
                : "Your solution passed and is still in the editor, but it was not saved. Retry when you're ready.",
            );
          } finally {
            setPracticeSaving(false);
            finishTestOperation(operation);
          }
        } else {
          setPracticeValidation(v);
        }
      }
      return;
    }

    // For lessons with function_tests, run the harness now so Check My Work
    // validates against a fresh report. Ensures the callout reflects the
    // current code, not a stale Run-examples result.
    let latestReport = testReport;
    if (functionTests.length > 0 || sourceChecks.length > 0) {
      setRunningTests(true);
      try {
        await api.snapshotProject(sessionId!, files);
        if (!testOperationIsCurrent(operation)) return;
        const res = await api.executeTests(
          sessionId!,
          lesson.language,
          functionTests,
          sourceChecks,
        );
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
    // Authenticated success is not visible as durable completion until the
    // progress write succeeds. Anonymous completion is intentionally local
    // until signup handoff, so it can render immediately.
    if (!v.passed || learnerId === null) setValidation(v);
    else if (!validation?.passed) setValidation(null);
    if (v.passed && learnerId === null) {
      setLocalLessonCompleted(true);
      onAnonProgressCommitted?.({
        completed: true,
        practiceCompletedIds: localPracticeCompletedIdsRef.current,
      });
    }
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
        if (latestReport && (functionTests.length > 0 || sourceChecks.length > 0)) {
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
    if (v.passed && (!validation?.passed || completionSaveError !== null)) {
      // Lock completion navigation before the durable progress write begins.
      // The progress store can publish `completed` as soon as the request
      // resolves; setting this later creates a real frame where Next Lesson is
      // actionable even though the completion presentation is not ready.
      setCompletionPresentationPending(true);
      // Phase 27-v2.1: skip server-side completion PATCH on anon
      // (learnerId === null). Client-side validation has already
      // flipped to passed; the celebration UI fires regardless.
      // Anon's lesson 1 completion is recorded server-side only at
      // signup-handoff time (POST /api/anon-handoff writes
      // lesson_progress.status=completed atomically with the user
      // creation).
      if (learnerId !== null) {
        setCompletionSaving(true);
        setCompletionSaveError(null);
        try {
          await completeLesson(learnerId, courseId, lessonId, totalLessons);
          if (!testOperationIsCurrent(operation)) return;
          setValidation(v);
        } catch (cause) {
          if (!testOperationIsCurrent(operation)) return;
          setCompletionPresentationPending(false);
          setCompletionSaveError(
            cause instanceof Error
              ? cause.message
              : "Your solution passed but completion could not be saved.",
          );
          return;
        } finally {
          setCompletionSaving(false);
        }
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
        setCompletionPresentationPending(false);
        setShowComplete(true);
      }, CINEMA_DURATIONS.sonarHold);
    }
  }, [lesson, courseId, lessonId, completeLesson, learnerId, totalLessons, validation, practiceMode, practiceIndex, completePracticeExercise, sessionId, functionTests, sourceChecks, testReport, lastFailedName, retrievalAnswered, runningTests, practiceRetryAt, completionSaving, completionSaveError, localLessonCompleted, onAnonProgressCommitted]);

  const applyPracticeStarter = useCallback((
    exerciseIndex: number,
    forceDefaults = false,
    trackEditorTransition = true,
  ) => {
    if (!lesson?.practiceExercises || !courseId || !lessonId) return;
    const exercise = lesson.practiceExercises[exerciseIndex];
    if (!exercise) return;
    if (!practiceEvidence.current.has(exercise.id)) {
      const current = useProgressStore.getState().lessonProgress[`${courseId}/${lessonId}`];
      practiceEvidence.current.set(exercise.id, {
        startedAt: Date.now(),
        attemptCount: 0,
        startingTutorHintCount: current?.hintCount ?? 0,
        authoredHintCount: 0,
      });
    }
    const entry = LANGUAGE_ENTRYPOINT[lesson.language];
    // Prefer the learner's persisted WIP for this specific exercise. Falls
    // back to the authored starter only on first visit or after an explicit
    // practice reset (which clears the persisted map).
    const lp = useProgressStore.getState().lessonProgress[`${courseId}/${lessonId}`];
    const persisted = lp?.practiceExerciseCode?.[exercise.id];
    const files = selectPracticeWorkspaceFiles(
      entry,
      exercise.starterCode,
      persisted,
      forceDefaults,
    );
    const order = Object.keys(files);
    const activePath = order[0] ?? entry;
    if (trackEditorTransition) {
      setPracticeTransitioning(true);
      setPracticeTransitionError(null);
    }
    useProjectStore.getState().switchProjectContext(
      `practice:${courseId}/${lessonId}/${exercise.id}`,
      {
        language: lesson.language,
        files,
        order,
        activeFile: activePath,
        openTabs: [activePath],
      },
      forceDefaults ? { forceDefaults: true } : undefined,
    );
    useRunStore.getState().switchRunContext(
      `practice:${courseId}/${lessonId}/${exercise.id}`,
      { stdin: "" },
    );
    setPracticeValidation(null);
    setPracticeTestReport(null);
    setPracticeSaveError(null);
    if (trackEditorTransition) {
      contentCommitTicketRef.current += 1;
      setPracticeContentCommit({
        ticket: contentCommitTicketRef.current,
        path: activePath,
        content: files[activePath] ?? "",
      });
    }
  }, [lesson, courseId, lessonId]);

  const settlePracticeContent = useCallback((ticket: number, matched: boolean) => {
    if (practiceContentCommit?.ticket !== ticket) return;
    setPracticeContentCommit(null);
    setPracticeTransitioning(false);
    setPracticeTransitionError(
      matched
        ? null
        : "The editor did not finish opening this challenge. Return to the lesson and try Practice again.",
    );
  }, [practiceContentCommit]);

  const handlePracticeHintReveal = useCallback(() => {
    const exercise = lesson?.practiceExercises?.[practiceIndex];
    if (!exercise || !courseId || !lessonId) return;
    const current = useProgressStore.getState().lessonProgress[`${courseId}/${lessonId}`];
    const evidence = practiceEvidence.current.get(exercise.id) ?? {
      startedAt: Date.now(),
      attemptCount: 0,
      startingTutorHintCount: current?.hintCount ?? 0,
      authoredHintCount: 0,
    };
    evidence.authoredHintCount = Math.min(100, evidence.authoredHintCount + 1);
    practiceEvidence.current.set(exercise.id, evidence);
  }, [lesson, practiceIndex, courseId, lessonId]);

  const handleEnterPractice = useCallback(() => {
    if (!lesson?.practiceExercises?.length) return;
    // Lesson 1 practice is part of the signed-out promise. The validator and
    // runner already keep anonymous work on their anonymous endpoints, so
    // both the completion CTA and the persistent Practice chip may enter the
    // same local practice state without creating an account.
    const current = courseId && lessonId
      ? useProgressStore.getState().lessonProgress[`${courseId}/${lessonId}`]
      : null;
    const completed = new Set(
      learnerId === null
        ? localPracticeCompletedIdsRef.current
        : current?.practiceCompletedIds ?? [],
    );
    const resumeIndex = lesson.practiceExercises.findIndex((exercise) => !completed.has(exercise.id));
    const targetIndex = resumeIndex >= 0 ? resumeIndex : 0;
    flushSync(() => {
      applyPracticeStarter(targetIndex);
      setPracticeIndex(targetIndex);
      setPracticeMode(true);
      setShowComplete(false);
      setCompletionPresentationPending(false);
    });
  }, [lesson, courseId, lessonId, learnerId, applyPracticeStarter]);

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
    // Clear the route intent in the same action as the UI state. Otherwise an
    // immediate exit can race the initial ?mode=practice auto-entry effect and
    // make the prominent Back to lesson control appear to do nothing.
    flushSync(() => {
      setPracticeMode(false);
      setPracticeValidation(null);
      setPracticeTestReport(null);
      setPracticeTransitioning(false);
      setPracticeTransitionError(null);
      setPracticeContentCommit(null);
    });
    setSearchParams({}, { replace: true });
    const lessonContext = lessonWorkspaceContextKey(mode, courseId, lessonId);
    if (lessonContext) {
      useProjectStore.getState().switchProjectContext(lessonContext);
      useRunStore.getState().switchRunContext(lessonContext);
    }
    if (learnerId === null) {
      // React state intentionally lags this click by one render after a
      // successful anonymous check. Persist from the synchronous ref at the
      // exit boundary so an immediate reload cannot lose the earned exercise.
      onAnonProgressCommitted?.({
        completed: localLessonCompleted,
        practiceCompletedIds: localPracticeCompletedIdsRef.current,
      });
    }
    savedLessonCode.current = null;
  }, [
    courseId,
    lessonId,
    learnerId,
    localLessonCompleted,
    mode,
    onAnonProgressCommitted,
    savedLessonCode,
    setSearchParams,
  ]);

  const handleSelectPracticeExercise = useCallback(
    (index: number) => {
      // Project state lives in Zustand while the selected instructions live
      // in React. Flush them as one transition so no frame can pair the next
      // challenge's prose with the previous challenge's editable buffer.
      flushSync(() => {
        applyPracticeStarter(index);
        setPracticeIndex(index);
      });
    },
    [applyPracticeStarter],
  );

  const handleNextPracticeExercise = useCallback(() => {
    if (!lesson?.practiceExercises) return;
    const next = practiceIndex + 1;
    if (next >= lesson.practiceExercises.length) return;
    flushSync(() => {
      applyPracticeStarter(next);
      setPracticeIndex(next);
    });
  }, [lesson, practiceIndex, applyPracticeStarter]);

  const handleResetPracticeProgress = useCallback(async () => {
    if (!courseId || !lessonId) return false;
    setPracticeSaveError(null);
    if (learnerId === null) {
      localPracticeCompletedIdsRef.current = [];
      setLocalPracticeCompletedIds([]);
      practiceEvidence.current.clear();
      setPracticeValidation(null);
      applyPracticeStarter(practiceIndex, true);
      onAnonProgressCommitted?.({
        completed: localLessonCompleted,
        practiceCompletedIds: [],
      });
      return true;
    }
    try {
      await resetPracticeProgress(courseId, lessonId);
      practiceEvidence.current.clear();
      setPracticeValidation(null);
      applyPracticeStarter(practiceIndex, true);
      return true;
    } catch (cause) {
      setPracticeSaveError(
        cause instanceof Error ? cause.message : "Could not reset practice progress.",
      );
      return false;
    }
  }, [
    courseId,
    lessonId,
    learnerId,
    localLessonCompleted,
    onAnonProgressCommitted,
    resetPracticeProgress,
    practiceIndex,
    applyPracticeStarter,
  ]);

  const resetFilesForCurrentTask = useCallback(() => {
    if (!lesson || !courseId || !lessonId) return;
    if (practiceMode) {
      const exercise = lesson.practiceExercises?.[practiceIndex];
      if (!exercise) return;
      const entry = LANGUAGE_ENTRYPOINT[lesson.language];
      const files = {
        [entry]: exercise.starterCode ?? "# Write your code here\n",
      };
      return { files, order: [entry], activeFile: entry, openTabs: [entry] };
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
    return {
      files,
      order,
      activeFile: order[0] ?? null,
      openTabs: order[0] ? [order[0]] : [],
    };
  }, [lesson, courseId, lessonId, practiceMode, practiceIndex]);

  const handleReset = useCallback(() => {
    if (resetInteractionRef?.current) return;
    const starter = resetFilesForCurrentTask();
    if (!starter) return;
    const project = useProjectStore.getState();
    const alreadyStarter =
      JSON.stringify(project.files) === JSON.stringify(starter.files);
    if (alreadyStarter) return;
    const key = courseId && lessonId ? `${courseId}/${lessonId}` : null;
    if (key && useProgressStore.getState().draftConflicts[key]) {
      setResetCodeError(
        "Choose which saved version to keep before resetting this code.",
      );
      setConfirmResetCode(true);
      return;
    }
    setResetCodeError(null);
    setConfirmResetCode(true);
  }, [resetFilesForCurrentTask, courseId, lessonId, resetInteractionRef]);

  const confirmCodeReset = useCallback(() => {
    if (resetInteractionRef?.current) return;
    const starter = resetFilesForCurrentTask();
    if (!starter || !courseId || !lessonId) return;
    if (useProgressStore.getState().draftConflicts[`${courseId}/${lessonId}`]) {
      setResetCodeError(
        "Choose which saved version to keep before resetting this code.",
      );
      return;
    }
    const project = useProjectStore.getState();
    const run = useRunStore.getState();
    const tutor = useAIStore.getState();
    const undoSnapshot: ResetUndoSnapshot = {
      files: { ...project.files },
      order: [...project.order],
      activeFile: project.activeFile,
      openTabs: [...project.openTabs],
      result: run.result,
      error: run.error,
      stdin: run.stdin,
      validation,
      practiceValidation,
      hadRun: run.result !== null || run.error !== null,
      tutor: {
        history: [...tutor.history],
        conversationSummary: tutor.conversationSummary,
        summarizedThrough: tutor.summarizedThrough,
        sessionUsage: { ...tutor.sessionUsage },
        tutorProgressToken: tutor.tutorProgressToken,
        lastTurnFiles: tutor.lastTurnFiles ? { ...tutor.lastTurnFiles } : null,
        runsSinceLastTurn: tutor.runsSinceLastTurn,
        editsSinceLastTurn: tutor.editsSinceLastTurn,
      },
    };
    pendingResetUndoRef.current = undoSnapshot;
    setResetUndo(null);
    setResettingCode(true);
    if (resetInteractionRef) resetInteractionRef.current = true;
    if (practiceMode) {
      // confirmCodeReset owns the commit handshake below. Starting a second
      // practice handshake here would leave one request permanently pending.
      applyPracticeStarter(practiceIndex, true, false);
      const exercise = lesson?.practiceExercises?.[practiceIndex];
      if (exercise) {
        savePracticeCode(courseId, lessonId, exercise.id, starter.files);
      }
    } else {
      useProjectStore.getState().replaceProject(starter);
      void saveCode(courseId, lessonId, starter.files);
    }
    const activePath = starter.activeFile ?? starter.order[0] ?? null;
    if (activePath) {
      contentCommitTicketRef.current += 1;
      setResetContentCommit({
        ticket: contentCommitTicketRef.current,
        path: activePath,
        content: starter.files[activePath] ?? "",
      });
    } else {
      pendingResetUndoRef.current = null;
      setResettingCode(false);
      if (resetInteractionRef) resetInteractionRef.current = false;
      setResetCodeError("The starter could not be opened. Your previous code is still available through browser history.");
    }
    useRunStore.getState().invalidateEvidence();
    useAIStore.getState().clearConversation();
    setValidation(null);
    setPracticeValidation(null);
    setPracticeSaveError(null);
    setShowComplete(false);
    setHasChecked(false);
    setConfirmResetCode(false);
    if (activePath) setResetCodeError(null);
    onResetRunnerFlags?.();
  }, [resetFilesForCurrentTask, resetInteractionRef, courseId, lessonId, validation, practiceValidation, practiceMode, practiceIndex, lesson, applyPracticeStarter, savePracticeCode, saveCode, onResetRunnerFlags]);

  const restoreResetSnapshot = useCallback((snapshot: ResetUndoSnapshot) => {
    useProjectStore.getState().replaceProject({
      files: snapshot.files,
      order: snapshot.order,
      activeFile: snapshot.activeFile,
      openTabs: snapshot.openTabs,
    });
    useRunStore.setState({
      running: false,
      activeRunId: null,
      result: snapshot.result,
      error: snapshot.error,
      stdin: snapshot.stdin,
    });
    setValidation(snapshot.validation);
    setPracticeValidation(snapshot.practiceValidation);
    setHasChecked(Boolean(snapshot.validation || snapshot.practiceValidation));
    useAIStore.setState({
      history: snapshot.tutor.history,
      asking: false,
      askError: null,
      pending: null,
      pendingScripted: false,
      pendingAsk: null,
      conversationSummary: snapshot.tutor.conversationSummary,
      summarizedThrough: snapshot.tutor.summarizedThrough,
      summarizing: false,
      activeSelection: null,
      sessionUsage: snapshot.tutor.sessionUsage,
      tutorProgressToken: snapshot.tutor.tutorProgressToken,
      lastTurnFiles: snapshot.tutor.lastTurnFiles,
      runsSinceLastTurn: snapshot.tutor.runsSinceLastTurn,
      editsSinceLastTurn: snapshot.tutor.editsSinceLastTurn,
    });
    if (practiceMode) {
      const exercise = lesson?.practiceExercises?.[practiceIndex];
      if (exercise && courseId && lessonId) {
        savePracticeCode(courseId, lessonId, exercise.id, snapshot.files);
      }
    } else if (courseId && lessonId) {
      void saveCode(courseId, lessonId, snapshot.files);
    }
    onRestoreRunnerFlags?.(snapshot.hadRun);
  }, [practiceMode, practiceIndex, lesson, courseId, lessonId, savePracticeCode, saveCode, onRestoreRunnerFlags]);

  const settleCodeResetContent = useCallback((ticket: number, matched: boolean) => {
    if (resetContentCommit?.ticket !== ticket) return;
    const undoSnapshot = pendingResetUndoRef.current;
    pendingResetUndoRef.current = null;
    setResetContentCommit(null);
    setResettingCode(false);
    if (resetInteractionRef) resetInteractionRef.current = false;
    if (!matched || !undoSnapshot) {
      if (undoSnapshot) restoreResetSnapshot(undoSnapshot);
      setResetCodeError(
        "The editor did not finish restoring the starter, so your previous code was restored. Try Reset again.",
      );
      return;
    }
    resetUndoRevisionRef.current = useProjectStore.getState().revision;
    setResetUndo(undoSnapshot);
    setResetCodeError(null);
  }, [resetContentCommit, resetInteractionRef, restoreResetSnapshot]);

  const undoCodeReset = useCallback(() => {
    if (!resetUndo || !courseId || !lessonId) return;
    resetUndoRevisionRef.current = null;
    restoreResetSnapshot(resetUndo);
    setResetUndo(null);
  }, [resetUndo, courseId, lessonId, restoreResetSnapshot]);

  const restoreCompleted = useCallback(() => {
    setLocalLessonCompleted(true);
    setValidation({
      passed: true,
      passedExceptRetrieval: true,
      feedback: ["Completed in this browser session."],
    });
    setHasChecked(true);
    setShowComplete(false);
  }, []);

  const restoreAnonPracticeCompleted = useCallback((ids: string[]) => {
    const safe = [...new Set(ids.filter((id) => typeof id === "string"))];
    localPracticeCompletedIdsRef.current = safe;
    setLocalPracticeCompletedIds(safe);
  }, []);

  const handleResetLessonProgress = useCallback(async () => {
    if (!lesson || !courseId || !lessonId) return;
    setResetLessonError(null);
    setResettingLesson(true);
    try {
      // The destructive server delete must finish before the editor is
      // cleared or a replacement in-progress row is started. This keeps a
      // failed/offline reset recoverable and removes the old DELETE/PATCH race.
      if (learnerId !== null) {
        await resetLessonProgress(learnerId, courseId, lessonId);
      }
    } catch (cause) {
      setResetLessonError(
        cause instanceof Error ? cause.message : "Could not reset this lesson.",
      );
      setResettingLesson(false);
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
    setLocalLessonCompleted(false);
    localPracticeCompletedIdsRef.current = [];
    setLocalPracticeCompletedIds([]);
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
    } else {
      onAnonProgressCommitted?.({
        completed: false,
        practiceCompletedIds: [],
      });
    }
    setResettingLesson(false);
  }, [
    lesson,
    courseId,
    lessonId,
    learnerId,
    onAnonProgressCommitted,
    resetLessonProgress,
    startLesson,
    onResetRunnerFlags,
  ]);

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
    localLessonCompleted,
    localPracticeCompletedIds,
    completionSaving,
    completionSaveError,
    practiceValidation,
    practiceSaveError,
    practiceSaving,
    practiceRetryAt,
    showComplete,
    completionPresentationPending,
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
    resettingLesson,
    resetLessonError,
    confirmResetCode,
    setConfirmResetCode,
    resetCodeError,
    resetUndo,
    setResetUndo,
    resettingCode,
    resetContentCommit,
    functionTests,
    sourceChecks,
    passedVisibleTests,
    practiceTestReport,
    practiceTransitioning,
    practiceTransitionError,
    practiceContentCommit,
    handleCheck,
    handleRunExamples,
    handleReset,
    confirmCodeReset,
    settleCodeResetContent,
    settlePracticeContent,
    undoCodeReset,
    restoreCompleted,
    restoreAnonPracticeCompleted,
    handleResetLessonProgress,
    handleEnterPractice,
    handleExitPractice,
    handleSelectPracticeExercise,
    handleNextPracticeExercise,
    handleResetPracticeProgress,
    handlePracticeHintReveal,
    handleAskTutorAboutFailure,
  };
}
