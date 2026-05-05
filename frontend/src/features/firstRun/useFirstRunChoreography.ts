import { useCallback, useEffect, useRef } from "react";
import { useAIStore } from "../../state/aiStore";
import { useRunStore } from "../../state/runStore";
import { markFirstRunComplete } from "../../state/preferencesStore";
import { markChoreographyDoneAnon } from "../anon/anonStash";
import type { ValidationResult } from "../learning/types";
import { useFirstRunStore } from "./useFirstRunStore";
import {
  GREET,
  GREET_USER_DRIVEN,
  CELEBRATE_RUN,
  PRAISE_EDIT_RUN_AND_SEED,
  WRONG_EDIT_PLACEHOLDER,
  WRONG_EDIT_EMPTY,
  WRONG_EDIT_ERROR,
  WRONG_EDIT_GENERIC,
  STRONGER_HINT,
} from "./scriptedTurns";
import {
  pushScriptedAssistant,
  type ScriptedAssistantHandle,
} from "./pushScriptedAssistant";

// The first-run scripted tutor sequence, driven by an observable state
// machine on top of LessonPage's runner + validator. Mounted by
// LessonPage when `?firstRun=1` AND `welcomeDone === false`.
//
// The hook is self-contained — it owns its own generator loop and
// cleans up on unmount. Flow:
//
//   idle           (no-op)
//   greet          scripted turn: GREET(firstName) streams in
//   awaitRun       poll runner.canRun; when active, beat + auto-click
//                  OR fall back to user-driven if canRun stays false
//   celebrateRun   runner.hasRun becomes true → scripted CELEBRATE_RUN
//   awaitEdit      runner.hasEdited becomes true + validation passes
//   celebrateEdit  scripted CELEBRATE_EDIT_AND_SEED + seed the invite
//   seed           markOnboardingDone("welcomeDone"); step → done
//
// Cancellation paths:
//   * User types in the composer (hasEdited to tutor) → skip
//   * Error thrown anywhere → skip
//   * 5-minute idle-watchdog timeout (no step transition, no edit,
//     no run) → skip. Resets on any forward-progress signal so a
//     learner who reads the lesson slowly isn't punished.

interface UseFirstRunChoreographyArgs {
  enabled: boolean;
  firstName: string;
  runner: {
    canRun: boolean;
    hasRun: boolean;
    hasEdited: boolean;
    running: boolean;
    handleRun: () => void | Promise<void>;
  };
  validator: {
    validation: ValidationResult | null;
  };
  /**
   * Phase 27-v2 Day 3b: how the seed step persists "first-run is done."
   *
   *   "authed-mark-prefs" — default; calls markFirstRunComplete() which
   *     PATCHes /api/preferences. Used by the authed /welcome flow.
   *   "anon-stash" — caller (AnonLessonPage) handles persistence
   *     itself by writing the sessionStorage stash on the wall click.
   *     Choreography just transitions to "done" and exits cleanly.
   *     Required because the anon path has no req.userId for
   *     PATCH /api/preferences and the resolveAnonAICredential layer
   *     would 401 a first-run choreography PATCH that leaked over.
   *
   * Default keeps existing /welcome behavior unchanged.
   */
  onSeed?: "authed-mark-prefs" | "anon-stash";
  /**
   * Phase 27-v2 Day 3b option (d): on anon path, the praise turn
   * extracts the user's typed name from main.py at praise time and
   * personalizes the celebration ("Perfect, Maya — your computer
   * just said hi to you, by name."). Caller passes a getter that
   * reads the current code and returns the parsed name (or null if
   * the user kept YOUR_NAME or removed the assignment). Authed path
   * leaves this undefined; choreography uses the user_metadata
   * firstName like before.
   */
  resolvePraiseName?: () => string | null;
}

const GREET_TO_RUN_POLL_MS = 150;
const CANRUN_TIMEOUT_MS = 5_000;
// Breathing beat between the LessonPage mounting and the scripted
// tutor starting to type. Prevents the greeting from racing the
// lesson chrome as it lays out — learner sees the page settle first,
// then the tutor begins speaking.
const PRE_GREET_BEAT_MS = 1_000;
// Pause after the greeting finishes typing before auto-clicking Run.
// Lets "Let me run it for you — watch the bottom" actually land
// with the learner's eye before the output panel starts animating.
const POST_GREET_BEAT_MS = 1_000;
// Pause after the Run output lands before the celebrateRun message
// starts typing. Gives the learner a beat to read `Hello, YOUR_NAME!`
// in the output panel before the tutor speaks again.
const POST_RUN_BEAT_MS = 2_000;
// Phase 27-v2.2 post-Fix-7 user-bug fix — idle watchdog (was wall-clock).
// Originally a hard 5-min cap from mount: catch a wedge that left
// the choreography unable to advance. Field bug: Maya read the lesson
// for 5 min before her first edit and the watchdog fired
// silently, leaving the scripted tutor frozen mid-flow with no way to
// recover. Convert to an idle watchdog — reset on any forward-progress
// signal (step transition, runner.hasEdited, runner.hasRun). 5 min of
// TRUE inactivity (no typing, no run, no step advance) still
// auto-skips, which is the wedge-detection behavior we wanted; an
// engaged-but-slow learner is no longer punished.
const WATCHDOG_IDLE_MS = 5 * 60 * 1000;

export function useFirstRunChoreography({
  enabled,
  firstName,
  runner,
  validator,
  onSeed = "authed-mark-prefs",
  resolvePraiseName,
}: UseFirstRunChoreographyArgs): void {
  const step = useFirstRunStore((s) => s.step);
  const skipped = useFirstRunStore((s) => s.skipped);
  const start = useFirstRunStore((s) => s.start);
  const setStep = useFirstRunStore((s) => s.setStep);
  const skip = useFirstRunStore((s) => s.skip);
  const reset = useFirstRunStore((s) => s.reset);

  // Cache the latest runner/validator in refs so the async generator
  // doesn't re-fire on every prop change — we read through refs when
  // a step actually needs fresh state.
  const runnerRef = useRef(runner);
  runnerRef.current = runner;
  const validatorRef = useRef(validator);
  validatorRef.current = validator;

  const currentStreamRef = useRef<ScriptedAssistantHandle | null>(null);
  const idleWatchdogTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Phase 27-v2.1 audit pass 2 P1: every skip path (user-typed-mid-
  // walkthrough, 5-min wall-clock timeout, generator throw) must stamp
  // the per-mode "done" signal — otherwise a reload re-fires the
  // choreography from "greet" and clearConversation() wipes the
  // learner's tutor history. Mirror the natural-seed-step persistence
  // so skip and complete are symmetric. Authed: fire-and-forget the
  // server PATCH (await would block the user-typed-into-tutor handoff
  // by ~100ms which feels worse than missing the persist on skip,
  // and the PATCH catches up on next sign-in regardless). Anon:
  // synchronous sessionStorage write. Stable identity via useCallback
  // so it can sit in deps arrays without churning effects.
  const persistDoneOnSkip = useCallback(() => {
    if (onSeed === "anon-stash") {
      markChoreographyDoneAnon();
    } else {
      void markFirstRunComplete();
    }
  }, [onSeed]);

  // Cancel the current scripted stream if the user types a question.
  // Detection: `aiStore.history` gains a user-role message after the
  // scripted stream started.
  useEffect(() => {
    if (!enabled) return;
    const initialLen = useAIStore.getState().history.length;
    const unsub = useAIStore.subscribe((state, prev) => {
      if (!enabled) return;
      if (state.history.length <= prev.history.length) return;
      const newest = state.history[state.history.length - 1];
      if (newest?.role !== "user") return;
      if (state.history.length > initialLen) {
        // User has said something real — hand the tutor back to them.
        currentStreamRef.current?.cancel();
        persistDoneOnSkip();
        skip();
      }
    });
    return unsub;
  }, [enabled, skip, persistDoneOnSkip]);

  // Idle-watchdog reset. Stable identity so the activity-observer
  // effect below can sit in deps arrays without churning. Each call
  // arms a fresh 5-min timer; any activity signal calls it again,
  // pushing the deadline forward. The skip-on-fire branch matches
  // the rest of the skip paths (cancel current stream, persist
  // done-flag, set skipped=true).
  const armWatchdog = useCallback(() => {
    if (idleWatchdogTimerRef.current) clearTimeout(idleWatchdogTimerRef.current);
    idleWatchdogTimerRef.current = setTimeout(() => {
      currentStreamRef.current?.cancel();
      persistDoneOnSkip();
      skip();
    }, WATCHDOG_IDLE_MS);
  }, [persistDoneOnSkip, skip]);

  // Kick the whole thing off on mount.
  useEffect(() => {
    if (!enabled) return;
    // Guarantee a blank tutor panel every first-run mount, parallel to
    // `forceStarter` on the code side. A user who visited this lesson
    // before (or replayed the intro from Settings) could otherwise
    // land into a chat with existing history — the scripted greeting
    // would then render below prior Q&A, which breaks the "first
    // moment" framing the whole cinematic is built for.
    useAIStore.getState().clearConversation();
    start();
    armWatchdog();
    return () => {
      if (idleWatchdogTimerRef.current) clearTimeout(idleWatchdogTimerRef.current);
      currentStreamRef.current?.cancel();
      reset();
    };
  }, [enabled, start, reset, armWatchdog]);

  // Activity observer — any forward-progress signal resets the idle
  // watchdog. step covers scripted-tutor advances; runner.hasEdited
  // covers Maya typing in Monaco BEFORE her first run (the most common
  // "engaged-but-slow" path that the old wall-clock watchdog
  // miscounted as idle); runner.hasRun covers Maya clicking Run
  // (or the auto-click). Skipped/disabled exits short-circuit so a
  // post-skip transition doesn't re-arm the timer.
  useEffect(() => {
    if (!enabled || skipped) return;
    armWatchdog();
  }, [enabled, skipped, step, runner.hasEdited, runner.hasRun, armWatchdog]);

  // The step runner. Cleanly separated so each effect handles exactly
  // one transition and the dependencies only pull the pieces that
  // matter for that step.
  useEffect(() => {
    if (!enabled || skipped) return;

    let cancelled = false;
    const cancel = () => {
      cancelled = true;
      currentStreamRef.current?.cancel();
    };

    (async () => {
      try {
        if (step === "greet") {
          // Let the lesson page settle before the tutor speaks —
          // mounting chrome + panel resize + Monaco load all happen
          // in this window, and typing on top of layout shifts reads
          // as jitter. Doubles as the initial canRun poll window.
          await new Promise((r) => setTimeout(r, PRE_GREET_BEAT_MS));
          if (cancelled) return;
          // Keep polling canRun a little longer (total ~1.5s from
          // mount) so we can pick the "I'll press Run" vs "click when
          // ready" copy up front instead of switching mid-sentence.
          const extraCanRunWait = 500;
          const startedAt = Date.now();
          while (
            !runnerRef.current.canRun &&
            Date.now() - startedAt < extraCanRunWait
          ) {
            await new Promise((r) =>
              setTimeout(r, GREET_TO_RUN_POLL_MS),
            );
            if (cancelled) return;
          }
          const canRunAtGreet = runnerRef.current.canRun;
          const greetCopy = canRunAtGreet
            ? GREET(firstName)
            : GREET_USER_DRIVEN(firstName);
          const stream = pushScriptedAssistant(greetCopy);
          currentStreamRef.current = stream;
          await stream.done;
          if (cancelled) return;
          setStep("awaitRun");
          return;
        }

        if (step === "awaitRun") {
          // Poll canRun. If it flips true within our budget, auto-click.
          // Otherwise stay passive — the user will click when ready.
          const startedAt = Date.now();
          while (
            !runnerRef.current.canRun &&
            Date.now() - startedAt < CANRUN_TIMEOUT_MS
          ) {
            await new Promise((r) => setTimeout(r, GREET_TO_RUN_POLL_MS));
            if (cancelled) return;
            if (runnerRef.current.hasRun) {
              // User clicked it themselves before we could — good, skip
              // the auto-click and let celebrateRun fire from the
              // observer below.
              break;
            }
          }
          if (cancelled) return;
          if (!runnerRef.current.hasRun) {
            if (runnerRef.current.canRun) {
              // "The tutor just spoke" beat, then trigger the run.
              // Earlier versions also did a framer-motion scale press
              // animation on the button as a "look at me pressing"
              // cue. That turned out to fight the FirstRunSpotlight's
              // rect-tracking poll — the scale transform shifted the
              // button's bounding box mid-animation and the spotlight
              // snapped to a new size, reading as a micro-flicker the
              // user never saw on manual clicks. The spotlight alone
              // is enough of a "watch this" signal; skip the scale.
              await new Promise((r) => setTimeout(r, POST_GREET_BEAT_MS));
              if (cancelled) return;
              // Drive the runner directly rather than simulating a
              // DOM click. A synthetic .click() on a React button
              // still works but takes a longer path (event dispatch
              // → bubbling → React's synthetic-event layer) and can
              // race with the button's own focus/hover state. Calling
              // handleRun is what the onClick handler eventually does
              // anyway — cut out the middle layer.
              void runnerRef.current.handleRun();
            }
            // else: canRun never went true; user-driven mode kicks in.
          }
          return; // transition happens in observer below
        }

        if (step === "celebrateRun") {
          // Breathing room so the output panel's `Hello, YOUR_NAME!`
          // lands and reads before the next scripted turn overwrites
          // the attention with new typing.
          await new Promise((r) => setTimeout(r, POST_RUN_BEAT_MS));
          if (cancelled) return;
          const stream = pushScriptedAssistant(CELEBRATE_RUN());
          currentStreamRef.current = stream;
          await stream.done;
          if (cancelled) return;
          setStep("awaitEdit");
          return;
        }

        if (step === "correctEdit") {
          // Pick correction copy keyed to what actually went wrong.
          // Detection precedence matches severity: a run that errored
          // needs an error message first, an empty stdout means the
          // print call got lost, an output that still contains
          // `YOUR_NAME` means they ran without replacing the
          // placeholder. The generic fallback covers "typed something
          // random." attempts >= 2 short-circuits the specific copy
          // and drops the answer — we never leave the learner stranded.
          const attempts = useFirstRunStore.getState().wrongEditAttempts;
          const lastResult = useRunStore.getState().result;
          let copy: string;
          if (attempts >= 2) {
            copy = STRONGER_HINT();
          } else if (lastResult && lastResult.exitCode !== 0) {
            copy = WRONG_EDIT_ERROR();
          } else if (!lastResult?.stdout || lastResult.stdout.trim().length === 0) {
            copy = WRONG_EDIT_EMPTY();
          } else if (lastResult.stdout.includes("YOUR_NAME")) {
            copy = WRONG_EDIT_PLACEHOLDER();
          } else {
            copy = WRONG_EDIT_GENERIC();
          }
          const stream = pushScriptedAssistant(copy);
          currentStreamRef.current = stream;
          await stream.done;
          if (cancelled) return;
          setStep("awaitEdit");
          return;
        }

        if (step === "praiseEditRun") {
          // Celebrate the edit + run AND seed the "ask me anything /
          // try printing your name" invitation in the same beat. After
          // the learner clicks Check, the lesson-complete confetti +
          // "Next lesson" prompt takes over — they won't come back to
          // read another scripted turn. So this is the real final
          // word from the scripted tutor.
          //
          // Phase 27-v2 Day 3b option (d): on anon path, resolve the
          // user's typed name from their code at praise time and use
          // it instead of the prop firstName. firstName on anon is
          // "there" by design (we don't ask for a name at trial
          // entry); the typed name landing on praise is exactly the
          // moment personalization is earned and powerful.
          const praiseName = resolvePraiseName?.() ?? firstName;
          const stream = pushScriptedAssistant(
            PRAISE_EDIT_RUN_AND_SEED(praiseName),
          );
          currentStreamRef.current = stream;
          await stream.done;
          if (cancelled) return;
          setStep("awaitCheck");
          return;
        }

        if (step === "seed") {
          // Final step — choreography exits cleanly; real tutor input
          // is now unlocked. On the authed path we PATCH preferences
          // so welcomeDone=true and the next LessonPage mount doesn't
          // re-run this hook. On the anon path the caller handles
          // persistence via sessionStorage stash on the wall click —
          // we just transition to "done" so the runner doesn't loop.
          // Check cancel BEFORE the await so a skip doesn't trigger
          // a trailing server patch; check AGAIN after so a skip
          // during the await aborts the setStep.
          if (cancelled) return;
          if (onSeed === "authed-mark-prefs") {
            await markFirstRunComplete();
            if (cancelled) return;
          } else if (onSeed === "anon-stash") {
            // Phase 27-v2.1 audit pass 1 fix #3 + pass 2 P2 #3: stamp
            // the per-tab sessionStorage flag so a /try/ reload mid-
            // or post-lesson doesn't replay the scripted walkthrough
            // from "greet" (which would also fire
            // useAIStore.clearConversation() and wipe Maya's tutor
            // history). Lesson 2 post-signup is handled separately
            // by the welcomeDone flag in the anon-handoff stash.
            // Pass 2 moved this to a static top-of-file import to
            // close the reload-window leak — dynamic import resolution
            // (~ms-tens) between cancel-check and flag-stamp could
            // skip the persist on a slow-network reload.
            markChoreographyDoneAnon();
          }
          setStep("done");
          return;
        }
      } catch {
        // Pass 2 P1 #1: catch-block skip path also persists "done".
        persistDoneOnSkip();
        skip();
      }
    })();

    return cancel;
  }, [enabled, skipped, step, firstName, onSeed, resolvePraiseName, setStep, skip, persistDoneOnSkip]);

  // Observer: celebrateRun fires when the first run completes.
  useEffect(() => {
    if (!enabled || skipped) return;
    if (step !== "awaitRun") return;
    if (runner.hasRun && !runner.running) {
      setStep("celebrateRun");
    }
  }, [enabled, skipped, step, runner.hasRun, runner.running, setStep]);

  // Observer: after the learner edits + runs, evaluate stdout.
  //   - Match -> praiseEditRun (the real success path).
  //   - Miss  -> correctEdit, which pushes a scripted correction
  //              keyed to the specific kind of mistake. We do NOT
  //              wait on validator.validation.passed here — that
  //              only flips on the separate "Check my work" button,
  //              and the previous beat only asked for a Run.
  //
  // lastEvaluatedResultRef guards against re-evaluating the same
  // RunResult: runner.hasRun stays true after a run, so the
  // dependency array alone would fire repeatedly. We key on the
  // result reference — a fresh run produces a new object, which is
  // the only real trigger we care about.
  const lastEvaluatedResultRef = useRef<unknown>(null);
  const bumpWrongEditAttempts = useFirstRunStore(
    (s) => s.bumpWrongEditAttempts,
  );

  // Seed the last-evaluated-result ref every time awaitEdit starts.
  // Without this, the auto-run's result (from the awaitRun step) is
  // still sitting in runStore when awaitEdit begins — and since
  // `runner.hasRun` is true from that auto-run, the observer below
  // would evaluate the STALE "Hello, YOUR_NAME!" stdout the instant the
  // learner types a single character (hasEdited flips true). That
  // fired `correctEdit` immediately, with a "capital W" nudge
  // referring to text the user hadn't actually produced yet. Seeding
  // here means the observer only fires on runs that happen AFTER
  // awaitEdit began — i.e., on the learner's own run, not the
  // auto-run from one step earlier. The same seed also handles the
  // user-typed-during-celebrateRun edge case: when awaitEdit enters
  // with hasEdited already true, the ref matches the current result
  // and the observer correctly waits for an actual run.
  useEffect(() => {
    if (step === "awaitEdit") {
      lastEvaluatedResultRef.current = useRunStore.getState().result;
    }
  }, [step]);

  useEffect(() => {
    if (!enabled || skipped) return;
    if (step !== "awaitEdit") return;
    if (!runner.hasEdited || runner.running || !runner.hasRun) return;
    const lastResult = useRunStore.getState().result;
    if (!lastResult) return;
    if (lastEvaluatedResultRef.current === lastResult) return;
    lastEvaluatedResultRef.current = lastResult;
    // Phase 27 personalized lesson 1: success = exit clean, output
    // contains "Hello, " (the greeting structure), AND no `YOUR_NAME`
    // placeholder still in stdout (i.e., they actually replaced it).
    const stdout = lastResult.stdout ?? "";
    const stdoutOk =
      lastResult.exitCode === 0 &&
      stdout.includes("Hello, ") &&
      !stdout.includes("YOUR_NAME");
    if (stdoutOk) {
      setStep("praiseEditRun");
      return;
    }
    // Wrong output — bump the attempt counter and route into the
    // correction branch. Bump happens first so the step handler
    // reads the updated count when it picks copy.
    bumpWrongEditAttempts();
    setStep("correctEdit");
  }, [
    enabled,
    skipped,
    step,
    runner.hasEdited,
    runner.running,
    runner.hasRun,
    setStep,
    bumpWrongEditAttempts,
  ]);

  // Observer: Check pass terminates the scripted choreography. The
  // learner is about to see the product's own lesson-complete
  // confetti + "Next lesson" panel — that's the real celebration.
  // Adding another scripted tutor turn here would either compete
  // with the completion UI or never be read (user clicks Next
  // before it finishes typing). So we just flip welcomeDone and
  // exit cleanly.
  useEffect(() => {
    if (!enabled || skipped) return;
    if (step !== "awaitCheck") return;
    if (validator.validation?.passed) {
      setStep("seed");
    }
  }, [enabled, skipped, step, validator.validation, setStep]);
}
