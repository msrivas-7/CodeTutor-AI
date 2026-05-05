import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { CoachBubble } from "./CoachBubble";
import { useShortcutLabels } from "../../../util/platform";
import {
  markOnboardingDone,
  usePreferencesStore,
} from "../../../state/preferencesStore";
import { useFirstRunStore } from "../../firstRun/useFirstRunStore";
import { useNarrowViewport } from "../../../util/layoutPrefs";
import { PHONE_MAX_PX } from "../../../components/NarrowViewportGate";
import { HOUSE_EASE } from "../../../components/cinema/easing";

interface CoachStep {
  targetKey: keyof WorkspaceCoachRefs;
  title: string;
  body: string;
  position: "top" | "bottom" | "left" | "right";
}

function buildSteps(runPhrase: string): CoachStep[] {
  return [
    {
      targetKey: "instructions",
      title: "Lesson Instructions",
      body: "This panel has your lesson instructions. Read them to learn what you need to do.",
      position: "right",
    },
    {
      targetKey: "editor",
      title: "Code Editor",
      body: "This is where you write your code. Try changing the text inside the quotes to get started.",
      position: "left",
    },
    {
      targetKey: "runButton",
      title: "Run Your Code",
      body: `Press this button to run your code and see the output. You can also press ${runPhrase}.`,
      position: "top",
    },
    {
      targetKey: "outputPanel",
      title: "Output Panel",
      body: "Your code's output shows up here — what it prints, any errors, and how long it took.",
      position: "top",
    },
    {
      targetKey: "checkButton",
      title: "Check My Work",
      body: "When you think your answer is right, click this to verify. It checks your output against what the lesson expects.",
      position: "top",
    },
    {
      targetKey: "tutorPanel",
      title: "AI Tutor",
      body: "If you get stuck, your AI tutor can help — it'll guide you without giving away the answer. You can also skip it entirely.",
      position: "left",
    },
  ];
}

export interface WorkspaceCoachRefs {
  instructions: HTMLElement | null;
  editor: HTMLElement | null;
  runButton: HTMLElement | null;
  outputPanel: HTMLElement | null;
  checkButton: HTMLElement | null;
  tutorPanel: HTMLElement | null;
}

interface WorkspaceCoachProps {
  refs: WorkspaceCoachRefs;
  onComplete: () => void;
  /**
   * Phase 27-v2 Day 6: skip the markOnboardingDone() PATCH on anon
   * mounts. The default (true) preserves the authed /learn/...
   * behavior — coach dismissal PATCHes user_preferences so the next
   * lesson visit doesn't re-fire the tour. The anon path has no
   * userId; PATCHing /api/user/preferences would 401. Anon caller
   * passes false and tracks coach dismissal in local state, then
   * propagates the truth into the sessionStorage stash so the
   * post-signup handoff can flip the persistent flag at /api/anon-
   * handoff time. Same pattern useFirstRunChoreography.onSeed uses.
   */
  persistDone?: boolean;
}

function isDone(): boolean {
  return usePreferencesStore.getState().workspaceCoachDone;
}

function maybeMarkDone(persistDone: boolean): void {
  if (persistDone) {
    markOnboardingDone("workspaceCoachDone");
    return;
  }
  // Phase 27-v2.1 — anon path: flip the local preferencesStore flag
  // WITHOUT the PATCH /api/user/preferences. This is what unblocks
  // LessonPage's choreography enable gate (which reads
  // workspaceCoachDone) on the trial path. Without the local flip,
  // the gate would stay false on anon and the scripted walkthrough
  // would never fire after the coach dismissed.
  usePreferencesStore.setState({ workspaceCoachDone: true });
}

export function WorkspaceCoach({
  refs,
  onComplete,
  persistDone = true,
}: WorkspaceCoachProps) {
  const [step, setStep] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const keys = useShortcutLabels();
  const STEPS = useMemo(() => buildSteps(keys.runPhrase), [keys]);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  const currentStep = STEPS[step];
  const targetEl = currentStep ? refs[currentStep.targetKey] : null;

  // A6: capture focus on mount, restore on unmount so keyboard users return
  // to whatever was focused before the coach took over.
  useEffect(() => {
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    return () => {
      previouslyFocused.current?.focus?.();
    };
  }, []);

  // Phase 27-v2.2 Fix 3 — phone short-circuit. The 6-step coach assumes a
  // ≥1024px desktop layout (instructions left, editor center, tutor right
  // — all visible simultaneously). On a 390px phone CoachBubble can't
  // anchor next to a spotlight without overflowing, the 28px Skip-tour
  // button is below the 44pt HIG touch-target minimum, and the museum-
  // tour pacing eats ~30s of Maya's 90s patience budget. The scripted
  // walkthrough that fires after the coach already orients her ("Hey
  // there — let me run it for you") so the coach is redundant on phone.
  // Skip-via-mark-done: same flow as natural completion. choreography's
  // enable-gate flips because workspaceCoachDone is the gate
  // (preferencesStore.setState fires whether persistDone or not, per
  // maybeMarkDone above). Authed and direct-signup desktop paths keep
  // the coach (Alex on a laptop is the audience there).
  const phone = useNarrowViewport(PHONE_MAX_PX);
  const phoneSkippedRef = useRef(false);
  useEffect(() => {
    if (!phone || phoneSkippedRef.current) return;
    phoneSkippedRef.current = true;
    maybeMarkDone(persistDone);
    onComplete();
  }, [phone, persistDone, onComplete]);

  useEffect(() => {
    // Skip steps whose target is missing OR has zero size. The
    // zero-size case happens after the Cinema Kit Continuity Pass
    // — collapsible panels (Instructions, Tutor, file tree, etc.)
    // now stay mounted at width:0 with their refs still pointing
    // at the DOM node. Without this guard the spotlight degrades
    // to a 1-2 px slice and the bubble loses its anchor. Skip and
    // advance to the next step.
    const initialRect = targetEl?.getBoundingClientRect();
    const targetUsable =
      !!targetEl && !!initialRect && initialRect.width > 0 && initialRect.height > 0;
    if (!targetUsable) {
      // Clear the prior step's rect so we don't paint the spotlight
      // at stale coordinates for a frame while the cascade resolves.
      setTargetRect(null);
      if (step < STEPS.length - 1) setStep((s) => s + 1);
      else { maybeMarkDone(persistDone); onComplete(); }
      return;
    }
    // Spotlight target can drift if anything scrolls (panels, window) or the
    // target element's own box reflows (splitter drag, content change). Subscribe
    // to all three signals and throttle via rAF so we never paint mid-frame.
    let rafId = 0;
    const update = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        const r = targetEl.getBoundingClientRect();
        // If the panel collapses MID-TOUR (user clicks the chevron
        // while we're spotlighted on it), the ResizeObserver fires
        // here with a 0×0 rect. Cascade to the next step instead of
        // painting a 1-px sliver.
        if (r.width <= 0 || r.height <= 0) {
          setTargetRect(null);
          if (step < STEPS.length - 1) setStep((s) => s + 1);
          else { maybeMarkDone(persistDone); onComplete(); }
          return;
        }
        setTargetRect(r);
      });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(targetEl);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, { capture: true, passive: true });
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      ro.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, { capture: true } as EventListenerOptions);
    };
  }, [targetEl, step, onComplete, persistDone, STEPS.length]);

  const advance = useCallback(() => {
    if (step >= STEPS.length - 1) {
      maybeMarkDone(persistDone);
      onComplete();
    } else {
      setStep((s) => s + 1);
    }
  }, [step, onComplete, persistDone, STEPS.length]);

  const dismiss = useCallback(() => {
    maybeMarkDone(persistDone);
    onComplete();
  }, [onComplete, persistDone]);

  // A6: Esc dismisses the coach — matches the Modal + WelcomeOverlay pattern.
  //
  // Phase 27-v2.1 audit pass 1 fix #4: gate the Esc handler on
  // `cinematicShowing` being false. On /try/ the coach mounts ~600 ms
  // after lesson load (COACH_AUTO_OPEN_MS), but the CinematicGreeting
  // is still on top until ~14 s. The coach's anchor refs ARE
  // populated under the cinematic (the lesson chrome is laid out
  // beneath the overlay), so targetRect resolves and the keydown
  // listener registers. Without this gate, a single Esc keystroke
  // during the cinematic dismissed BOTH surfaces (cinematic via its
  // own handler, coach via this listener) — Maya then never saw the
  // 6-step orientation tour.
  const cinematicShowing = useFirstRunStore((s) => s.cinematicShowing);
  useEffect(() => {
    if (cinematicShowing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dismiss, cinematicShowing]);

  if (!targetRect || !currentStep) return null;

  const pad = 6;

  return (
    <>
      {/* Overlay — clicking it advances */}
      <div
        className="fixed inset-0 z-50"
        onClick={advance}
      />
      {/* Spotlight cutout. Cinema Kit Continuity Pass — converted from
          a snap-positioned div to a `motion.div` that interpolates
          top/left/width/height across step changes via framer's
          `animate` prop. The 6-step tour now reads as one camera
          glide through the workspace instead of stop-start jumps.
          ResizeObserver still fires `setTargetRect` on layout changes
          within a step (splitter drag, window resize); framer
          interpolates those too, smoothly. */}
      <motion.div
        aria-hidden="true"
        initial={false}
        animate={{
          top: targetRect.top - pad,
          left: targetRect.left - pad,
          width: targetRect.width + pad * 2,
          height: targetRect.height + pad * 2,
        }}
        transition={{ duration: 0.32, ease: HOUSE_EASE }}
        style={{
          position: "fixed",
          borderRadius: 8,
          boxShadow: "0 0 0 9999px rgba(0,0,0,0.65)",
          zIndex: 51,
          pointerEvents: "none",
        }}
      />
      {/* Skip button */}
      <button
        onClick={dismiss}
        className="fixed right-4 top-14 z-[53] rounded-md bg-panel/90 px-3 py-1 text-[11px] text-muted ring-1 ring-border transition hover:text-ink"
      >
        Skip tour
      </button>
      {/* Coach bubble */}
      <div className="z-[52]">
        <CoachBubble
          title={currentStep.title}
          body={currentStep.body}
          position={currentStep.position}
          rect={targetRect}
          onNext={advance}
          stepLabel={`Step ${step + 1} of ${STEPS.length}`}
        />
      </div>
    </>
  );
}

export { isDone as isOnboardingDone };
