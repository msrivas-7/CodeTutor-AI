import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
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
import { useRunStore } from "../../../state/runStore";
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
import { FirstRunHandoffReveal } from "../../firstRun/FirstRunHandoffReveal";
import { StreakChip } from "../components/StreakChip";
import { FirstSuccessReveal } from "../components/FirstSuccessReveal";
import { motion } from "framer-motion";
import { MATERIAL_EASE, CINEMA_DURATIONS } from "../../../components/cinema/easing";
import { ShareDialog } from "../../share/components/ShareDialog";
import { LANGUAGE_ENTRYPOINT } from "../../../types";
import { api } from "../../../api/client";

/**
 * Phase 27-v2.1 — LessonPage now accepts an optional `mode` prop so the
 * SAME component serves both the authed `/learn/...` route AND the
 * anon `/try/lesson/...` flow (via AnonLessonPage as a thin wrapper).
 *
 * `mode` defaults to "authed" — every existing call site (the React
 * Router lazy import) renders unchanged behavior. The wrapper passes
 * "anon" to swap a tightly-enumerated set of behaviors:
 *   - API endpoints (Run + AI tutor → /api/anon/* variants)
 *   - Session lifecycle (anon skips /api/session entirely)
 *   - Save click → SignupWallDialog instead of PATCH
 *   - LessonCompletePanel "Next lesson" → write stash + open wall
 *   - Header bar surface (anon badge instead of UserMenu/StreakChip)
 *   - All /api/user/* PATCHes (preferences, progress) become no-ops
 *
 * Below the header bar, the anon and authed paths render PIXEL-
 * IDENTICAL chrome — same instructions panel, editor, output panel,
 * tutor pane, hint button, completion panel, share dialog. The
 * "Pixel-equivalence Invariant" is the merge gate (see plan).
 *
 * `mode` is also the entry point that triggers the iris-reveal
 * match-cut on /try/: cinematic exit → cinematicExitingAt set →
 * LessonPage(mode="anon") reactive inHandoff fires → same 3.5s
 * "circle opening up" the authed /welcome flow gets via ?firstRun=1.
 */
interface LessonPageProps {
  /** Default "authed". Pass "anon" for the /try/ trial flow. */
  mode?: "authed" | "anon";
  /** Optional override for the courseId from URL params. Anon
   *  wrapper passes it explicitly; authed flow reads from URL. */
  courseId?: string;
  /** Same shape as courseId. */
  lessonId?: string;
}

export default function LessonPage({
  mode = "authed",
  courseId: courseIdProp,
  lessonId: lessonIdProp,
}: LessonPageProps = {}) {
  const params = useParams<{
    courseId: string;
    lessonId: string;
  }>();
  const courseId = courseIdProp ?? params.courseId;
  const lessonId = lessonIdProp ?? params.lessonId;
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

  // Cinema Kit Continuity Pass — match-cut handoff detection.
  // Phase 27-v2.1 made this REACTIVE (was: one-shot useState init).
  //
  // Authed path (route nav from /welcome → /learn/...?firstRun=1):
  //   CinematicGreeting.exit sets cinematicExitingAt BEFORE this
  //   LessonPage mounts. The useEffect below fires on mount, sees a
  //   value within the 1.5s freshness window, sets inHandoff=true,
  //   and the iris reveal renders the 3.5s "circle opening up" at
  //   the Run button. Identical to the v2 one-shot init behavior.
  //
  // Anon path (Phase 27-v2.1 — /try/lesson/python-fundamentals/...):
  //   AnonLessonPage mounts THIS LessonPage (mode="anon") UNDERNEATH
  //   the cinematic from the start. cinematicExitingAt is null when
  //   LessonPage first mounts — the one-shot init would never see
  //   the value and the iris reveal would never fire on /try/. The
  //   useEffect-based subscriber below catches the flag flip when
  //   the anon cinematic exits, sets inHandoff=true on the already-
  //   mounted LessonPage, and the iris reveal fires with the same
  //   3.5s "circle opening up" geometry the authed path gets.
  //
  // After the reveal completes (~3.65s), we clear the flag so a
  // normal lesson visit later doesn't re-trigger.
  // Initial inHandoff is captured at mount-time (matches v2 behavior
  // — the page-mount fade-up suppression at `initial={ inHandoff &&
  // (...) ? false : { opacity: 0, y: 8 } }` runs ONCE on first
  // render, so it must see the right value on render 1, before any
  // useEffect fires). For the authed path, cinematicExitingAt is
  // set BEFORE LessonPage mounts (route nav from /welcome), so the
  // initializer sees the value and inHandoff=true on render 1 —
  // identical to v2 behavior.
  const cinematicExitingAt = useFirstRunStore((s) => s.cinematicExitingAt);
  const [inHandoff, setInHandoff] = useState<boolean>(() => {
    const exitingAt = useFirstRunStore.getState().cinematicExitingAt;
    if (exitingAt === null) return false;
    return Date.now() - exitingAt < 1500;
  });
  // Reactive subscriber catches the case where cinematicExitingAt
  // flips AFTER LessonPage has mounted (Phase 27-v2.1 anon path: the
  // wrapper mounts LessonPage UNDERNEATH the cinematic; cinematic
  // exit fires the flag while LessonPage is already alive). Auto-
  // clears the flag and inHandoff state after the iris reveal's
  // full duration (3.5s reveal + 0.15s fade + safety margin).
  useEffect(() => {
    if (cinematicExitingAt === null) return;
    const ageMs = Date.now() - cinematicExitingAt;
    if (ageMs >= 1500) {
      // Stale flag (backgrounded tab, missed window). Clear and
      // skip — a normal lesson visit later mustn't re-trigger.
      useFirstRunStore.getState().clearCinematicExiting();
      return;
    }
    setInHandoff(true);
    const t = window.setTimeout(() => {
      setInHandoff(false);
      useFirstRunStore.getState().clearCinematicExiting();
    }, 4000);
    return () => window.clearTimeout(t);
  }, [cinematicExitingAt]);

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
    // Also clear the output panel so the scripted narration doesn't
    // start on top of a prior run's stdout/stderr. On a replay path
    // the runStore could still hold the previous run's output from
    // the learner's last time through — the cinematic promises a
    // fresh moment, so the panel should mirror that.
    useRunStore.setState({ result: null, error: null });
  }, [isFirstRun, courseId, lessonId, learnerId]);

  const loader = useLessonLoader({
    courseId,
    lessonId,
    learnerId,
    practiceMode,
    practiceIndex,
    // First-run cinematic relies on the authored starter code being
    // present verbatim (the scripted "replace YOUR_NAME with your
    // name" beat). Skip the resume-from-savedCode branch when
    // landing here via the cinematic hand-off.
    forceStarter: isFirstRun,
  });

  // Phase 21A: chat context key includes practice scope so lesson↔practice
  // toggles get distinct chat threads (the bleed bug). Each practice
  // exercise also gets its own context — matches the user's mental model
  // of "switching between practice exercises is like switching between
  // lessons." aiStore's switchChatContext does atomic save-then-restore
  // against the LRU cache, so toggling preserves both threads.
  const chatCtxKey = useMemo(() => {
    if (!courseId || !lessonId) return null;
    if (practiceMode) {
      const ex = loader.lesson?.practiceExercises?.[practiceIndex];
      // Fall through to lesson-view key while lesson loads or if the
      // index is somehow out of range — better than a flicker to a key
      // we'll immediately overwrite.
      if (!ex) return `lesson:${courseId}/${lessonId}`;
      return `practice:${courseId}/${lessonId}/${ex.id}`;
    }
    return `lesson:${courseId}/${lessonId}`;
  }, [courseId, lessonId, practiceMode, practiceIndex, loader.lesson?.practiceExercises]);

  const switchChatContext = useAIStore((s) => s.switchChatContext);
  useEffect(() => {
    if (chatCtxKey) switchChatContext(chatCtxKey);
  }, [chatCtxKey, switchChatContext]);

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

  // Run-success ring + Check sonar removed per user direction —
  // the lesson-complete celebration is the win moment; per-press
  // rings on those buttons were redundant. Run press feedback is
  // covered by `whileTap` on the button itself.

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
      firstRunStep === "correctEdit" ||
      firstRunStep === "praiseEditRun");
  const spotlightRun = isFirstRun && firstRunStep === "awaitRun";
  const spotlightCheck = isFirstRun && firstRunStep === "awaitCheck";
  // During awaitEdit the tutor just said "change one word and run
  // again." The editor is where the action happens — spotlight it
  // so the learner knows where to put their attention instead of
  // scanning the whole UI.
  const spotlightEditor = isFirstRun && firstRunStep === "awaitEdit";

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
      firstRunStep === "correctEdit" ||
      firstRunStep === "praiseEditRun");

  // Run + Check lock out so the learner can't skip ahead of the
  // scripted beats by mashing buttons before the tutor has asked.
  // Run is allowed during awaitRun (in case canRun never went true
  // and we fell back to user-driven mode) and awaitEdit (the tutor
  // explicitly asked them to run after editing). Check is allowed
  // only during awaitCheck — the final nudge before lesson pass.
  // Both unlock completely once the choreography reaches "done".
  const runButtonLocked =
    isFirstRun &&
    firstRunStep !== "idle" &&
    firstRunStep !== "awaitRun" &&
    firstRunStep !== "awaitEdit" &&
    firstRunStep !== "done";
  const checkButtonLocked =
    isFirstRun && firstRunStep !== "awaitCheck" && firstRunStep !== "done";
  // Hide "clear" entirely during the welcome sequence — a learner
  // who clears mid-narration wipes the scripted turns and breaks
  // the flow. After "done" the product is fully back to normal.
  const tutorClearHidden = isFirstRun && firstRunStep !== "done";

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

  // Phase 21C: ShareDialog mount state. Lifted here so the dialog can
  // close cleanly even after LessonCompletePanel dismisses, and so the
  // payload can be assembled from progress + course state in one place.
  const [shareOpen, setShareOpen] = useState(false);
  // Pre-fetch: when the lesson is completed AND has code to share,
  // ask the backend whether this user already published a share for
  // it. The chip flips from "Share" → "Shared ✓" so the user knows
  // their click reuses the existing share instead of minting a new
  // one. Lookup re-runs whenever the dialog closes after a fresh
  // create (so the chip reflects the new state without a reload).
  const [hasExistingShare, setHasExistingShare] = useState(false);
  const lpForShareCheck =
    courseId && lessonId
      ? lessonProgressMap[`${courseId}/${lessonId}`]
      : undefined;
  const shareCheckTrigger =
    courseId && lessonId && lpForShareCheck?.status === "completed"
      ? `${courseId}/${lessonId}`
      : null;
  useEffect(() => {
    if (!shareCheckTrigger) {
      setHasExistingShare(false);
      return;
    }
    // While the dialog is open we don't poll — let the dialog manage
    // its own create lifecycle and rely on the post-close re-fetch.
    if (shareOpen) return;
    let cancelled = false;
    const [c, l] = shareCheckTrigger.split("/");
    void (async () => {
      try {
        await api.getMyShareForLesson(c, l);
        if (!cancelled) setHasExistingShare(true);
      } catch {
        if (!cancelled) setHasExistingShare(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [shareCheckTrigger, shareOpen]);

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
    <motion.div
      className="flex h-full flex-col bg-bg text-ink"
      // Cinema Kit Continuity Pass — every lesson mount gets a soft
      // fade-up so navigating between lessons feels like arriving,
      // not snapping. 250 ms with HOUSE_EASE; suppressed during the
      // first-run handoff (the iris reveal handles that case at the
      // chrome layer with a different motion grammar). framer's
      // initial/animate only run on MOUNT — re-renders within a
      // mounted lesson don't re-fire.
      initial={
        inHandoff && (isFirstRun || mode === "anon")
          ? false
          : { opacity: 0, y: 8 }
      }
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
    >
      {/* Match-cut iris reveal. When the lesson mounts AS the
          cinematic exits, this component covers the chrome with an
          opaque bg-bg layer that has a transparent circular hole
          growing outward from the Run button. The visible ring at
          the hole's perimeter is the same shape language the
          learner saw at the end of the cinematic — one continuous
          outward motion across the route boundary. */}
      {/* Phase B — first-success reveal. Vignette pulse over the
          workspace when the learner's own code lands its first
          successful run. Reads in concert with the OutputPanel's
          hero RingPulse (scaled to 28) and the tutor's celebration
          message arriving DURING the typewriter completion (timed
          via POST_RUN_BEAT_MS in useFirstRunChoreography). */}
      <FirstSuccessReveal />
      {/* Iris reveal — Phase 27-v2.1: gate accepts mode === "anon"
          as implicit first-run, so /try/ users get the same 3.5s
          "circle opening up" the authed /welcome flow gets via
          ?firstRun=1. Without this, anon would dissolve the
          cinematic with a hard cut into the lesson chrome — the
          welcome-scene parity invariant would be broken. */}
      {inHandoff && (isFirstRun || mode === "anon") && (
        <FirstRunHandoffReveal runBtnRef={layout.runBtnRef} />
      )}
      <SkipToContent />
      <header className="relative z-30 flex items-center gap-3 border-b border-border bg-panel/80 px-4 py-2 backdrop-blur">
        <button
          onClick={() => nav(`/learn/course/${courseId}`)}
          className="rounded px-2 py-1 text-xs text-muted transition hover:bg-elevated hover:text-ink"
          aria-label="Back to course"
        >
          ← Back
        </button>
        <Wordmark size="sm" />
        <span className="h-4 w-px bg-border" aria-hidden="true" />
        {/* Phase B: lesson title hoisted to the instructions panel
            at Fraunces 28px. The header now carries only a thin
            breadcrumb — the lesson order — so the chrome doesn't
            compete with the panel for the user's attention. The
            full title still appears in the document title (set
            elsewhere) and the meta. */}
        {lesson ? (
          <span className="truncate text-[11px] text-muted">
            Lesson {lesson.order}
          </span>
        ) : (
          <span
            className="skeleton h-3 w-16 rounded"
            aria-label="Loading"
          />
        )}
        {/* Phase B: mode switcher (Editor | Learning) removed from
            chrome. Sitting persistently next to the lesson title, it
            reminded the learner on every render that there's a
            different place they could be — the product's identity
            confusion made structural. Editor mode is now reachable
            via the user menu and the StartPage tertiary affordance. */}

        {/* Phase 21B (iter-3): streak chip absolute-anchored to header
            center so it lands at the exact midpoint regardless of how
            wide the left or right content is. `pointer-events-none` on
            the wrapper keeps mouse events flowing to anything that may
            sit beneath; the chip itself (a button/status) re-enables
            them with `pointer-events-auto`. */}
        <div className="pointer-events-none absolute left-1/2 -translate-x-1/2">
          <div className="pointer-events-auto"><StreakChip /></div>
        </div>
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
                {/* Phase 21C: persistent share affordance. Once a lesson
                    is completed, the share moment shouldn't be a one-shot
                    of the post-completion panel — a learner returning a
                    week later should still be able to share their win.
                    Hidden when there's no code to share (e.g., progress
                    row exists but lastCode is empty), and during practice
                    mode (the chip group is for lesson-scoped state). */}
                {!practiceMode &&
                  lesson &&
                  lp.status === "completed" &&
                  !!lp.lastCode?.[LANGUAGE_ENTRYPOINT[lesson.language]]?.trim() && (
                    <button
                      onClick={() => setShareOpen(true)}
                      className={`border-l border-bg/40 px-2.5 py-0.5 text-[10px] font-semibold transition ${
                        hasExistingShare
                          ? "bg-success/15 text-success hover:bg-success/25"
                          : "bg-accent/15 text-accent hover:bg-accent/25"
                      }`}
                      title={
                        hasExistingShare
                          ? "Already shared — click to view or copy link"
                          : "Share this lesson"
                      }
                      aria-label={
                        hasExistingShare
                          ? "View existing share for this lesson"
                          : "Open share dialog for this lesson"
                      }
                    >
                      {hasExistingShare ? "Shared ✓" : "Share"}
                    </button>
                  )}
              </div>
            );
          })()}
          {/* Phase 21C UX audit: removed the top "Next →" chip. The
              LessonCompletePanel "Next Lesson →" CTA at the climactic
              moment is the contextually-earned one; on returning
              visits, the in-body Next button at the bottom of the
              page is far more discoverable than a 10px chip in a
              crowded toolbar. The de-clutter gives the persistent
              Share pill room to breathe in the chip group. */}
          {/* Phase B: chrome politeness during framed moments. While
              the first-run scripted choreography is in flight, the
              FeedbackButton dims to 30% and the UserMenu is hidden —
              the cinematic + iris + scripted tutor is the framed
              first-impression and full-product chrome arriving
              uninvited inside that frame breaks the spell. Both
              return on a 250ms fade-up at firstRunStep === "done". */}
          <motion.div
            animate={{
              opacity: isFirstRun && firstRunStep !== "done" ? 0.3 : 1,
            }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            style={{
              display: "inline-flex",
              pointerEvents:
                isFirstRun && firstRunStep !== "done" ? "none" : "auto",
            }}
          >
            <FeedbackButton />
          </motion.div>
          {(!isFirstRun || firstRunStep === "done") && (
            <motion.div
              initial={isFirstRun ? { opacity: 0, y: -4 } : false}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
              style={{ display: "inline-flex" }}
            >
              <UserMenu />
            </motion.div>
          )}
        </div>
      </header>

      <SessionErrorBanner />
      <SessionRestartBanner />
      <SessionReplacedModal />

      {loader.loading ? (
        // Phase B: lesson content is bundled client-side, so the
        // load is typically <100ms. The previous gray-rectangle
        // wireframe skeleton — three columns of bars — was the first
        // frame after the iris reveal opens, breaking the spell from
        // "hand-painted cinematic" straight to "this is software."
        // Replace with a simple centered loading state in the
        // cinematic's voice; the skeleton bars only show on
        // genuinely slow loads (the JSON is bundled, so this is
        // mostly catastrophic-only).
        <div
          className="flex min-h-0 flex-1 items-center justify-center"
          role="status"
          aria-live="polite"
          aria-label="Loading lesson"
        >
          <span className="sr-only">Loading…</span>
          <p className="font-display text-[15px] text-muted">
            Setting your stage…
          </p>
        </div>
      ) : lesson ? (
        <motion.main
          id="main-content"
          className="flex min-h-0 flex-1 overflow-hidden"
          // Phase B: workspace dims to 20% opacity when the
          // lesson-complete panel takes the stage. Pre-Phase B that
          // panel sat in a max-w-md Modal on top of full-bright
          // chrome; the climactic beat had to compete with the
          // editor + tutor + toolbar at full intensity. Now the
          // workspace recedes and the panel is the only thing
          // lit. 400 ms each way.
          animate={{ opacity: validator.showComplete ? 0.2 : 1 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}>
          {/* Instructions panel — collapsible. Cinema Kit Continuity
              Pass: same width-animation pattern as the tutor panel.
              Aside stays mounted always; framer animates width
              between 0 (collapsed) and layout.instrW (expanded)
              over 220 ms. Splitter only renders when expanded. The
              vertical strip-button shows only when collapsed. */}
          {layout.instrCollapsed && (
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
          )}
          <motion.div
            ref={layout.instrRef}
            initial={false}
            animate={{ width: layout.instrCollapsed ? 0 : layout.instrW }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="shrink-0 overflow-hidden border-r border-border"
            aria-hidden={layout.instrCollapsed ? "true" : undefined}
            // `inert` (in addition to aria-hidden) removes the
            // collapsed panel from tab order. aria-hidden alone hides
            // it from AT but doesn't skip keyboard focus, so users
            // can still tab into invisible buttons inside a width-0
            // panel. Cast through unknown for TS compat with
            // @types/react 18 (inert prop arrived in 19).
            {...((layout.instrCollapsed ? { inert: "" } : {}) as Record<string, unknown>)}
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
          </motion.div>
          {!layout.instrCollapsed && (
            <Splitter
              orientation="vertical"
              onDrag={(dx) =>
                layout.setInstrW((w) => clampSide(w + dx, LESSON_LAYOUT_BOUNDS.instr))
              }
              onDoubleClick={() => layout.setInstrW(LESSON_LAYOUT_DEFAULTS.instr)}
            />
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
            {/* Phase 22F2 prep: lock the tab strip in lesson mode — no
                X to close, no middle-click. A beginner accidentally
                closing helper.py and getting "ModuleNotFoundError" on
                Run is exactly the friction we want to remove. Reset Code
                button (below, next to Run) is the recovery path. */}
            <EditorTabs mode="lesson" />
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
                validation feedback. Phase 22F2 prep: Reset Code is now
                a top-level "↺ Reset" link next to Run (the recovery
                parachute should sit next to the cockpit, not buried in
                a menu). Reset LESSON (destructive — wipes progress)
                stays behind ⋯ so beginners can't trigger it accidentally. */}
            <div className="border-t border-border bg-panel/80">
              {/* Row 1 — Primary actions */}
              <div className="flex items-center gap-2 px-4 py-1.5">
                <span className="relative inline-flex">
                  {/* Phase B: dropped the press ring. The accent-color
                      ring on every click + the green ring on every
                      success was firing two concentric ripples on the
                      same anchor in <1 s after a successful run,
                      reading as a stutter. Reserve rings for OUTCOMES,
                      not inputs — `whileTap` already gives tactile
                      feedback for the press itself. */}
                  {/* Ring removed — the lesson-complete celebration
                      is the win moment; per-run rings on this button
                      were extra. */}
                  <motion.button
                    ref={layout.runBtnRef}
                    onClick={() => {
                      runner.handleRun();
                    }}
                    whileTap={{ scale: 0.96 }}
                    transition={{
                      duration: CINEMA_DURATIONS.tactileTap / 1000,
                      ease: MATERIAL_EASE,
                    }}
                    disabled={!runner.canRun || runButtonLocked}
                    className={`flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                      runner.canRun && !runButtonLocked
                        ? "bg-accent text-bg hover:bg-accent/90"
                        : "bg-elevated text-muted cursor-not-allowed"
                    }`}
                    title={
                      runButtonLocked
                        ? "The tutor will tell you when to run"
                        : runner.canRun
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
                  </motion.button>
                </span>
                {/* Phase 22F2 prep: quiet Reset link. Always visible
                    in lesson mode — when learner edits code into garbage
                    and Run fails, this is the one-click parachute back
                    to the starter. Muted styling so it doesn't compete
                    with Run / Check My Work. */}
                <button
                  type="button"
                  onClick={validator.handleReset}
                  disabled={runner.running}
                  title="Reset code to starter"
                  aria-label="Reset code to starter"
                  className="flex items-center gap-1 px-2 py-1.5 text-[11px] text-muted transition hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <span aria-hidden="true">↺</span>
                  Reset
                </button>
                <span className="relative inline-flex">
                  {/* Sonar ring removed — the lesson-complete
                      celebration is the win moment; the per-pass
                      sonar on this button was extra. */}
                  <button
                    ref={layout.checkBtnRef}
                    onClick={validator.handleCheck}
                    disabled={runner.running || validator.runningTests || checkButtonLocked}
                    className={`flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-violet ${
                      !runner.running && !validator.runningTests && !checkButtonLocked
                        ? "bg-violet/20 text-violet hover:bg-violet/30"
                        : "bg-elevated text-muted cursor-not-allowed"
                    }`}
                    title={
                      checkButtonLocked
                        ? "The tutor will tell you when to check"
                        : "Verify your solution against the lesson's checks"
                    }
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
                </span>
                {/* Reserve a fixed slot for the error-help CTA to avoid layout
                    shift when stderr toggles. Copy shifted from "Explain Error"
                    (diagnostic) to "What went wrong?" (a question a real tutor
                    would ask) — same handler, warmer framing. */}
                <div className="min-w-[160px]">
                  {runner.hasStderr && !runner.running && (
                    <button
                      onClick={runner.handleExplainError}
                      // Phase B: tone fix. Copy says "let me help" but
                      // the danger-tinted color said "alarm" — user
                      // read "What went wrong?" with red highlight
                      // and felt accused. Accent tint matches the
                      // calm-hand-on-shoulder intent of the copy.
                      className="flex items-center gap-1 rounded-lg bg-accent/15 px-3 py-1.5 text-[11px] font-medium text-accent ring-1 ring-accent/40 transition hover:bg-accent/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      title="Ask the tutor to explain this error"
                      aria-label="Ask the tutor what went wrong"
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
                      What went wrong?
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
                    //
                    // Phase 22F2 prep: Reset CODE moved out to a top-level
                    // link (next to Run). This menu is now destructive-only:
                    // Reset Lesson wipes ALL progress and lives behind a
                    // confirmation modal. Keeping it hidden in the ⋯ menu
                    // is intentional — beginners shouldn't discover it
                    // accidentally.
                    <div
                      role="menu"
                      className="absolute right-0 bottom-full z-40 mb-1 w-48 overflow-hidden rounded-lg border border-border bg-panel/95 p-1 shadow-xl backdrop-blur"
                    >
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
              {/* Row 3 — Stats strip. Ambient motivation
                  (time/attempts/runs/hints). Phase B: hidden until
                  the learner has done SOMETHING. Showing
                  "0m · 0 attempts · 0 runs · 0 hints" the moment a
                  lesson opens is the product surveiling the user
                  before they've started moving — Apple shows you the
                  activity ring at the END of the activity, not the
                  beginning. Once at least one run OR attempt lands,
                  the strip stays visible for the rest of the
                  session. */}
              {lp && (lp.runCount > 0 || lp.attemptCount > 0) && (
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

          {/* Guided tutor panel — collapsible + resizable.
              Cinema Kit Continuity Pass: aside stays mounted always
              and animates its width via framer-motion (0 when
              collapsed, layout.tutorW when expanded). Keeps
              GuidedTutorPanel state alive across collapse cycles
              (composer drafts, scroll position, message stream)
              and gives a smooth glide instead of a hard hide/show.
              The vertical splitter only renders when expanded —
              there's nothing to drag against when the panel is
              closed. The thin "Tutor" strip is a sibling that
              shows only when collapsed. */}
          {layout.tutorCollapsed && (
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
          )}
          {!layout.tutorCollapsed && (
            <Splitter
              orientation="vertical"
              onDrag={(dx) =>
                layout.setTutorW((w) => clampSide(w - dx, LESSON_LAYOUT_BOUNDS.tutor))
              }
              onDoubleClick={() => layout.setTutorW(LESSON_LAYOUT_DEFAULTS.tutor)}
            />
          )}
          <motion.aside
            ref={layout.tutorRef as React.RefObject<HTMLElement>}
            initial={false}
            animate={{ width: layout.tutorCollapsed ? 0 : layout.tutorW }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="min-h-0 shrink-0 overflow-hidden bg-panel"
            aria-hidden={layout.tutorCollapsed ? "true" : undefined}
            {...((layout.tutorCollapsed ? { inert: "" } : {}) as Record<string, unknown>)}
          >
            <GuidedTutorPanel
              lessonMeta={lesson}
              totalLessons={loader.totalLessons}
              priorConcepts={loader.priorConcepts}
              activePracticeExercise={
                practiceMode
                  ? lesson.practiceExercises?.[practiceIndex] ?? null
                  : null
              }
              progressSummary={
                lp
                  ? `attempt ${lp.attemptCount}, ${lp.runCount} runs, ${lp.hintCount} hints used`
                  : "first attempt"
              }
              onCollapse={() => layout.setTutorCollapsed(true)}
              onOpenSettings={() => layout.setShowSettings(true)}
              resetNonce={validator.resetNonce}
              inputLocked={tutorInputLocked}
              clearHidden={tutorClearHidden}
            />
          </motion.aside>
        </motion.main>
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
          onShare={
            // Only offer Share when we have a code snippet to attach.
            // Without an entry-point file in lp.lastCode there is no
            // artifact worth showing, so the button stays hidden.
            // Practice mode has its own scope/key — sharing a practice
            // exercise's code through this lesson dialog would mislabel
            // the artifact, so we hide the button there too.
            !practiceMode &&
            !!lp?.lastCode?.[LANGUAGE_ENTRYPOINT[lesson.language]]?.trim()
              ? () => setShareOpen(true)
              : undefined
          }
        />
      )}
      {/* Phase 21C: ShareDialog. Lives outside LessonCompletePanel so
          the dialog stays open even if the user dismisses the
          completion panel mid-share, and so its lifecycle is independent
          of the validator.showComplete state. */}
      {shareOpen && lesson && lp && (
        <ShareDialog
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          payload={{
            // Wire fields — these are what the server actually sees.
            // Title / order / total live ONLY in `preview` because the
            // backend looks them up canonically from the catalog.
            wire: {
              courseId,
              lessonId,
              mastery: computeMastery(lp, lesson)?.level ?? "okay",
              timeSpentMs: lp.timeSpentMs ?? 0,
              attemptCount: lp.attemptCount ?? 0,
              codeSnippet:
                lp.lastCode?.[LANGUAGE_ENTRYPOINT[lesson.language]] ?? "",
            },
            preview: {
              lessonTitle: lesson.title,
              lessonOrder: lesson.order,
              courseTitle: loader.courseTitle || courseId,
              courseTotalLessons: loader.totalLessons,
            },
            suggestedName: (() => {
              const n = resolveFirstName(user);
              return n && n !== "there" ? n : null;
            })(),
          }}
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
      <FirstRunSpotlight
        targetRef={layout.editorRef}
        active={spotlightEditor}
        size="large"
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
          <p className="mt-2 text-[11px] leading-relaxed text-faint">
            Your saved tutor messages stay.
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
    </motion.div>
  );
}
