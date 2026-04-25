import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { CoachBubble } from "../features/learning/components/CoachBubble";
import { useShortcutLabels } from "../util/platform";
import {
  markOnboardingDone,
  usePreferencesStore,
} from "../state/preferencesStore";
import { HOUSE_EASE } from "./cinema/easing";

export function isEditorOnboardingDone(): boolean {
  return usePreferencesStore.getState().editorCoachDone;
}

function markDone(): void {
  markOnboardingDone("editorCoachDone");
}

interface CoachStep {
  targetKey: keyof EditorCoachRefs;
  title: string;
  body: string;
  position: "top" | "bottom" | "left" | "right";
}

function buildSteps(runPhrase: string, askPhrase: string): CoachStep[] {
  return [
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
      body: `Click this to run your code in a sandboxed container. You can also press ${runPhrase}.`,
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
      body: `Ask questions about your code and get structured hints. Highlight code and press ${askPhrase} to ask about a selection. Requires an OpenAI API key in Settings.`,
      position: "left",
    },
  ];
}

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
  const keys = useShortcutLabels();
  const STEPS = useMemo(() => buildSteps(keys.runPhrase, keys.askPhrase), [keys]);

  const currentStep = STEPS[step];
  const targetEl = currentStep ? refs[currentStep.targetKey] : null;

  useEffect(() => {
    // Skip steps whose target is missing OR has zero size. The
    // zero-size case happens after the Cinema Kit Continuity Pass
    // — collapsible panels (file tree, tutor) now stay mounted at
    // width:0 with their refs still pointing at the DOM node.
    // Without this guard the spotlight degrades to a 1-2 px slice
    // and the bubble loses its anchor. Skip and advance.
    const initialRect = targetEl?.getBoundingClientRect();
    const targetUsable =
      !!targetEl && !!initialRect && initialRect.width > 0 && initialRect.height > 0;
    if (!targetUsable) {
      // Clear stale rect so the spotlight doesn't paint at the prior
      // step's coords for a frame during the cascade.
      setTargetRect(null);
      if (step < STEPS.length - 1) setStep((s) => s + 1);
      else { markDone(); onComplete(); }
      return;
    }
    let rafId = 0;
    const update = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        const r = targetEl.getBoundingClientRect();
        // Mid-tour collapse race: user toggles a panel while we're
        // spotlighted on it. ResizeObserver fires here with 0×0;
        // cascade to the next step instead of drawing a sliver.
        if (r.width <= 0 || r.height <= 0) {
          setTargetRect(null);
          if (step < STEPS.length - 1) setStep((s) => s + 1);
          else { markDone(); onComplete(); }
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

  if (!targetRect || !currentStep) return null;

  const pad = 6;

  return (
    <>
      <div className="fixed inset-0 z-50" onClick={advance} />
      {/* Spotlight cutout — Cinema Kit Continuity Pass. Glides
          between targets via framer's `animate` instead of snapping.
          Same treatment + curve as WorkspaceCoach so the editor and
          lesson tours share one motion grammar. */}
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
