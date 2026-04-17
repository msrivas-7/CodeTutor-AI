import { useCallback, useEffect, useState } from "react";
import { CoachBubble } from "../features/learning/components/CoachBubble";

const LS_KEY = "onboarding:v1:editor-done";

export function isEditorOnboardingDone(): boolean {
  try { return localStorage.getItem(LS_KEY) === "1"; } catch { return false; }
}

function markDone(): void {
  try { localStorage.setItem(LS_KEY, "1"); } catch { /* */ }
}

interface CoachStep {
  targetKey: keyof EditorCoachRefs;
  title: string;
  body: string;
  position: "top" | "bottom" | "left" | "right";
}

const STEPS: CoachStep[] = [
  {
    targetKey: "langPicker",
    title: "Pick a Language",
    body: "Choose from 9 languages. Switching loads a starter project so you can jump right in.",
    position: "bottom",
  },
  {
    targetKey: "fileTree",
    title: "File Tree",
    body: "Your project files live here. Click a file to open it in the editor. Some starters have multiple files.",
    position: "right",
  },
  {
    targetKey: "editor",
    title: "Code Editor",
    body: "Write your code here — it's the same engine that powers VS Code. Syntax highlighting, autocomplete, and more.",
    position: "left",
  },
  {
    targetKey: "runButton",
    title: "Run Your Code",
    body: "Click this to run your code in a sandboxed Docker container. You can also press Cmd+Enter (or Ctrl+Enter).",
    position: "bottom",
  },
  {
    targetKey: "outputPanel",
    title: "Output Panel",
    body: "Your code's output, errors, and execution time show up here. There's also a Stdin tab for providing input.",
    position: "top",
  },
  {
    targetKey: "tutorPanel",
    title: "AI Tutor",
    body: "Ask questions about your code and get structured hints. Highlight code and press Cmd+K to ask about a selection. Requires an OpenAI API key in Settings.",
    position: "left",
  },
];

export interface EditorCoachRefs {
  langPicker: HTMLElement | null;
  fileTree: HTMLElement | null;
  editor: HTMLElement | null;
  runButton: HTMLElement | null;
  outputPanel: HTMLElement | null;
  tutorPanel: HTMLElement | null;
}

interface EditorCoachProps {
  refs: EditorCoachRefs;
  onComplete: () => void;
}

export function EditorCoach({ refs, onComplete }: EditorCoachProps) {
  const [step, setStep] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);

  const currentStep = STEPS[step];
  const targetEl = currentStep ? refs[currentStep.targetKey] : null;

  useEffect(() => {
    if (!targetEl) {
      if (step < STEPS.length - 1) setStep((s) => s + 1);
      else { markDone(); onComplete(); }
      return;
    }
    const update = () => setTargetRect(targetEl.getBoundingClientRect());
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [targetEl, step, onComplete]);

  const advance = useCallback(() => {
    if (step >= STEPS.length - 1) {
      markDone();
      onComplete();
    } else {
      setStep((s) => s + 1);
    }
  }, [step, onComplete]);

  const dismiss = useCallback(() => {
    markDone();
    onComplete();
  }, [onComplete]);

  if (!targetRect || !currentStep) return null;

  const pad = 6;
  const spotStyle = {
    position: "fixed" as const,
    top: targetRect.top - pad,
    left: targetRect.left - pad,
    width: targetRect.width + pad * 2,
    height: targetRect.height + pad * 2,
    borderRadius: 8,
    boxShadow: "0 0 0 9999px rgba(0,0,0,0.65)",
    zIndex: 51,
    pointerEvents: "none" as const,
  };

  return (
    <>
      <div className="fixed inset-0 z-50" onClick={advance} />
      <div style={spotStyle} />
      <button
        onClick={dismiss}
        className="fixed right-4 top-14 z-[53] rounded-md bg-panel/90 px-3 py-1 text-[11px] text-muted ring-1 ring-border transition hover:text-ink"
      >
        Skip tour
      </button>
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
