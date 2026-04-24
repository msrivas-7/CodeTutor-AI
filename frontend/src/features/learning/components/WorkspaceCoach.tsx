import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { CoachBubble } from "./CoachBubble";
import { useShortcutLabels } from "../../../util/platform";
import {
  markOnboardingDone,
  usePreferencesStore,
} from "../../../state/preferencesStore";
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
}

function isDone(): boolean {
  return usePreferencesStore.getState().workspaceCoachDone;
}

function markDone(): void {
  markOnboardingDone("workspaceCoachDone");
}

export function WorkspaceCoach({ refs, onComplete }: WorkspaceCoachProps) {
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

  useEffect(() => {
    if (!targetEl) {
      if (step < STEPS.length - 1) setStep((s) => s + 1);
      else { markDone(); onComplete(); }
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
        setTargetRect(targetEl.getBoundingClientRect());
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
  }, [targetEl, step, onComplete, STEPS.length]);

  const advance = useCallback(() => {
    if (step >= STEPS.length - 1) {
      markDone();
      onComplete();
    } else {
      setStep((s) => s + 1);
    }
  }, [step, onComplete, STEPS.length]);

  const dismiss = useCallback(() => {
    markDone();
    onComplete();
  }, [onComplete]);

  // A6: Esc dismisses the coach — matches the Modal + WelcomeOverlay pattern.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dismiss]);

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
