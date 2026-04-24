import { useEffect, useState, type RefObject } from "react";
import { motion } from "framer-motion";

interface Props {
  targetRef: RefObject<HTMLElement | null>;
  active: boolean;
  /** Small variant paints a thin ring (good for a button). Large variant
   *  paints a ring + outer glow (good for a whole panel). */
  size?: "small" | "large";
}

// Pulsing spotlight overlay used during the first-run scripted
// choreography to draw the learner's eye to whatever surface the tutor
// is currently narrating about — tutor panel while scripted turns
// type in, the Run button just before auto-click, and so on.
//
// Intentionally thinner than WorkspaceCoach's full-backdrop spotlight:
// no click blocker, no darkening of the rest of the UI, just a glow
// the eye catches from the peripheral field. The product is still
// running; this is an accent, not a takeover.
export function FirstRunSpotlight({ targetRef, active, size = "large" }: Props) {
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (!active) {
      setRect(null);
      return;
    }
    const read = () => {
      const el = targetRef.current;
      if (!el) {
        setRect(null);
        return;
      }
      setRect(el.getBoundingClientRect());
    };
    read();
    // Panel/button positions can shift on resize, split-pane drag, or the
    // tutor panel crossfading between states mid-stream; re-measure on a
    // low-frequency poll instead of wiring a MutationObserver tree that
    // would be hard to reason about.
    const poll = window.setInterval(read, 400);
    window.addEventListener("resize", read);
    window.addEventListener("scroll", read, true);
    return () => {
      window.clearInterval(poll);
      window.removeEventListener("resize", read);
      window.removeEventListener("scroll", read, true);
    };
  }, [active, targetRef]);

  if (!active || !rect) return null;

  const pad = size === "small" ? 4 : 6;
  const ringWidth = size === "small" ? 2 : 2;
  const glow = size === "small" ? "0 0 16px" : "0 0 36px";

  return (
    <motion.div
      aria-hidden="true"
      initial={{ opacity: 0 }}
      animate={{ opacity: [0.55, 1, 0.55] }}
      transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
      style={{
        position: "fixed",
        top: rect.top - pad,
        left: rect.left - pad,
        width: rect.width + pad * 2,
        height: rect.height + pad * 2,
        borderRadius: 10,
        pointerEvents: "none",
        boxShadow: `inset 0 0 0 ${ringWidth}px rgb(var(--color-accent) / 0.95), ${glow} rgb(var(--color-accent) / 0.55)`,
        zIndex: 40,
      }}
    />
  );
}
