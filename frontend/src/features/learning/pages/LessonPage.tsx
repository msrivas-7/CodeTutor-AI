import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { LessonInstructionsPanel } from "../components/LessonInstructionsPanel";
import { PracticeInstructionsView } from "../components/PracticeInstructionsView";
import { GuidedTutorPanel } from "../components/GuidedTutorPanel";
// P-H2: dynamic-import keeps Monaco out of the lesson page's initial JS until
// the editor mounts (the instructions/intro column loads first). The editor
// chunk is shared with EditorPage via Vite's default chunking.
const MonacoPane = lazy(() =>
  import("../../../components/MonacoPane").then((m) => ({ default: m.MonacoPane })),
);
import { EditorTabs } from "../../../components/EditorTabs";
import { OutputPanel } from "../../../components/OutputPanel";
import { Splitter } from "../../../components/Splitter";
import { SettingsModal } from "../../../components/SettingsModal";
import { UserMenu } from "../../../components/UserMenu";
import { FeedbackButton } from "../../../components/FeedbackButton";
import { Wordmark } from "../../../components/Wordmark";
import { SessionErrorBanner } from "../../../components/SessionErrorBanner";
import { SessionRestartBanner } from "../../../components/SessionRestartBanner";
import { SessionReplacedModal } from "../../../components/SessionReplacedModal";
import { NarrowViewportGate } from "../../../components/NarrowViewportGate";
import { SkipToContent } from "../../../components/SkipToContent";
import { Modal } from "../../../components/Modal";
import { LessonCompletePanel } from "../components/LessonCompletePanel";
import { WorkspaceCoach } from "../components/WorkspaceCoach";
import { useSessionLifecycle } from "../../../hooks/useSessionLifecycle";
import { useAuthStore } from "../../../auth/authStore";
import { useAIStore } from "../../../state/aiStore";
import { usePreferencesStore } from "../../../state/preferencesStore";
import { useProgressStore } from "../stores/progressStore";
import { pickFirstFailure } from "../utils/validator";
import { computeMastery, formatTimeSpent } from "../utils/mastery";
import { useShortcutLabels } from "../../../util/platform";
import { clamp, clampSide } from "../../../util/layoutPrefs";
import {
  LESSON_LAYOUT_BOUNDS,
  LESSON_LAYOUT_DEFAULTS,
  useLessonLayout,
} from "../hooks/useLessonLayout";
import { useLessonLoader } from "../hooks/useLessonLoader";
import { useLessonRunner } from "../hooks/useLessonRunner";
import { useLessonValidator } from "../hooks/useLessonValidator";
import { useFirstRunChoreography } from "../../firstRun/useFirstRunChoreography";
import { resolveFirstName } from "../../firstRun/resolveFirstName";
import { useFirstRunStore } from "../../firstRun/useFirstRunStore";
import { FirstRunSpotlight } from "../../firstRun/FirstRunSpotlight";

export default function LessonPage() {
  const { courseId, lessonId } = useParams<{
    courseId: string;
    lessonId: string;
  }>();
  const [searchParams] = useSearchParams();
  const nav = useNavigate();
  const user = useAuthStore((s) => s.user);
  const learnerId = user!.id;
  useSessionLifecycle();

  const lessonProgressMap = useProgressStore((s) => s.lessonProgress);
  const hasOpenaiKey = usePreferencesStore((s) => s.hasOpenaiKey);
  const workspaceCoachDone = usePreferencesStore((s) => s.workspaceCoachDone);
  const selectedModel = useAIStore((s) => s.selectedModel);
  const tutorConfigured = !!selectedModel && hasOpenaiKey;
  const keys = useShortcutLabels();

  // Practice-mode state sits at the page level so both the loader (for the
  // auto-save key) and the validator (for the check/run/enter-practice
  // flows) read one source of truth. The validator owns the handlers that
  // mutate it.
  const [practiceMode, setPracticeMode] = useState(false);
  const [practiceIndex, setPracticeIndex] = useState(0);
  const savedLessonCode = useRef<Record<string, string> | null>(null);

  const isFirstRun = searchParams.get("firstRun") === "1";

  // Lesson-progress reset on the first-run handoff. Parallel to
  // `forceStarter` for code: a replay user (already completed
  // hello-world) who rides the cinematic deserves the full lesson-
  // complete celebration at the end — confetti, "Next lesson" panel.
  // If we leave progress intact, the Check button still works but
  // the completion beat is muted (it already happened once). Wipe
  // once per mount so the pass event is a real first-time win.
  const firstRunResetRef = useRef(false);
  useEffect(() => {
    if (!isFirstRun || firstRunResetRef.current) return;
    if (!courseId || !lessonId || !learnerId) return;
    firstRunResetRef.current = true;
    useProgressStore
      .getState()
      .resetLessonProgress(learnerId, courseId, lessonId);
  }, [isFirstRun, courseId, lessonId, learnerId]);

  const loader = useLessonLoader({
    courseId,
    lessonId,
    learnerId,
    practiceMode,
    practiceIndex,
    // First-run cinematic relies on the authored starter code being
    // present verbatim (the scripted "change 'Hello, Python!' to
    // 'Hello, world!'" beat). Skip the resume-from-savedCode branch
    // when landing here via the cinematic hand-off.
    forceStarter: isFirstRun,
  });
  const layout = useLessonLayout({ lessonReady: !!loader.lesson && !loader.loading });
  const runner = useLessonRunner({
    lesson: loader.lesson,
    courseId,
    lessonId,
    practiceMode,
    initializedRef: loader.initializedForRef,
    tutorCollapsed: layout.tutorCollapsed,
    setTutorCollapsed: layout.setTutorCollapsed,
  });
  const validator = useLessonValidator({
    lesson: loader.lesson,
    courseId,
    lessonId,
    learnerId,
    totalLessons: loader.totalLessons,
    sessionId: runner.sessionId,
    sessionPhase: runner.sessionPhase,
    initializedRef: loader.initializedForRef,
    practiceMode,
    setPracticeMode,
    practiceIndex,
    setPracticeIndex,
    savedLessonCode,
    tutorCollapsed: layout.tutorCollapsed,
    setTutorCollapsed: layout.setTutorCollapsed,
    onResetRunnerFlags: () => {
      runner.setHasEdited(false);
      runner.setHasRun(false);
    },
  });

  // First-run scripted narration — runs when the learner lands on
  // hello-world with ?firstRun=1 from /welcome. The hook is a no-op
  // when enabled:false and cleans up on unmount. We resolve firstName
  // here so the hook doesn't re-read user.user_metadata shape.
  //
  // Gated on the URL param ALONE — not on welcomeDone. The previous
  // `!welcomeDone` guard created a race: FirstRunGreeting.handleComplete
  // flips welcomeDone=true optimistically BEFORE navigating to the
  // lesson URL, so by the time LessonPage mounted, welcomeDone was
  // already true and the hook short-circuited to disabled — the
  // scripted narration never fired. The URL param is only set by
  // FirstRunGreeting's own handoff, so keying off it is sufficient.
  //
  // Also gate on the WorkspaceCoach being complete AND off-screen:
  // brand-new users see the 6-step spotlight tour first (auto-opens
  // ~3s after lesson mounts). Firing scripted tutor turns in parallel
  // would double-narrate the same moment. The `!layout.showCoach`
  // check covers the live render-state (the coach is unmounted), and
  // `workspaceCoachDone` covers the "we've actually been through it"
  // assertion — without the persistent flag, the initial 3s window
  // before auto-open would falsely pass the gate.
  const firstRunStep = useFirstRunStore((s) => s.step);
  // Map the scripted-tutor step to the surface we want to spotlight.
  // The tutor panel gets the glow whenever the scripted turn is
  // streaming (user should follow the typing); the Run button gets
  // the glow right before auto-click; the Check button gets the glow
  // when we nudge the learner to validate.
  const spotlightTutor =
    isFirstRun &&
    (firstRunStep === "greet" ||
      firstRunStep === "celebrateRun" ||
      firstRunStep === "praiseEditRun");
  const spotlightRun = isFirstRun && firstRunStep === "awaitRun";
  const spotlightCheck = isFirstRun && firstRunStep === "awaitCheck";

  // Lock the tutor composer + hint / action chips while the scripted
  // choreography is mid-sentence. The last scripted message is
  // praiseEditRun; once the step transitions to awaitCheck (or later),
  // hand the panel back to the learner. "idle" also locks so the
  // moment between mount and the first `start()` tick doesn't let the
  // learner type into an empty panel before the greeting lands.
  const tutorInputLocked =
    isFirstRun &&
    (firstRunStep === "idle" ||
      firstRunStep === "greet" ||
      firstRunStep === "awaitRun" ||
      firstRunStep === "celebrateRun" ||
      firstRunStep === "awaitEdit" ||
      firstRunStep === "praiseEditRun");

  useFirstRunChoreography({
    enabled:
      isFirstRun && !layout.showCoach && workspaceCoachDone,
    firstName: resolveFirstName(user),
    runner: {
      canRun: runner.canRun,
      hasRun: runner.hasRun,
      hasEdited: runner.hasEdited,
      running: runner.running,
      handleRun: runner.handleRun,
    },
    validator: { validation: validator.validation ?? null },
  });

  if (!courseId || !lessonId) return null;

  const lesson = loader.lesson;
  const lp = lessonProgressMap[`${courseId}/${lessonId}`];

  const coachState = {
    hasEdited: runner.hasEdited,
    hasRun: runner.hasRun,
    hasError: runner.hasStderr,
    hasChecked: validator.hasChecked,
    checkPassed: !!validator.validation?.passed,
    failedCheckCount: validator.failedCheckCount,
    lessonComplete: lp?.status === "completed" || !!validator.validation?.passed,
    tutorConfigured,
    hasFunctionTests: validator.functionTests.length > 0,
    failedVisibleTests: validator.failedVisibleTests,
    failedHiddenTests: validator.failedHiddenTests,
    passedVisibleTests: validator.passedVisibleTests,
  };

  const nextLessonId = (() => {
    if (!lessonId || loader.lessonOrder.length === 0) return null;
    const idx = loader.lessonOrder.indexOf(lessonId);
    return idx >= 0 && idx < loader.lessonOrder.length - 1
      ? loader.lessonOrder[idx + 1]
      : null;
  })();
  const showNext =
    (validator.validation?.passed || lp?.status === "completed") && nextLessonId;

  return (
    <div className="flex h-full flex-col bg-bg text-ink">
      <SkipToContent />
      <header className="flex items-center gap-3 border-b border-border bg-panel/80 px-4 py-2 backdrop-blur">
        <button
          onClick={() => nav(`/learn/course/${courseId}`)}
          className="rounded px-2 py-1 text-xs text-muted transition hover:bg-elevated hover:text-ink"
          aria-label="Back to course"
        >
          ← Back
        </button>
        <Wordmark size="sm" />
        <span className="h-4 w-px bg-border" aria-hidden="true" />
        <h1
          className="truncate text-[14px] font-medium tracking-tight text-ink"
          title={lesson ? `Lesson ${lesson.order}: ${lesson.title}` : undefined}
        >
          Lesson {lesson?.order}: {lesson?.title ?? "Loading..."}
        </h1>
        <nav
          className="ml-2 flex shrink-0 items-center overflow-hidden rounded-md border border-border text-[11px]"
          aria-label="Mode switcher"
        >
          <button
            onClick={() => nav("/editor")}
            className="bg-transparent px-2.5 py-1 text-muted transition hover:bg-elevated hover:text-ink"
            title="Switch to free-form editor"
            aria-label="Switch to editor mode"
          >
            Editor
          </button>
          <span className="border-l border-border bg-violet/15 px-2.5 py-1 font-semibold text-violet">
            Learning
          </span>
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {runner.sessionPhase === "starting" && (
            <span className="flex items-center gap-1 text-[10px] text-muted">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-muted" />
              Starting session…
            </span>
          )}
          {runner.sessionPhase === "reconnecting" && (
            <span className="text-[10px] text-yellow-300">Reconnecting…</span>
          )}
          {lp && (() => {
            const practiceTotal = lesson?.practiceExercises?.length ?? 0;
            const practiceDone =
              practiceTotal > 0
                ? (lp.practiceCompletedIds ?? []).filter((id) =>
                    lesson!.practiceExercises!.some((e) => e.id === id),
                  ).length
                : 0;
            const practiceAllDone = practiceTotal > 0 && practiceDone === practiceTotal;
            return (
              <div className="flex items-center overflow-hidden rounded-full">
                <span
                  className={`px-2.5 py-0.5 text-[10px] font-medium ${
                    lp.status === "completed"
                      ? "bg-success/20 text-success"
                      : lp.status === "in_progress"
                        ? "bg-accent/20 text-accent"
                        : "bg-elevated text-muted"
                  }`}
                >
                  {lp.status === "completed"
                    ? "✓ Completed"
                    : lp.status === "in_progress"
                      ? "In progress"
                      : "Not started"}
                </span>
                {!practiceMode &&
                  practiceTotal > 0 &&
                  lp.status === "completed" && (
                    <button
                      onClick={validator.handleEnterPractice}
                      className={`border-l border-bg/40 px-2.5 py-0.5 text-[10px] font-semibold transition ${
                        practiceAllDone
                          ? "bg-success/20 text-success hover:bg-success/30"
                          : "bg-violet/20 text-violet hover:bg-violet/30"
                      }`}
                      title={
                        practiceAllDone
                          ? "Replay practice"
                          : "Practice this lesson's concepts"
                      }
                      aria-label={
                        practiceAllDone
                          ? "Replay practice, all exercises complete"
                          : `Practice ${practiceDone} of ${practiceTotal}`
                      }
                    >
                      {practiceAllDone
                        ? `✓ Practice ${practiceDone}/${practiceTotal}`
                        : `Practice ${practiceDone}/${practiceTotal}`}
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
      <SessionReplacedModal />

      {loader.loading ? (
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
        <main id="main-content" className="flex min-h-0 flex-1 overflow-hidden">
          {/* Instructions panel — collapsible */}
          {layout.instrCollapsed ? (
            <button
              onClick={() => layout.setInstrCollapsed(false)}
              title="Show instructions"
              aria-label="Show instructions panel"
              className="flex w-6 shrink-0 flex-col items-center justify-start gap-2 border-r border-border bg-panel pt-3 text-muted transition hover:bg-elevated hover:text-ink"
            >
              <span className="text-[12px]" aria-hidden="true">▸</span>
              <span
                className="text-[10px] font-semibold uppercase tracking-wider"
                style={{ writingMode: "vertical-rl" }}
              >
                Instructions
              </span>
            </button>
          ) : (
            <>
              <div
                ref={layout.instrRef}
                style={{ width: layout.instrW }}
                className="shrink-0 overflow-hidden border-r border-border"
              >
                {practiceMode && lesson.practiceExercises ? (
                  <PracticeInstructionsView
                    exercises={lesson.practiceExercises}
                    currentIndex={practiceIndex}
                    completedIds={lp?.practiceCompletedIds ?? []}
                    validation={validator.practiceValidation}
                    onSelectExercise={validator.handleSelectPracticeExercise}
                    onExitPractice={validator.handleExitPractice}
                    onNextExercise={validator.handleNextPracticeExercise}
                    onResetPractice={validator.handleResetPracticeProgress}
                    onCollapse={() => layout.setInstrCollapsed(true)}
                  />
                ) : (
                  <LessonInstructionsPanel
                    meta={lesson}
                    content={lesson.content}
                    onCollapse={() => layout.setInstrCollapsed(true)}
                    coachState={coachState}
                    functionTests={validator.functionTests}
                    testReport={validator.testReport}
                    runningTests={validator.runningTests}
                    onRunExamples={
                      validator.functionTests.length > 0
                        ? validator.handleRunExamples
                        : undefined
                    }
                    checkFailure={
                      validator.hasChecked && !validator.validation?.passed
                        ? pickFirstFailure(validator.testReport)
                        : null
                    }
                    checkFailureStreak={validator.sameFailStreak}
                    onAskTutorAboutFailure={validator.handleAskTutorAboutFailure}
                  />
                )}
              </div>
              <Splitter
                orientation="vertical"
                onDrag={(dx) =>
                  layout.setInstrW((w) => clampSide(w + dx, LESSON_LAYOUT_BOUNDS.instr))
                }
                onDoubleClick={() => layout.setInstrW(LESSON_LAYOUT_DEFAULTS.instr)}
              />
            </>
          )}

          {/* Editor + Output */}
          <section
            ref={layout.editorRef as React.RefObject<HTMLElement>}
            className="flex min-w-0 flex-1 flex-col"
          >
            {loader.resumed && (
              <div className="flex items-center gap-2 border-b border-accent/20 bg-accent/5 px-3 py-1.5 text-[11px] text-accent">
                <svg
                  className="h-3 w-3"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="1 4 1 10 7 10" />
                  <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                </svg>
                Your code was restored — resuming where you left off
              </div>
            )}
            <EditorTabs />
            <div className="min-h-0 flex-1">
              <Suspense fallback={<div className="p-4 text-sm text-muted">Loading editor…</div>}>
                <MonacoPane />
              </Suspense>
            </div>
            <Splitter
              orientation="horizontal"
              onDrag={(dy) =>
                layout.setOutputH((h) => clamp(h - dy, LESSON_LAYOUT_BOUNDS.out))
              }
              onDoubleClick={() => layout.setOutputH(LESSON_LAYOUT_DEFAULTS.out)}
            />
            <div
              ref={layout.outputRef}
              style={{ height: layout.outputH }}
              className="min-h-0 shrink-0"
            >
              <OutputPanel />
            </div>

            {/* Run toolbar — 2 rows: primary actions (+ overflow menu),
                validation feedback. Secondary actions (Reset Code / Reset
                Lesson) + stats are tucked behind ⋯ so the toolbar stays a
                single visual strip. */}
            <div className="border-t border-border bg-panel/80">
              {/* Row 1 — Primary actions */}
              <div className="flex items-center gap-2 px-4 py-1.5">
                <button
                  ref={layout.runBtnRef}
                  onClick={runner.handleRun}
                  disabled={!runner.canRun}
                  className={`flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                    runner.canRun
                      ? "bg-accent text-bg hover:bg-accent/90"
                      : "bg-elevated text-muted cursor-not-allowed"
                  }`}
                  title={
                    runner.canRun
                      ? `Run your code (${keys.run})`
                      : runner.sessionPhase !== "active"
                        ? "Waiting for session to start…"
                        : runner.running
                          ? "Already running…"
                          : "Run code"
                  }
                  aria-label={
                    runner.canRun
                      ? `Run code (${keys.runPhrase})`
                      : runner.sessionPhase !== "active"
                        ? "Run code — waiting for session"
                        : "Run code"
                  }
                >
                  {runner.running ? (
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
                  ref={layout.checkBtnRef}
                  onClick={validator.handleCheck}
                  disabled={runner.running || validator.runningTests}
                  className={`flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-violet ${
                    !runner.running && !validator.runningTests
                      ? "bg-violet/20 text-violet hover:bg-violet/30"
                      : "bg-elevated text-muted cursor-not-allowed"
                  }`}
                  title="Verify your solution against the lesson's checks"
                  aria-label="Check my work against lesson requirements"
                >
                  <svg
                    className="h-3 w-3"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="11" cy="11" r="7" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                  {validator.runningTests ? "Checking…" : "Check My Work"}
                </button>
                {/* Reserve a fixed slot for Explain Error to avoid layout shift when stderr toggles */}
                <div className="min-w-[128px]">
                  {runner.hasStderr && !runner.running && (
                    <button
                      onClick={runner.handleExplainError}
                      className="flex items-center gap-1 rounded-lg bg-danger/15 px-3 py-1.5 text-[11px] font-medium text-danger ring-1 ring-danger/40 transition hover:bg-danger/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-danger"
                      title="Ask the tutor to explain this error"
                      aria-label="Explain error with AI tutor"
                    >
                      <svg
                        className="h-3 w-3"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="8" x2="12" y2="12" />
                        <line x1="12" y1="16" x2="12.01" y2="16" />
                      </svg>
                      Explain Error
                    </button>
                  )}
                </div>
                {!runner.canRun && runner.sessionPhase !== "active" && (
                  <span className="text-[10px] italic text-faint">
                    Waiting for session…
                  </span>
                )}
                <div className="flex-1" />
                {practiceMode && (
                  <div className="flex items-center overflow-hidden rounded-full ring-1 ring-violet/30">
                    <span className="bg-violet/15 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-violet">
                      Practice Mode
                    </span>
                    <button
                      onClick={validator.handleExitPractice}
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
                    onClick={() =>
                      nav(`/learn/course/${courseId}/lesson/${nextLessonId}`)
                    }
                    className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-violet to-accent px-4 py-1.5 text-xs font-semibold text-bg shadow-glow transition hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet"
                    aria-label="Go to next lesson"
                  >
                    Next Lesson →
                  </button>
                )}
                <div ref={layout.resetMenuRef} className="relative">
                  <button
                    onClick={() => layout.setResetMenuOpen((v) => !v)}
                    aria-label="More lesson actions"
                    aria-haspopup="menu"
                    aria-expanded={layout.resetMenuOpen}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition hover:bg-elevated hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    title="More actions"
                  >
                    <svg
                      className="h-4 w-4"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      aria-hidden="true"
                    >
                      <circle cx="5" cy="12" r="1.6" />
                      <circle cx="12" cy="12" r="1.6" />
                      <circle cx="19" cy="12" r="1.6" />
                    </svg>
                  </button>
                  {layout.resetMenuOpen && (
                    // Opens UPWARD (bottom-full) — the kebab sits low in the
                    // viewport (between editor and output panel) so a downward
                    // dropdown falls off-screen.
                    <div
                      role="menu"
                      className="absolute right-0 bottom-full z-40 mb-1 w-48 overflow-hidden rounded-lg border border-border bg-panel/95 p-1 shadow-xl backdrop-blur"
                    >
                      <button
                        role="menuitem"
                        onClick={() => {
                          layout.setResetMenuOpen(false);
                          validator.handleReset();
                        }}
                        disabled={runner.running}
                        className="block w-full rounded-md px-3 py-1.5 text-left text-xs text-ink transition hover:bg-elevated disabled:cursor-not-allowed disabled:opacity-40"
                        title="Reset code to starter"
                      >
                        Reset Code
                      </button>
                      <div className="my-0.5 border-t border-border/50" />
                      <button
                        role="menuitem"
                        onClick={() => {
                          layout.setResetMenuOpen(false);
                          validator.setConfirmResetLesson(true);
                        }}
                        disabled={runner.running}
                        className="block w-full rounded-md px-3 py-1.5 text-left text-xs font-medium text-danger/80 transition hover:bg-danger/10 hover:text-danger disabled:cursor-not-allowed disabled:opacity-40"
                        title="Reset all lesson progress (attempts, runs, hints, code) — destructive"
                      >
                        Reset Lesson
                      </button>
                    </div>
                  )}
                </div>
              </div>
              {/* Row 2 — Validation feedback. For lessons WITH function_tests,
                  the FailedTestCallout in the instructions panel is the
                  authoritative fail surface (it auto-scrolls into view and
                  auto-switches to the Examples tab). Keeping the banner
                  there duplicated the message; hide it in that case. For
                  lessons without function_tests (e.g., expected_stdout
                  only), the banner is still the immediate fail signal, so
                  keep rendering it. Caps height so long hints can't push
                  the toolbar off-screen. */}
              {!practiceMode
                && validator.validation
                && !validator.validation.passed
                && validator.functionTests.length === 0 && (
                <div
                  role="alert"
                  className="mx-4 mt-1.5 flex max-h-24 flex-col gap-0.5 overflow-y-auto rounded-lg bg-danger/10 px-3 py-1.5 text-xs font-medium text-danger"
                >
                  <span>{validator.validation.feedback[0] ?? "Not quite."}</span>
                  {validator.validation.nextHints?.[0] && (
                    <span className="text-[11px] font-normal opacity-80">
                      {validator.validation.nextHints[0]}
                    </span>
                  )}
                </div>
              )}
              {/* Row 3 — Stats strip. Ambient motivation (time/attempts/runs/hints), always visible. No controls here — Resets live in Row 1's ⋯ menu. */}
              {lp && (
                <div className="flex items-center px-4 pb-1.5 pt-1">
                  <div className="flex-1" />
                  <span
                    className="text-[10px] text-faint"
                    title="Time is estimated from active tabs. Long idle periods and hidden tabs are excluded."
                  >
                    {formatTimeSpent(lp.timeSpentMs)} · {lp.attemptCount} attempts ·{" "}
                    {lp.runCount} runs · {lp.hintCount} hints
                  </span>
                </div>
              )}
            </div>
          </section>

          {/* Guided tutor panel — collapsible + resizable */}
          {layout.tutorCollapsed ? (
            <button
              onClick={() => layout.setTutorCollapsed(false)}
              title="Show tutor"
              aria-label="Show tutor panel"
              className="flex w-6 shrink-0 flex-col items-center justify-start gap-2 border-l border-border bg-panel pt-3 text-muted transition hover:bg-elevated hover:text-ink"
            >
              <span className="text-[12px]" aria-hidden="true">◂</span>
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
                onDrag={(dx) =>
                  layout.setTutorW((w) => clampSide(w - dx, LESSON_LAYOUT_BOUNDS.tutor))
                }
                onDoubleClick={() => layout.setTutorW(LESSON_LAYOUT_DEFAULTS.tutor)}
              />
              <aside
                ref={layout.tutorRef as React.RefObject<HTMLElement>}
                style={{ width: layout.tutorW }}
                className="min-h-0 shrink-0 overflow-hidden bg-panel"
              >
                <GuidedTutorPanel
                  lessonMeta={lesson}
                  totalLessons={loader.totalLessons}
                  priorConcepts={loader.priorConcepts}
                  progressSummary={
                    lp
                      ? `attempt ${lp.attemptCount}, ${lp.runCount} runs, ${lp.hintCount} hints used`
                      : "first attempt"
                  }
                  onCollapse={() => layout.setTutorCollapsed(true)}
                  onOpenSettings={() => layout.setShowSettings(true)}
                  resetNonce={validator.resetNonce}
                  inputLocked={tutorInputLocked}
                />
              </aside>
            </>
          )}
        </main>
      ) : loader.loadError?.kind === "schema_error" ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <div
            role="alert"
            className="max-w-xl rounded-lg border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-ink"
          >
            <p className="font-medium">This lesson's content file is malformed.</p>
            <p className="mt-1 text-muted">
              The lesson JSON parsed but did not match the schema. If you're an
              author, check the browser console for the exact fields that
              failed, then re-run <code className="font-mono">npm run lint:content</code>.
            </p>
            {import.meta.env.DEV && loader.loadError.issues.length > 0 && (
              <ul className="mt-2 list-disc pl-5 font-mono text-[11px] text-muted">
                {loader.loadError.issues.map((issue, i) => (
                  <li key={i}>{issue}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center text-sm text-muted">
          Lesson not found
        </div>
      )}

      {validator.showComplete && lesson && (
        <LessonCompletePanel
          lesson={lesson}
          completedPracticeIds={lp?.practiceCompletedIds ?? []}
          mastery={computeMastery(lp, lesson)?.level ?? null}
          timeSpentMs={lp?.timeSpentMs}
          onDismiss={() => validator.setShowComplete(false)}
          onNext={
            nextLessonId
              ? () => nav(`/learn/course/${courseId}/lesson/${nextLessonId}`)
              : undefined
          }
          onStartPractice={
            lesson.practiceExercises?.length
              ? () => {
                  validator.setShowComplete(false);
                  validator.handleEnterPractice();
                }
              : undefined
          }
        />
      )}
      {layout.showSettings && (
        <SettingsModal onClose={() => layout.setShowSettings(false)} />
      )}
      {layout.showCoach && (
        <WorkspaceCoach
          refs={{
            instructions: layout.instrRef.current,
            editor: layout.editorRef.current,
            runButton: layout.runBtnRef.current,
            outputPanel: layout.outputRef.current,
            checkButton: layout.checkBtnRef.current,
            tutorPanel: layout.tutorRef.current,
          }}
          onComplete={() => layout.setShowCoach(false)}
        />
      )}
      <FirstRunSpotlight
        targetRef={layout.tutorRef}
        active={spotlightTutor}
        size="large"
      />
      <FirstRunSpotlight
        targetRef={layout.runBtnRef}
        active={spotlightRun}
        size="small"
      />
      <FirstRunSpotlight
        targetRef={layout.checkBtnRef}
        active={spotlightCheck}
        size="small"
      />
      {validator.confirmResetLesson && (
        <Modal
          onClose={() => validator.setConfirmResetLesson(false)}
          role="alertdialog"
          labelledBy="reset-lesson-title"
          position="center"
          panelClassName="mx-4 w-full max-w-sm rounded-xl border border-danger/30 bg-panel p-5 shadow-xl"
        >
          <h2 id="reset-lesson-title" className="text-sm font-bold text-ink">
            Reset Lesson Progress?
          </h2>
          <p className="mt-2 text-xs leading-relaxed text-muted">
            This will clear all progress for this lesson — attempts, runs, hints,
            saved code, and completion status. You'll start fresh as if you've
            never opened this lesson.
          </p>
          <div className="mt-4 flex items-center gap-2">
            <button
              onClick={() => validator.setConfirmResetLesson(false)}
              className="flex-1 rounded-lg border border-border px-4 py-2 text-xs font-medium text-muted transition hover:bg-elevated hover:text-ink"
            >
              Cancel
            </button>
            <button
              onClick={validator.handleResetLessonProgress}
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
