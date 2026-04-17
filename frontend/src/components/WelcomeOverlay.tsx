import { useCallback, useEffect, useState } from "react";
import { CoachBubble } from "../features/learning/components/CoachBubble";

const LS_KEY = "onboarding:v1:welcome-done";

export function isWelcomeDone(): boolean {
  try { return localStorage.getItem(LS_KEY) === "1"; } catch { return false; }
}

export function markWelcomeDone(): void {
  try { localStorage.setItem(LS_KEY, "1"); } catch { /* */ }
}

interface WelcomeStep {
  title: string;
  body: string;
  position: "top" | "bottom" | "left" | "right";
}

const STEPS: WelcomeStep[] = [
  {
    title: "Welcome to CodeTutor AI!",
    body: "Learn to code from scratch with hands-on lessons and an AI tutor that guides you — without giving away the answers. No account needed.",
    position: "bottom",
  },
  {
    title: "Start here",
    body: "New to coding? Click this to begin the guided Python course — step-by-step lessons with instant feedback.",
    position: "left",
  },
];

export interface WelcomeOverlayRefs {
  header: HTMLElement | null;
  guidedCard: HTMLElement | null;
}

interface WelcomeOverlayProps {
  refs: WelcomeOverlayRefs;
  onDismiss: () => void;
}

export function WelcomeOverlay({ refs, onDismiss }: WelcomeOverlayProps) {
  const [step, setStep] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);

  const currentStep = STEPS[step];
  const targetEl = step === 0 ? refs.header : refs.guidedCard;

  useEffect(() => {
    if (!targetEl) return;
    const update = () => setTargetRect(targetEl.getBoundingClientRect());
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [targetEl]);

  const advance = useCallback(() => {
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
        className="fixed right-4 top-4 z-[53] rounded-md bg-panel/90 px-3 py-1 text-[11px] text-muted ring-1 ring-border transition hover:text-ink"
      >
        Skip
      </button>
      <div className="z-[52]">
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
