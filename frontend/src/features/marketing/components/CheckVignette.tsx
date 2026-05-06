import { useEffect, useRef, useState } from "react";
import { motion, useInView, useReducedMotion } from "framer-motion";
import { HOUSE_EASE } from "../../../components/cinema/easing";

// Phase 22C — Beat ③ "Check." vignette.
//
// 3-second motion when the panel scrolls into view:
//   t=0     code line + run-button row appears
//   t=0.4   button "presses" (subtle scale-down + spring back)
//   t=0.8   output line streams in (success-green text)
//   t=1.6   mastery ring strokes in (stroke-dashoffset 0 → 100%)
//   t=2.4   subtle glow pulses on the ring once
//
// Story arc: the hero asked "Why does this fail when points is 100?"
// This vignette runs the FIXED line — `str(points)` converts the int
// to a string so `+` can concatenate cleanly — and prints the
// expected greeting. The marketing page reads as one continuous
// story: stuck → tutor asks → solved.
//
// The mastery ring is a stripped-down version of the SharePage's
// MasteryRing primitive — same geometry + stroke-dasharray reveal,
// scoped to a smaller size. Reduced-motion renders the final state.

const CALL_ARG = "message";
const OUTPUT_LINE = "→ Maya earned 100 points!";

export function CheckVignette() {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "0px 0px -10% 0px" });

  const [stage, setStage] = useState<
    "idle" | "press" | "output" | "ring" | "done"
  >(reduce ? "done" : "idle");

  useEffect(() => {
    if (reduce || !inView) return;
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    timers.push(setTimeout(() => !cancelled && setStage("press"), 400));
    timers.push(setTimeout(() => !cancelled && setStage("output"), 800));
    timers.push(setTimeout(() => !cancelled && setStage("ring"), 1600));
    timers.push(setTimeout(() => !cancelled && setStage("done"), 2400));
    return () => {
      cancelled = true;
      timers.forEach((t) => clearTimeout(t));
    };
  }, [inView, reduce]);

  const showOutput =
    stage === "output" || stage === "ring" || stage === "done";
  const showRing = stage === "ring" || stage === "done";

  return (
    <div ref={ref} className="grid grid-cols-1 gap-5 sm:grid-cols-[1fr_auto] sm:items-center sm:gap-6">
      {/* Code + output column. Same JetBrains Mono palette as the
          ReadVignette — visual continuity across beats. The line shows
          the print() call that runs cleanly once str(points) is in
          place above. */}
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <div className="flex-1 rounded-lg border border-border-soft/70 bg-bg/60 px-3 py-2 font-mono text-[13.5px] leading-[1.6] text-ink/90 sm:text-[14.5px]">
            <span style={{ color: "rgb(192 132 252)" }}>print</span>
            <span style={{ color: "rgba(148 163 184 / 0.85)" }}>(</span>
            <span style={{ color: "rgba(230 236 245 / 0.92)" }}>{CALL_ARG}</span>
            <span style={{ color: "rgba(148 163 184 / 0.85)" }}>)</span>
          </div>
          <RunButton stage={stage} />
        </div>

        <motion.div
          initial={reduce ? undefined : { opacity: 0, y: 4 }}
          animate={
            showOutput ? { opacity: 1, y: 0 } : { opacity: 0, y: 4 }
          }
          transition={{ duration: 0.4, ease: HOUSE_EASE }}
          className="flex items-center gap-2 font-mono text-[13.5px] leading-[1.6] sm:text-[14.5px]"
        >
          {/* Success check — quiet confirmation that the fixed input passes. */}
          <span
            aria-hidden="true"
            className="flex h-4 w-4 items-center justify-center rounded-full bg-success/20 text-[10px] font-bold text-success"
          >
            ✓
          </span>
          <span style={{ color: "rgb(52 211 153)" }}>{OUTPUT_LINE}</span>
          <span className="text-faint text-[12px] italic sm:text-[12.5px]">
            with the type fixed
          </span>
        </motion.div>
      </div>

      {/* Mastery ring — fixed-size SVG stroke-in. */}
      <div className="flex items-center justify-center pt-2 sm:pt-0">
        <MasteryRingMini active={showRing} reduce={reduce ?? false} />
      </div>
    </div>
  );
}

function RunButton({ stage }: { stage: string }) {
  const pressed = stage === "press";
  return (
    <motion.div
      animate={pressed ? { scale: 0.94 } : { scale: 1 }}
      transition={{ duration: 0.18, ease: HOUSE_EASE }}
      className="select-none rounded-md bg-success/85 px-3 py-1.5 text-[11px] font-semibold text-bg shadow-[0_2px_0_rgba(0,0,0,0.18)]"
    >
      Run
    </motion.div>
  );
}

function MasteryRingMini({ active, reduce }: { active: boolean; reduce: boolean }) {
  const r = 38;
  const stroke = 6;
  const c = 2 * Math.PI * r;

  return (
    <svg width="92" height="92" viewBox="0 0 92 92" aria-hidden="true">
      {/* Track. */}
      <circle
        cx="46"
        cy="46"
        r={r}
        fill="none"
        stroke="rgba(148 163 184 / 0.18)"
        strokeWidth={stroke}
      />
      {/* Fill — strokes in via stroke-dashoffset. */}
      <motion.circle
        cx="46"
        cy="46"
        r={r}
        fill="none"
        stroke="url(#mr-grad)"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        initial={reduce ? false : { strokeDashoffset: c }}
        animate={
          active || reduce ? { strokeDashoffset: 0 } : { strokeDashoffset: c }
        }
        transition={{ duration: reduce ? 0 : 0.9, ease: HOUSE_EASE }}
        transform="rotate(-90 46 46)"
      />
      {/* Center mark — a thin checkmark that lands once the ring is full. */}
      <motion.path
        d="M30 47 L42 58 L62 36"
        fill="none"
        stroke="rgb(52 211 153)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={reduce ? false : { pathLength: 0, opacity: 0 }}
        animate={
          active || reduce ? { pathLength: 1, opacity: 1 } : { pathLength: 0, opacity: 0 }
        }
        transition={{
          duration: reduce ? 0 : 0.5,
          delay: reduce ? 0 : 0.6,
          ease: HOUSE_EASE,
        }}
      />
      <defs>
        <linearGradient id="mr-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="rgb(52 211 153)" />
          <stop offset="0.5" stopColor="rgb(56 189 248)" />
          <stop offset="1" stopColor="rgb(192 132 252)" />
        </linearGradient>
      </defs>
    </svg>
  );
}
