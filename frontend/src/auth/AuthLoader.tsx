import { useEffect, useRef, useState } from "react";
import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
  useTransform,
} from "framer-motion";
import { AmbientGlyphField } from "../components/AmbientGlyphField";
import { Wordmark } from "../components/Wordmark";

// Shared loader shown during the auth-resolve → store-hydrate sequence.
// RequireAuth renders it first (waiting for `useAuthStore.loading`); the
// HydrationGate renders the same component while the three user-scoped
// stores hydrate. Keeping the DOM identical across that hand-off prevents
// the 150-300ms visual flicker we'd otherwise get from swapping one
// skeleton for another.
//
// Visual choreography (trimmed pass, post-review):
//
//   ENTER (mount):
//    - Backdrop fades in with breathing radial gradients
//    - Big-bang ring expands once from dead center
//    - Ambient code glyphs drift upward in the backdrop (hero density)
//    - Progress ring wraps the badge (determinate fill or indeterminate spin)
//    - Badge scales in with a spring overshoot (one-shot, no loop)
//    - Headline cycles through two phases (blur-crossfade)
//
//   EXIT (when parent is ready + min duration elapsed):
//    - Badge zooms toward camera (scale 1.45) and fades
//    - Backdrop + glyphs fade with the parent opacity
//    - onMinDurationReached fires at the END of the exit — parent waits
//      for this signal before unmounting so the reveal plays in full.
//
// Previous revisions layered ripples, orbiting dots, and an infinite
// badge pulse on top of the above. Review feedback: eight simultaneous
// motion elements read as a demo reel, not a loader. Keeping the four
// that serve a purpose (hero feel, progress encoding, headline copy,
// orchestrated exit); dropping the decoration.
//
// Accessibility: framer-motion honors `prefers-reduced-motion` — every
// transition short-circuits to 0ms when the OS flag is set. role +
// aria-live behaviour is identical to previous versions.

// Fast hydrate shouldn't pay a 6s tax. 1.8s is enough for the big-bang
// ring + badge spring + two headline phases to play; a quick hydrate
// exits right as the second phase settles.
const MIN_VISIBLE_MS = 2_500;
const EXIT_DURATION_MS = 600;

// Two phases — first frames the wait, second signals imminent resolution.
// Blur-crossfade between them over MIN_VISIBLE_MS / 2 (~900ms dwell).
const HEADLINE_PHASES = [
  "Setting up your workspace",
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
  //
  // The effect also handles a *mid-life* flip of `enforceMinDuration`
  // from true → false. HydrationGate drops the floor for the first-run
  // path AFTER prefs hydrate (it can't know until then whether the
  // user is heading to /welcome). Without this flip-to-true handler,
  // `minElapsed` would stay false and the loader would never yield.
  useEffect(() => {
    if (!enforceMinDuration) {
      setMinElapsed(true);
      return;
    }
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
        {/* Badge cluster: progress ring + badge. */}
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

          {/* Ring center — determinate mode shows the pct readout; indeterminate
              mode leaves the center empty so the spinning track carries the
              attention on its own. Brand identity lives in the Wordmark
              BELOW the ring (consistent with every other surface), not
              inside it — putting a wordmark inside a circle never fits
              geometrically and a monogram-in-a-circle was review-flagged
              as Figma placeholder energy. */}
          {hasProgress && (
            <motion.div
              className="pointer-events-none absolute inset-0 flex items-center justify-center"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={
                exiting ? { opacity: 0, scale: 1.05 } : { opacity: 1, scale: 1 }
              }
              transition={{
                duration: exiting ? 0.35 : 0.4,
                delay: exiting ? 0 : 0.2,
                ease: [0.22, 1, 0.36, 1],
              }}
            >
              <motion.span
                className="text-[32px] font-semibold tabular-nums leading-none tracking-tight text-ink"
                aria-hidden="true"
              >
                {pctLabel}
              </motion.span>
            </motion.div>
          )}
        </motion.div>

        {/* Wordmark — the single brand anchor, consistent with the
            sizing + treatment used on all authenticated page headers. */}
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={
            exiting ? { opacity: 0, y: -4 } : { opacity: 1, y: 0 }
          }
          transition={{
            duration: exiting ? 0.35 : 0.45,
            delay: exiting ? 0 : 0.25,
            ease: [0.22, 1, 0.36, 1],
          }}
        >
          <Wordmark size="lg" />
        </motion.div>

        {/* Label block — mt-8 gives the headline proper breathing room
            below the badge cluster. min-w-[360px] breaks out of the
            parent's max-w-xs so text-base phrases fit on one line. */}
        <div className="mt-8 flex min-w-[360px] min-h-[44px] flex-col items-center gap-1.5 text-center">
          {/* Single-motion.p AnimatePresence — keyed on currentHeadline so
              each phase change triggers a clean exit → enter. Plain ink
              color (the gradient is reserved for intentional emphasis
              only — review note). The blur-crossfade carries the
              attention. */}
          <div className="relative h-6 w-full overflow-hidden">
            <AnimatePresence mode="wait" initial={false}>
              <motion.p
                key={currentHeadline}
                className="absolute inset-0 whitespace-nowrap text-center text-base font-medium tracking-[-0.01em] text-ink"
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
