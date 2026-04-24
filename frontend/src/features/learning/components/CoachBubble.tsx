import { useEffect, useId, useRef, type CSSProperties } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { HOUSE_EASE } from "../../../components/cinema/easing";

interface CoachBubbleProps {
  title: string;
  body: string;
  position: "top" | "bottom" | "left" | "right";
  rect: DOMRect;
  onNext: () => void;
  stepLabel: string;
}

const GAP = 12;
const MARGIN = 16;

export function CoachBubble({ title, body, position, rect, onNext, stepLabel }: CoachBubbleProps) {
  // Bubble positioning uses different edge anchors per `position`
  // (top vs bottom for vertical, left vs right for horizontal). An
  // earlier Cinema Kit Continuity Pass tried to animate the
  // bubble's rect across step changes via framer's animate prop,
  // but framer kept stale edge values between steps — a step
  // anchored to `bottom` followed by one anchored to `top` ended
  // up with BOTH set, stretching the bubble into a screen-tall
  // rectangle. Reverted to imperative style; the spotlight glide
  // already gives the eye continuity across steps, and the bubble
  // landing fresh at each new target is fine because the user's
  // attention is on the spotlight as it moves.
  const style: CSSProperties = { position: "fixed", zIndex: 52, maxWidth: 320 };

  if (position === "bottom") {
    style.top = clampV(rect.bottom + GAP);
    style.left = clampH(rect.left + rect.width / 2);
    style.transform = "translateX(-50%)";
  } else if (position === "top") {
    style.bottom = clampV(window.innerHeight - rect.top + GAP);
    style.left = clampH(rect.left + rect.width / 2);
    style.transform = "translateX(-50%)";
  } else if (position === "right") {
    style.top = clampV(rect.top + rect.height / 2);
    style.left = Math.min(rect.right + GAP, window.innerWidth - 320 - MARGIN);
    style.transform = "translateY(-50%)";
  } else {
    style.top = clampV(rect.top + rect.height / 2);
    style.right = Math.max(window.innerWidth - rect.left + GAP, MARGIN);
    style.transform = "translateY(-50%)";
  }

  const titleId = useId();
  const bodyId = useId();
  const nextRef = useRef<HTMLButtonElement>(null);

  // A3/A6: focus the primary button as each coach step paints so keyboard
  // users can press Enter to advance. Keyed off `title` so stepping within a
  // tour re-focuses on each new step without jumping focus mid-interaction.
  useEffect(() => {
    nextRef.current?.focus();
  }, [title]);

  return (
    <div
      style={style}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      className="rounded-xl border border-accent/40 bg-panel p-4 shadow-xl"
    >
      <div className="mb-1 flex items-center justify-between">
        {/* Cinema Kit Continuity Pass — step counter crossfades on
            change so the count itself feels animated alongside the
            spotlight glide. Safe even with the static-styled bubble
            because the animation is local to a single span, no
            cross-step shape interpolation. */}
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={stepLabel}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12, ease: HOUSE_EASE }}
            className="text-[10px] font-medium uppercase tracking-wider text-accent"
          >
            {stepLabel}
          </motion.span>
        </AnimatePresence>
      </div>
      <h3 id={titleId} className="text-sm font-bold text-ink">{title}</h3>
      <p id={bodyId} className="mt-1 text-xs leading-relaxed text-muted">{body}</p>
      <button
        ref={nextRef}
        onClick={onNext}
        className="mt-3 w-full rounded-lg bg-accent px-4 py-1.5 text-xs font-semibold text-bg transition hover:bg-accent/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        Got it
      </button>
    </div>
  );
}

function clampV(v: number): number {
  // Assume bubble is ~200px tall but cap reserve to half of viewport so that
  // short landscape phone viewports (e.g. 360px) still allow positioning.
  const reserve = Math.min(200, Math.floor(window.innerHeight / 2));
  const maxTop = Math.max(MARGIN, window.innerHeight - reserve);
  return Math.max(MARGIN, Math.min(v, maxTop));
}

function clampH(v: number): number {
  // Bubble is ~320px wide; on narrow screens fall back to small horizontal margin.
  const halfWidth = Math.min(160, Math.floor(window.innerWidth / 2) - MARGIN);
  const minLeft = MARGIN + Math.max(0, halfWidth);
  const maxLeft = Math.max(minLeft, window.innerWidth - halfWidth - MARGIN);
  return Math.max(minLeft, Math.min(v, maxLeft));
}
