import { useEffect, useRef } from "react";
import { useAIStore } from "../../state/aiStore";
import { useRunStore } from "../../state/runStore";
import { markFirstRunComplete } from "../../state/preferencesStore";
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
//   * 5-minute wall-clock timeout → skip

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
const WALL_CLOCK_MAX_MS = 5 * 60 * 1000;

export function useFirstRunChoreography({
  enabled,
  firstName,
  runner,
  validator,
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
  const wallClockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
        skip();
      }
    });
    return unsub;
  }, [enabled, skip]);

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
    // Wall-clock watchdog — auto-skip after 5 min regardless of state.
    wallClockTimerRef.current = setTimeout(() => {
      currentStreamRef.current?.cancel();
      skip();
    }, WALL_CLOCK_MAX_MS);
    return () => {
      if (wallClockTimerRef.current) clearTimeout(wallClockTimerRef.current);
      currentStreamRef.current?.cancel();
      reset();
    };
  }, [enabled, start, skip, reset]);

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
          const stream = pushScriptedAssistant(
            PRAISE_EDIT_RUN_AND_SEED(firstName),
          );
          currentStreamRef.current = stream;
          await stream.done;
          if (cancelled) return;
          setStep("awaitCheck");
          return;
        }

        if (step === "seed") {
          // Final step — flag the first-run as done server-side. The
          // choreography exits cleanly; real tutor input is now
          // unlocked (no scripted turns gate, and
          // `welcomeDone === true` prevents the next LessonPage mount
          // from re-running this hook). Check cancel BEFORE the await
          // so a user who just skipped doesn't get a trailing server
          // patch; check AGAIN after so a skip during the await
          // aborts the setStep.
          if (cancelled) return;
          await markFirstRunComplete();
          if (cancelled) return;
          setStep("done");
          return;
        }
      } catch {
        skip();
      }
    })();

    return cancel;
  }, [enabled, skipped, step, firstName, setStep, skip]);

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
