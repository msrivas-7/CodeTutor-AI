import { create } from "zustand";

// Non-persisted state for the first-run choreography. Lives in module
// scope so the state machine survives LessonPage re-renders but resets
// on full reload — exactly the scope we want. Not backed to the server;
// welcomeDone is the server-backed "first-run complete" flag, and this
// store only tracks where inside the cinematic we currently are.

export type FirstRunStep =
  | "idle"
  | "greet"
  | "awaitRun"
  | "celebrateRun"
  | "awaitEdit"
  | "correctEdit"
  | "praiseEditRun"
  | "awaitCheck"
  | "seed"
  | "done";

interface FirstRunStoreState {
  step: FirstRunStep;
  startedAt: number | null;
  /** When true, something (user action, error, timeout) has aborted the
   *  choreography. The runner hook reads this and unwinds on next tick. */
  skipped: boolean;
  /** Counter of wrong-edit runs in the awaitEdit step. The choreography
   *  reads this to decide which correction copy to surface (specific
   *  nudge on attempt 1, stronger "here's the answer" on attempt 2+). */
  wrongEditAttempts: number;
  /** Cinema Kit Continuity Pass — match-cut handoff signal.
   *  CinematicGreeting writes Date.now() the moment its exit beat
   *  begins (setExiting(true)). LessonPage reads this on mount: if
   *  the value is non-null AND within ~1.5s of `Date.now()`, the
   *  page is mounting AS THE CINEMATIC EXITS — i.e., this is the
   *  handoff. The page then renders an inverted RingPulse (same
   *  geometry as the cinematic's outward expansion, contracting
   *  inward to the Run button) so the eye follows one continuous
   *  motion across the route boundary. Cleared by the consumer
   *  after it's read so a stale value can't trigger the handoff
   *  on a normal lesson visit later. */
  cinematicExitingAt: number | null;
  start: () => void;
  setStep: (step: FirstRunStep) => void;
  bumpWrongEditAttempts: () => void;
  markCinematicExiting: () => void;
  clearCinematicExiting: () => void;
  skip: () => void;
  reset: () => void;
}

export const useFirstRunStore = create<FirstRunStoreState>((set, get) => ({
  step: "idle",
  startedAt: null,
  skipped: false,
  wrongEditAttempts: 0,
  cinematicExitingAt: null,
  start: () => {
    if (get().step !== "idle") return; // idempotent
    set({ step: "greet", startedAt: Date.now(), skipped: false, wrongEditAttempts: 0 });
  },
  setStep: (step) => set({ step }),
  bumpWrongEditAttempts: () =>
    set({ wrongEditAttempts: get().wrongEditAttempts + 1 }),
  markCinematicExiting: () => set({ cinematicExitingAt: Date.now() }),
  clearCinematicExiting: () => set({ cinematicExitingAt: null }),
  skip: () => set({ skipped: true, step: "done" }),
  reset: () =>
    set({ step: "idle", startedAt: null, skipped: false, wrongEditAttempts: 0, cinematicExitingAt: null }),
}));
