import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";
import { MATERIAL_EASE, CINEMA_DURATIONS } from "./easing";

// Cinema Kit — RingPulse.
//
// THE through-line primitive. The shape the learner saw at the end of
// the cinematic (an expanding ring around their name) reappears at
// every compound moment: tiny on each Run click, medium on first-
// successful-run, large sonar before lesson-pass confetti. Same shape,
// same ease curve, different scale + color. Deja vu by design.
//
// `rings={1}` = single expanding circle (baseline).
// `rings={3}` = sonar: three staggered circles (80 ms apart, scaling
//   to 60%/80%/100% of `maxScale`). Reads as "pulse, pulse, pulse"
//   rather than "one big expand."
//
// `anchor="self"` (default) centers the ring in the nearest positioned
// ancestor — caller wraps the target in `position: relative`. This is
// what lets the cinematic center it on the hero name. `anchor="viewport"`
// is escape-hatch for surfaces that can't have a relative wrapper.
//
// `replayKey` is a consumer-controlled lifecycle signal: change its
// value to tear down + remount the component, replaying the
// animation. Same trick as React's `key` prop, exposed for callers
// that don't want to manage React `key` themselves.
//
// Reduced-motion collapses to a 120 ms opacity flash — still signals
// "something happened" without the radial expansion that can trigger
// vestibular sensitivity.

export interface RingPulseProps {
  anchor?: "self" | "viewport";
  rings?: 1 | 3;
  /** Target scale for the outermost ring. 40 fills a hero, 8 fits
   *  a button, 12 works over a panel. */
  maxScale?: number;
  /** Tailwind border class. Default `border-accent/60`. Pick shade
   *  that makes sense on the surface — violet for Check, success for
   *  run-pass, accent for generic. */
  borderClass?: string;
  /** Wait this many ms after mount before the ring starts. */
  delayMs?: number;
  /** Fires once the last ring has completed. */
  onDone?: () => void;
  /** Bump to replay the animation without remounting the parent. */
  replayKey?: number | string;
  /** "expand" (default): scale 0 → maxScale, the natural pulse out
   *  from the anchor. "contract": scale maxScale → 0, the inverse —
   *  ring starts large, contracts inward. Used for match-cut
   *  handoffs (cinematic exit's expanding ring continues into the
   *  lesson page as a contracting ring landing on the Run button). */
  direction?: "expand" | "contract";
}

interface SingleRingProps {
  maxScale: number;
  borderClass: string;
  delayMs: number;
  anchor: "self" | "viewport";
  direction: "expand" | "contract";
}

function SingleRing({
  maxScale,
  borderClass,
  delayMs,
  anchor,
  direction,
}: SingleRingProps) {
  const anchorClass =
    anchor === "viewport"
      ? "fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
      : "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2";
  const initialScale = direction === "expand" ? 0 : maxScale;
  const finalScale = direction === "expand" ? maxScale : 0;
  // Opacity arc is symmetric — fade in fast, fade out slow — which
  // reads the same forwards or backwards. Same MATERIAL_EASE on
  // scale gives the contracting ring the same kinetic feel as the
  // expanding one.
  return (
    <motion.div
      aria-hidden="true"
      className={`pointer-events-none ${anchorClass} h-6 w-6 rounded-full border-2 ${borderClass}`}
      initial={{ scale: initialScale, opacity: 0 }}
      animate={{ scale: finalScale, opacity: [0, 0.8, 0] }}
      transition={{
        duration: CINEMA_DURATIONS.ringPulse / 1000,
        delay: delayMs / 1000,
        ease: MATERIAL_EASE,
        times: [0, 0.2, 1],
      }}
    />
  );
}

function ReducedFlash({
  borderClass,
  anchor,
}: {
  borderClass: string;
  anchor: "self" | "viewport";
}) {
  const anchorClass =
    anchor === "viewport"
      ? "fixed inset-0"
      : "absolute inset-0";
  return (
    <motion.div
      aria-hidden="true"
      className={`pointer-events-none ${anchorClass} rounded-md ${borderClass} border-2`}
      initial={{ opacity: 0 }}
      animate={{ opacity: [0, 0.6, 0] }}
      transition={{ duration: 0.12, times: [0, 0.5, 1] }}
    />
  );
}

export function RingPulse({
  anchor = "self",
  rings = 1,
  maxScale = 40,
  borderClass = "border-accent/60",
  delayMs = 0,
  onDone,
  replayKey,
  direction = "expand",
}: RingPulseProps) {
  const reduce = useReducedMotion();
  // Gate the onDone callback on the internal lifecycle so parents can
  // unmount us cleanly after the animation completes.
  const [done, setDone] = useState(false);

  useEffect(() => {
    setDone(false);
    const totalMs = reduce
      ? 120
      : delayMs + CINEMA_DURATIONS.ringPulse + (rings === 3 ? 160 : 0);
    const t = window.setTimeout(() => {
      setDone(true);
      onDone?.();
    }, totalMs);
    return () => window.clearTimeout(t);
    // replayKey is the explicit "restart" signal; including onDone
    // would cause spurious re-runs if the parent recreates the
    // callback on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replayKey, reduce, rings, delayMs, maxScale]);

  if (done) return null;

  if (reduce) {
    return <ReducedFlash borderClass={borderClass} anchor={anchor} />;
  }

  if (rings === 1) {
    return (
      <SingleRing
        maxScale={maxScale}
        borderClass={borderClass}
        delayMs={delayMs}
        anchor={anchor}
        direction={direction}
      />
    );
  }

  // rings === 3 — sonar. Staggered 0 / 80 / 160 ms, scaling 60% / 80% / 100%.
  return (
    <>
      <SingleRing
        maxScale={maxScale * 0.6}
        borderClass={borderClass}
        delayMs={delayMs}
        anchor={anchor}
        direction={direction}
      />
      <SingleRing
        maxScale={maxScale * 0.8}
        borderClass={borderClass}
        delayMs={delayMs + 80}
        anchor={anchor}
        direction={direction}
      />
      <SingleRing
        maxScale={maxScale}
        borderClass={borderClass}
        delayMs={delayMs + 160}
        anchor={anchor}
        direction={direction}
      />
    </>
  );
}
