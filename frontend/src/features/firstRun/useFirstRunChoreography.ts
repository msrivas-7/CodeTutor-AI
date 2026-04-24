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
// starts typing. Gives the learner a beat to read `Hello, Python!` in
// the output panel before the tutor speaks again.
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
          // Breathing room so the output panel's `Hello, Python!`
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
          // from re-running this hook).
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

  // Observer: after the learner edits + runs, check the stdout for
  // the target output. We deliberately DON'T wait on
  // `validator.validation.passed` here — that flag only flips on the
  // separate "Check my work" button, and the scripted copy in the
  // previous beat only asked for a Run. The next nudge (praiseEditRun)
  // is what tells the learner to click Check.
  useEffect(() => {
    if (!enabled || skipped) return;
    if (step !== "awaitEdit") return;
    if (!runner.hasEdited || runner.running || !runner.hasRun) return;
    const lastResult = useRunStore.getState().result;
    const stdoutOk =
      lastResult?.exitCode === 0 &&
      (lastResult.stdout ?? "").includes("Hello, World!");
    if (stdoutOk) {
      setStep("praiseEditRun");
    }
  }, [
    enabled,
    skipped,
    step,
    runner.hasEdited,
    runner.running,
    runner.hasRun,
    setStep,
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
