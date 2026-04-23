import { useEffect, useRef, useState } from "react";
import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
  useTransform,
} from "framer-motion";
import { AmbientGlyphField } from "../components/AmbientGlyphField";

// Shared loader shown during the auth-resolve → store-hydrate sequence.
// RequireAuth renders it first (waiting for `useAuthStore.loading`); the
// HydrationGate renders the same component while the three user-scoped
// stores hydrate. Keeping the DOM identical across that hand-off prevents
// the 150-300ms visual flicker we'd otherwise get from swapping one
// skeleton for another.
//
// Visual choreography ("big reveal" pass):
//
//   ENTER (mount):
//    - Backdrop fades in with breathing radial gradients
//    - Big-bang ring expands once from dead center
//    - Constellation of code glyphs drifts upward in the backdrop
//    - Three ripple rings pulse outward in a staggered loop
//    - Three orbiting dots circle at different radii / periods
//    - Progress ring wraps the badge (determinate fill or indeterminate spin)
//    - Badge scales in with a spring overshoot
//    - Label fades up; detail crossfades on change
//
//   EXIT (when parent is ready + min duration elapsed):
//    - Ripples fire one final big expansion and fade
//    - Orbits accelerate outward and fade off their rings
//    - Badge zooms toward camera (scale 1.4) and fades
//    - Backdrop + glyphs fade
//    - Label fades up and out
//    - onMinDurationReached fires at the END of the exit — parent waits
//      for this signal before unmounting so the reveal plays in full.
//
// Accessibility: framer-motion honors `prefers-reduced-motion` — every
// transition short-circuits to 0ms when the OS flag is set. role +
// aria-live behaviour is identical to previous versions.

const MIN_VISIBLE_MS = 6_000;
const EXIT_DURATION_MS = 900;

// Cycle the headline through a few reassuring phases during the
// minimum-visible window. Beats a static "Setting up your workspace"
// that sits untouched for 4 seconds — pairs the time-based progress
// sweep with a matching sequence of narrative beats so the wait feels
// intentional rather than padded. Each phase dwells ~900ms, with a
// crossfade between them.
const HEADLINE_PHASES = [
  "Setting up your workspace",
  "Loading your progress",
  "Almost ready",
];
const HEADLINE_INTERVAL_MS = Math.floor(MIN_VISIBLE_MS / HEADLINE_PHASES.length);

export interface AuthLoaderProps {
  label?: string;
  testId?: string;
  // 0..1. Caller computes: (# of dependencies finished) / (# total).
  progress?: number;
  enforceMinDuration?: boolean;
  done?: boolean;
  onMinDurationReached?: () => void;
}

export function AuthLoader({
  // If caller passes an explicit label, we honor it and skip the
  // cycling phases. Default undefined triggers the cycling flow.
  label,
  testId = "auth-loader",
  progress,
  enforceMinDuration = true,
  done = false,
  onMinDurationReached,
}: AuthLoaderProps) {
  const [minElapsed, setMinElapsed] = useState(!enforceMinDuration);
  const [exitDone, setExitDone] = useState(false);
  const [phaseIndex, setPhaseIndex] = useState(0);

  const onMinRef = useRef(onMinDurationReached);
  useEffect(() => {
    onMinRef.current = onMinDurationReached;
  }, [onMinDurationReached]);

  // Cycle the headline through HEADLINE_PHASES unless the caller passed
  // an explicit `label`. Stops at the last phase — we don't loop, because
  // the loader should resolve well before we'd wrap around. Interval
  // aligns with MIN_VISIBLE_MS so the final phase lands right as the
  // exit is about to play.
  useEffect(() => {
    if (label) return;
    const interval = window.setInterval(() => {
      setPhaseIndex((i) => Math.min(i + 1, HEADLINE_PHASES.length - 1));
    }, HEADLINE_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [label]);
  const currentHeadline = label ?? HEADLINE_PHASES[phaseIndex];

  // MIN_VISIBLE_MS floor. Expires the min-visible timer; signalling the
  // parent to unmount happens LATER, at the end of the exit animation.
  useEffect(() => {
    if (!enforceMinDuration) return;
    const t = window.setTimeout(() => setMinElapsed(true), MIN_VISIBLE_MS);
    return () => window.clearTimeout(t);
  }, [enforceMinDuration]);

  // Exit gates on both parent-ready AND min-visible elapsed. Once true,
  // the component plays its exit variants; at the end we fire
  // onMinDurationReached so the parent can unmount.
  const exiting = done && minElapsed;

  useEffect(() => {
    if (!exiting || exitDone) return;
    const t = window.setTimeout(() => {
      setExitDone(true);
      onMinRef.current?.();
    }, EXIT_DURATION_MS);
    return () => window.clearTimeout(t);
  }, [exiting, exitDone]);

  const hasProgress = typeof progress === "number";
  const displayedPct = hasProgress
    ? Math.max(8, Math.min(100, Math.round(progress! * 100)))
    : 0;

  const RING_SIZE = 152;
  const RING_STROKE = 5;
  const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
  const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

  // Two motion values drive the displayed progress:
  //   actualMV — follows the `progress` prop as it arrives (animated, so
  //     sudden jumps don't flicker the ring)
  //   timeMV — sweeps 0→1 over MIN_VISIBLE_MS linearly on mount
  // Displayed = min(actualMV, timeMV) so whichever is SLOWER constrains
  // the bar. If hydrate finishes in 200ms (actualMV = 1 quickly), the ring
  // still paces at the linear time sweep and reaches full right as the
  // loader is ready to exit. If hydrate is slow (actualMV < 1 when timeMV
  // hits 1), the ring follows actualMV. No more "ring full, user stares
  // at static bar waiting for min duration."
  const actualMV = useMotionValue(0);
  const timeMV = useMotionValue(0);
  const displayedMV = useTransform<number, number>(
    [actualMV, timeMV],
    ([a, t]) => Math.min(a, t),
  );
  const dashOffset = useTransform(
    displayedMV,
    (v) => RING_CIRCUMFERENCE * (1 - v),
  );
  const pctLabel = useTransform(displayedMV, (v) => `${Math.round(v * 100)}%`);

  // Start the time sweep once on mount. Linear so the bar feels like a
  // steady progression, not an ease-out that decelerates into a wait.
  useEffect(() => {
    const controls = animate(timeMV, 1, {
      duration: MIN_VISIBLE_MS / 1000,
      ease: "linear",
    });
    return controls.stop;
  }, [timeMV]);

  // Track the actual progress prop. Motion keeps transitions smooth when
  // HydrationGate flips a step complete (e.g., 0.25 → 0.5).
  useEffect(() => {
    if (!hasProgress) return;
    const controls = animate(actualMV, displayedPct / 100, {
      duration: 0.4,
      ease: [0.22, 1, 0.36, 1],
    });
    return controls.stop;
  }, [displayedPct, hasProgress, actualMV]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={
        exiting ? { opacity: 0, scale: 1.03 } : { opacity: 1, scale: 1 }
      }
      transition={{
        duration: exiting ? EXIT_DURATION_MS / 1000 : 0.35,
        ease: [0.22, 1, 0.36, 1],
      }}
      className="relative flex h-full min-h-[320px] items-center justify-center overflow-hidden bg-bg text-ink"
      role="status"
      aria-live="polite"
      aria-busy={!done}
      data-testid={testId}
    >
      {/* Backdrop — twin radial gradients that breathe slowly. */}
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at 20% 20%, rgb(var(--color-accent) / 0.22), transparent 55%), radial-gradient(circle at 80% 60%, rgb(var(--color-violet) / 0.18), transparent 60%)",
        }}
        animate={exiting ? { opacity: 0 } : { opacity: [0.6, 1, 0.6] }}
        transition={
          exiting
            ? { duration: 0.6 }
            : { duration: 6, repeat: Infinity, ease: "easeInOut" }
        }
      />

      {/* Floating code glyphs drifting upward — atmospheric. Uses the
          shared AmbientGlyphField; hero density + /25 opacity for the
          reveal moment (content pages use /12). Framer fades the parent
          motion.div's opacity on exit, which dims these along with it
          — no separate exit animation needed. */}
      <AmbientGlyphField density="hero" opacityClass="text-accent/25" />

      {/* Big-bang ring — one-shot expansion from dead center on mount.
          Cheap dramatic punctuation for the reveal, fires once. */}
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/2 rounded-full border-2 border-accent/60"
        style={{ width: 24, height: 24, marginLeft: -12, marginTop: -12 }}
        initial={{ scale: 0, opacity: 0.8 }}
        animate={{ scale: 28, opacity: 0 }}
        transition={{ duration: 1.6, ease: [0.22, 1, 0.36, 1] }}
      />

      <div className="relative z-10 flex w-full max-w-xs flex-col items-center gap-7">
        {/* Badge cluster: progress ring + ripples + orbits + badge. */}
        <motion.div
          className="relative flex items-center justify-center"
          style={{ width: RING_SIZE, height: RING_SIZE }}
          animate={
            exiting ? { scale: 1.1, opacity: 0 } : { scale: 1, opacity: 1 }
          }
          transition={{
            duration: exiting ? 0.55 : 0.3,
            ease: [0.22, 1, 0.36, 1],
          }}
        >
          {/* Ripple rings — three staggered pulses outward. On exit,
              one big final expansion + fade. */}
          {[0, 0.8, 1.6].map((delay, i) => (
            <motion.span
              key={i}
              className="absolute inset-0 rounded-full border border-accent/40"
              initial={{ scale: 0.55, opacity: 0.8 }}
              animate={
                exiting
                  ? { scale: 2.4, opacity: 0 }
                  : { scale: 1.25, opacity: 0 }
              }
              transition={
                exiting
                  ? { duration: 0.6, ease: "easeOut", delay: i * 0.05 }
                  : {
                      duration: 2.4,
                      delay,
                      repeat: Infinity,
                      ease: "easeOut",
                    }
              }
              aria-hidden="true"
            />
          ))}

          {/* Progress ring — determinate fills, indeterminate spins. */}
          {hasProgress ? (
            <svg
              width={RING_SIZE}
              height={RING_SIZE}
              viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
              className="absolute inset-0"
              aria-hidden="true"
            >
              {/* Track — translucent accent tint, not solid slate. Reads
                  softer against the gradient backdrop. */}
              <circle
                cx={RING_SIZE / 2}
                cy={RING_SIZE / 2}
                r={RING_RADIUS}
                fill="none"
                stroke="rgb(var(--color-accent) / 0.1)"
                strokeWidth={RING_STROKE}
              />
              {/* Glow layer — wider, translucent, blurred. Sits behind
                  the sharp fill so the fill looks like it's emitting
                  light rather than being drawn on top. */}
              <motion.circle
                cx={RING_SIZE / 2}
                cy={RING_SIZE / 2}
                r={RING_RADIUS}
                fill="none"
                stroke="rgb(var(--color-accent) / 0.4)"
                strokeWidth={RING_STROKE + 3}
                strokeLinecap="round"
                strokeDasharray={RING_CIRCUMFERENCE}
                style={{
                  strokeDashoffset: dashOffset,
                  transformOrigin: "center",
                  transform: "rotate(-90deg)",
                  filter: "blur(4px)",
                }}
              />
              <motion.circle
                cx={RING_SIZE / 2}
                cy={RING_SIZE / 2}
                r={RING_RADIUS}
                fill="none"
                stroke="rgb(var(--color-accent) / 0.9)"
                strokeWidth={RING_STROKE}
                strokeLinecap="round"
                strokeDasharray={RING_CIRCUMFERENCE}
                style={{
                  strokeDashoffset: dashOffset,
                  transformOrigin: "center",
                  transform: "rotate(-90deg)",
                }}
              />
            </svg>
          ) : (
            <motion.svg
              width={RING_SIZE}
              height={RING_SIZE}
              viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
              className="absolute inset-0"
              aria-hidden="true"
              animate={{ rotate: 360 }}
              transition={{ duration: 2.2, repeat: Infinity, ease: "linear" }}
            >
              {/* Soft glow layer behind the indeterminate spinner. */}
              <circle
                cx={RING_SIZE / 2}
                cy={RING_SIZE / 2}
                r={RING_RADIUS}
                fill="none"
                stroke="rgb(var(--color-accent) / 0.4)"
                strokeWidth={RING_STROKE + 3}
                strokeLinecap="round"
                strokeDasharray={`${RING_CIRCUMFERENCE / 3} ${RING_CIRCUMFERENCE}`}
                style={{ filter: "blur(4px)" }}
              />
              <circle
                cx={RING_SIZE / 2}
                cy={RING_SIZE / 2}
                r={RING_RADIUS}
                fill="none"
                stroke="rgb(var(--color-accent) / 0.9)"
                strokeWidth={RING_STROKE}
                strokeLinecap="round"
                strokeDasharray={`${RING_CIRCUMFERENCE / 3} ${RING_CIRCUMFERENCE}`}
              />
            </motion.svg>
          )}

          {/* Orbiting dots — three at different radii. Accelerate + fade outward on exit. */}
          {[
            { radius: RING_RADIUS + 8, duration: 3.6, color: "bg-accent" },
            { radius: RING_RADIUS - 2, duration: 5.2, color: "bg-violet" },
            { radius: RING_RADIUS + 2, duration: 4.4, color: "bg-accent/70" },
          ].map((orbit, i) => (
            <motion.div
              key={i}
              className="absolute inset-0"
              animate={
                exiting
                  ? { rotate: 720, opacity: 0, scale: 1.6 }
                  : { rotate: 360, opacity: 1, scale: 1 }
              }
              transition={
                exiting
                  ? { duration: 0.6, ease: "easeOut" }
                  : {
                      rotate: {
                        duration: orbit.duration,
                        repeat: Infinity,
                        ease: "linear",
                        delay: i * -0.6,
                      },
                    }
              }
              aria-hidden="true"
            >
              <span
                className={`absolute left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full ${orbit.color} shadow-glow`}
                style={{ top: `calc(50% - ${orbit.radius}px - 3px)` }}
              />
            </motion.div>
          ))}

          {/* Badge — scales in spring overshoot, zooms toward camera on exit. */}
          <motion.div
            initial={{ scale: 0.5, opacity: 0, rotate: -8 }}
            animate={
              exiting
                ? { scale: 1.45, opacity: 0, rotate: 0 }
                : { scale: 1, opacity: 1, rotate: 0 }
            }
            transition={
              exiting
                ? { duration: 0.6, ease: [0.22, 1, 0.36, 1] }
                : {
                    scale: {
                      type: "spring",
                      stiffness: 220,
                      damping: 12,
                      delay: 0.15,
                    },
                    opacity: { duration: 0.4, delay: 0.15 },
                    rotate: {
                      type: "spring",
                      stiffness: 200,
                      damping: 14,
                      delay: 0.15,
                    },
                  }
            }
            className="relative flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-accent to-violet text-2xl font-bold text-bg shadow-glow"
          >
            <motion.span
              animate={exiting ? { scale: 1 } : { scale: [1, 1.05, 1] }}
              transition={
                exiting
                  ? { duration: 0.3 }
                  : { duration: 2, repeat: Infinity, ease: "easeInOut" }
              }
            >
              AI
            </motion.span>
          </motion.div>

          {/* Percentage ticker — overlaid below ring in determinate mode. */}
          {hasProgress && (
            <motion.div
              className="pointer-events-none absolute inset-x-0 -bottom-7 text-center"
              animate={exiting ? { opacity: 0, y: -4 } : { opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
            >
              <motion.span
                className="text-[10px] font-semibold tabular-nums text-faint"
                aria-hidden="true"
              >
                {pctLabel}
              </motion.span>
            </motion.div>
          )}
        </motion.div>

        {/* Label block — mt-8 gives the headline proper breathing room
            below the badge cluster. min-w-[360px] breaks out of the
            parent's max-w-xs so text-base phrases fit on one line. */}
        <div className="mt-8 flex min-w-[360px] min-h-[44px] flex-col items-center gap-1.5 text-center">
          {/* Single-motion.p AnimatePresence — keyed on currentHeadline so
              each phase change triggers a clean exit → enter. Headline
              uses the same accent→violet gradient as the badge, clipped
              to the text — sits harmoniously against the gradient backdrop
              instead of stark text-ink. Size trimmed from text-lg to
              text-base for a more refined, less shouty feel. */}
          <div className="relative h-6 w-full overflow-hidden">
            <AnimatePresence mode="wait" initial={false}>
              <motion.p
                key={currentHeadline}
                className="absolute inset-0 whitespace-nowrap bg-gradient-to-r from-accent via-ink to-violet bg-clip-text text-center text-base font-medium tracking-[-0.01em] text-transparent"
                style={{ fontFeatureSettings: '"ss01", "cv11"' }}
                initial={{ opacity: 0, y: 10, filter: "blur(4px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: -10, filter: "blur(4px)" }}
                transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
              >
                {currentHeadline}
              </motion.p>
            </AnimatePresence>
          </div>
          {/* `detail` line removed — HydrationGate passes it with the
              hydrate step name ("Loading your progress…") which duplicates
              the cycling HEADLINE_PHASES above and was stacking as a
              second, smaller headline. If a future caller needs a
              sub-label that's distinct from the headline, re-add with
              an explicit `subdetail` prop rather than re-piping `detail`. */}
        </div>
      </div>
    </motion.div>
  );
}
