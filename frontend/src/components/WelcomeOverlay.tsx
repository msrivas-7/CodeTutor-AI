import { useCallback, useEffect, useRef, useState } from "react";
import { CoachBubble } from "../features/learning/components/CoachBubble";
import {
  markOnboardingDone,
  usePreferencesStore,
} from "../state/preferencesStore";

export function isWelcomeDone(): boolean {
  return usePreferencesStore.getState().welcomeDone;
}

export function markWelcomeDone(): void {
  markOnboardingDone("welcomeDone");
}

interface WelcomeStep {
  refKey: keyof WelcomeOverlayRefs;
  title: string;
  body: string;
  position: "top" | "bottom" | "left" | "right";
}

const STEPS: WelcomeStep[] = [
  {
    refKey: "header",
    title: "Welcome to CodeTutor AI!",
    body: "Learn to code from scratch with hands-on lessons and an AI tutor that guides you — without giving away the answers. No account needed.",
    position: "bottom",
  },
  {
    refKey: "editorCard",
    title: "Free-form Editor",
    body: "Already know some coding? Use the editor to write and run code in 9 languages with a sandboxed environment and AI help.",
    position: "top",
  },
  {
    refKey: "guidedCard",
    title: "Guided Course — start here!",
    body: "New to coding? This is for you. Step-by-step Python or JavaScript lessons with instructions, instant feedback, and an AI tutor that won't give away the answer.",
    position: "top",
  },
];

export interface WelcomeOverlayRefs {
  header: HTMLElement | null;
  editorCard: HTMLElement | null;
  guidedCard: HTMLElement | null;
}

interface WelcomeOverlayProps {
  refs: WelcomeOverlayRefs;
  onDismiss: () => void;
}

export function WelcomeOverlay({ refs, onDismiss }: WelcomeOverlayProps) {
  const [step, setStep] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  const currentStep = STEPS[step];
  const targetEl = currentStep ? refs[currentStep.refKey] : null;

  // A3: capture focus on mount, restore on unmount so keyboard users land
  // back where they came from once the onboarding tour closes.
  useEffect(() => {
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    return () => {
      previouslyFocused.current?.focus?.();
    };
  }, []);

  useEffect(() => {
    if (!targetEl) {
      if (step < STEPS.length - 1) setStep((s) => s + 1);
      else { markWelcomeDone(); onDismiss(); }
      return;
    }
    const update = () => setTargetRect(targetEl.getBoundingClientRect());
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [targetEl, step, onDismiss]);

  const lastAdvanceAt = useRef(0);
  const advance = useCallback(() => {
    const now = Date.now();
    if (now - lastAdvanceAt.current < 200) return;
    lastAdvanceAt.current = now;
    if (step >= STEPS.length - 1) {
      markWelcomeDone();
      onDismiss();
    } else {
      setStep((s) => s + 1);
    }
  }, [step, onDismiss]);

  const dismiss = useCallback(() => {
    markWelcomeDone();
    onDismiss();
  }, [onDismiss]);

  // A3: Esc dismisses the tour — matches every other modal/dialog in the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dismiss]);

  if (!targetRect || !currentStep) return null;

  const pad = 8;
  const spotStyle = {
    position: "fixed" as const,
    top: targetRect.top - pad,
    left: targetRect.left - pad,
    width: targetRect.width + pad * 2,
    height: targetRect.height + pad * 2,
    borderRadius: 12,
    boxShadow: "0 0 0 9999px rgba(0,0,0,0.6)",
    zIndex: 51,
    pointerEvents: "none" as const,
  };

  return (
    <>
      <div className="fixed inset-0 z-50" onClick={advance} />
      <div style={spotStyle} />
      <button
        onClick={dismiss}
        title="Skip onboarding"
        aria-label="Skip onboarding"
        className="fixed right-2 top-2 z-[53] rounded-md bg-panel/95 px-3 py-1.5 text-[11px] font-medium text-ink shadow-sm ring-1 ring-border transition hover:bg-panel hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:right-4 sm:top-4"
      >
        Skip
      </button>
      {/*
        stopPropagation so clicks on the bubble's inner Next button don't
        also bubble to the full-screen overlay above and double-advance the
        step. The 200ms rate-limit inside `advance` catches it, but relying
        on timing is fragile — swallowing the event at the boundary is the
        real fix.
      */}
      <div className="z-[52]" onClick={(e) => e.stopPropagation()}>
        <CoachBubble
          title={currentStep.title}
          body={currentStep.body}
          position={currentStep.position}
          rect={targetRect}
          onNext={advance}
          stepLabel={`${step + 1} of ${STEPS.length}`}
        />
      </div>
    </>
  );
}
