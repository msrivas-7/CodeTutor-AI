import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion, AnimatePresence } from "framer-motion";
import { AmbientGlyphField } from "../../components/AmbientGlyphField";

// The product's opening credits. Two modes:
//
//   `full` — the first-run cinematic. Seven beats, ~5.2 s. Used once,
//            after signup, at /welcome. The hero moment is a line of
//            Python executing and the user's name materializing as
//            its stdout — the product thesis in motion.
//
//   `minimal` — the daily welcome-back heartbeat. Four beats, ~2.4 s.
//             Shown over the dashboard on first qualifying visit of
//             the day. No code-execution preamble; the user knows
//             what the product does.
//
// The same component services both so the two can't drift. Props
// control the length, the beats that play, and the copy.

const HOUSE_EASE = [0.22, 1, 0.36, 1] as const;
const MATERIAL_EASE = [0.4, 0, 0.2, 1] as const;

export type CinematicMode = "full" | "minimal";

export interface CinematicGreetingProps {
  mode: CinematicMode;
  /** Name goes straight into the hero line. Pre-resolved by caller via
   * resolveFirstName — the greeting stays dumb. */
  firstName: string;
  /** Full mode: the user's first visit — hero is "Hi, {name}!".
   *  Minimal mode: returning learner — hero is "Welcome back, {name}." */
  heroLine: string;
  /** Sits below the hero in both modes. In full mode, arrives in Beat 5.
   *  In minimal mode, arrives in Beat C. */
  subtitle: string;
  /** Only used in full mode — the "Starting your first lesson…" line
   *  that lands in Beat 6. Ignored for minimal. */
  supportLine?: string;
  /**
   * Fires when the whole cinematic has finished dissolving. Caller owns
   * the subsequent navigation (first-run → lesson; welcome-back →
   * unmount overlay). Stays wired up even when `mode` is `minimal` so
   * both paths share the exit contract.
   */
  onComplete: () => void;
  /**
   * Allow skipping the cinematic. Caller passes a handler that dismisses
   * + persists whatever flag the caller cares about (welcomeDone,
   * lastWelcomeBackAt). We only render the affordance; state is theirs.
   */
  onSkip?: () => void;
}

// ---- timing manifests (ms from start) ----------------------------------

interface Beat {
  enter: number;
  duration: number;
}

// Timings are slow by design. A cinematic moment needs to BREATHE —
// first impressions of a product are a feeling, not a tour. Think
// Hollywood director: the scene lingers long enough for the emotion
// to LAND, not so long it becomes boring. Each beat has its own
// earned duration. Skip link always one click away for impatient
// users. Total arc: ~13.2 s.
const FULL_TIMELINE = {
  // Beat 1: stillness. The stage lights coming up. Slow rise, not rushed.
  radialGlow: { enter: 0, duration: 1400 } as Beat,
  // Beat 2: the cursor materializes and holds — anticipation.
  codeCaret: { enter: 800, duration: 1100 } as Beat,
  // Beat 3: code types character-by-character.
  // 110 ms/char × ~30 chars ≈ 3.3 s — deliberate, someone typing
  // thoughtfully, not racing. Each keystroke registers.
  codeType: { enter: 1400, duration: 3300 } as Beat,
  // Beat 4: hold. The line sits, the user reads it. 1.2 s of "this is code."
  codePause: { enter: 4700, duration: 1200 } as Beat,
  // Beat 5: flash. "It just ran." Longer so the glow registers.
  codeFlash: { enter: 5900, duration: 700 } as Beat,
  // Beat 6: settle upward to caption. Camera pulling back.
  codeSettleCaption: { enter: 6400, duration: 900 } as Beat,
  // Beat 7: the hero name materializes. 140 ms/char for dramatic cadence.
  heroType: { enter: 7300, duration: 2000 } as Beat,
  // Beat 8: glow bursts outward behind the name as it lands.
  heroGlow: { enter: 8200, duration: 1300 } as Beat,
  // Beat 9: HOLD. The name sits. This is THE moment. 1.5 s of stillness.
  heroHold: { enter: 9400, duration: 1500 } as Beat,
  // Beat 10: subtitle rises. Long enough to read + feel the meaning.
  subtitle: { enter: 10400, duration: 1300 } as Beat,
  // Beat 11: environment awakens. Glyphs drift in from edges.
  environment: { enter: 11500, duration: 1200 } as Beat,
  // Beat 12: support line. Quiet handoff.
  supportLine: { enter: 12200, duration: 700 } as Beat,
  // Beat 13: ring chime + push-forward. Larger chime duration.
  ringPulse: { enter: 13100, duration: 1000 } as Beat,
  exitBlur: { enter: 13700, duration: 500 } as Beat,
  // Total: onComplete fires at 14200 ms.
  total: 14200,
};

// Welcome-back compressed arc. 4.3 s → 5.3 s — a daily heartbeat
// that still feels intentional. The hero sits on screen long enough
// to register as "good to see you" not as a notification toast.
const MINIMAL_TIMELINE = {
  radialGlow: { enter: 0, duration: 900 } as Beat,
  heroType: { enter: 800, duration: 2000 } as Beat, // 115 ms/char for "Welcome back, Name." (~18 chars)
  heroHold: { enter: 2800, duration: 800 } as Beat,
  subtitle: { enter: 3500, duration: 1200 } as Beat,
  exitFade: { enter: 4700, duration: 600 } as Beat,
  total: 5300,
};

// Sample dynamic code line for Beat 2. Keeping it string-concatenated
// instead of pulled from a template so the REPL prompt reads as
// monospaced-visual-design, not "i18n copy we forgot to localize."
const CODE_LINE = '>>> print(f"Hi, {learner.name}!")';

export function CinematicGreeting(props: CinematicGreetingProps) {
  const reduce = useReducedMotion();
  const [exiting, setExiting] = useState(false);
  const completeFiredRef = useRef(false);

  const total = props.mode === "full" ? FULL_TIMELINE.total : MINIMAL_TIMELINE.total;

  // onComplete fires after the full timeline regardless of mode. Guard
  // against double-fire (react strict-mode double-mount in dev).
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (completeFiredRef.current) return;
      completeFiredRef.current = true;
      setExiting(true);
      // Allow the exit blur / fade to breathe before unmounting.
      const exitMs = props.mode === "full" ? 300 : 400;
      window.setTimeout(props.onComplete, exitMs);
    }, total);
    return () => window.clearTimeout(t);
  }, [total, props.mode, props.onComplete]);

  // Esc listener — same dismiss as the Skip link.
  useEffect(() => {
    if (!props.onSkip) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onSkip?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props.onSkip]);

  // Reduced-motion short-circuit: one opacity fade-up of just the hero
  // line + subtitle, no typewriter, no blur, no theatre. Still
  // personalized, still legible. Duration scales to half for respect.
  if (reduce) {
    return (
      <ReducedMotionFallback
        heroLine={props.heroLine}
        subtitle={props.subtitle}
        onSkip={props.onSkip}
      />
    );
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center overflow-hidden bg-bg text-ink"
      role="presentation"
      aria-hidden={exiting ? "true" : undefined}
    >
      {props.mode === "full" ? (
        <FullCinematic {...props} exiting={exiting} />
      ) : (
        <MinimalCinematic {...props} exiting={exiting} />
      )}

      {/* Skip affordance. Intentionally tiny + muted. Never prominent
          enough to be the first thing a user notices; always there if
          they want it. */}
      {props.onSkip && (
        <button
          type="button"
          onClick={props.onSkip}
          className="absolute bottom-6 right-6 rounded-md px-2 py-1 text-[11px] text-muted/60 transition hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          aria-label="Skip introduction"
        >
          Skip intro →
        </button>
      )}
    </div>
  );
}

// ---- full mode ---------------------------------------------------------

function FullCinematic({
  firstName: _firstName, // used only to drive heroLine upstream
  heroLine,
  subtitle,
  supportLine,
  exiting,
}: CinematicGreetingProps & { exiting: boolean }) {
  const t = FULL_TIMELINE;
  return (
    <motion.div
      className="relative flex h-full w-full items-center justify-center"
      animate={
        exiting
          ? { opacity: 0, filter: "blur(6px)" }
          : { opacity: 1, filter: "blur(0px)" }
      }
      transition={{ duration: t.exitBlur.duration / 1000, ease: HOUSE_EASE }}
    >
      {/* Beat 1 — stillness: director's-lens backdrop composition.
          Five layered elements create cinematic depth without ever
          obscuring the content:
            (a) KEY LIGHT — warm center radial (accent-tinted)
            (b) FILL LIGHT — cooler violet-tinted glow offset to
                lower-right, creating a two-light scene
            (c) RIM LIGHT — soft top-left accent highlight, gives
                the frame a three-point-lighting feel (classic
                cinematic composition — key + fill + rim)
            (d) VIGNETTE — darkens the corners inward so the eye
                is pulled toward the center of frame
            (e) FILM GRAIN — high-frequency SVG turbulence at 12%
                opacity with `overlay` blend; reads as "shot on
                film" texture. Bumped from 6% for visibility.
          All five fade up together across Beat 1 (~1.4 s). */}

      {/* (a) KEY LIGHT */}
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at 50% 48%, rgb(var(--color-accent) / 0.22), transparent 55%)",
        }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.9 }}
        transition={{ duration: t.radialGlow.duration / 1000, ease: HOUSE_EASE }}
      />

      {/* (b) FILL LIGHT */}
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at 72% 68%, rgb(var(--color-violet) / 0.16), transparent 50%)",
        }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.75 }}
        transition={{
          duration: t.radialGlow.duration / 1000,
          delay: 300 / 1000,
          ease: HOUSE_EASE,
        }}
      />

      {/* (c) RIM LIGHT — top-left, warm accent. The third point in a
          classic three-point lighting rig. Subtle, but adds real
          dimensionality; the frame stops feeling flat-lit. */}
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at 18% 22%, rgb(var(--color-accent) / 0.10), transparent 45%)",
        }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.8 }}
        transition={{
          duration: t.radialGlow.duration / 1000,
          delay: 500 / 1000,
          ease: HOUSE_EASE,
        }}
      />

      {/* (d) VIGNETTE */}
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 40%, rgb(0 0 0 / 0.55) 95%)",
        }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: t.radialGlow.duration / 1000, ease: HOUSE_EASE }}
      />

      {/* (e) FILM GRAIN. SVG turbulence filter gives us high-frequency
          noise without shipping a raster. mix-blend-mode: overlay
          makes it sit on top of the lighting without shifting hue.
          Bumped to 12% opacity (was 6%) so the texture is actually
          readable; still well below "dirty screen" territory. */}
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            'url("data:image/svg+xml;utf8,<svg xmlns=%27http://www.w3.org/2000/svg%27 width=%27240%27 height=%27240%27><filter id=%27n%27><feTurbulence type=%27fractalNoise%27 baseFrequency=%271.8%27 numOctaves=%273%27 stitchTiles=%27stitch%27/></filter><rect width=%27100%25%27 height=%27100%25%27 filter=%27url(%23n)%27/></svg>")',
          mixBlendMode: "overlay",
        }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.12 }}
        transition={{
          duration: t.radialGlow.duration / 1000,
          delay: 400 / 1000,
          ease: HOUSE_EASE,
        }}
      />

      {/* Beat 6 — environment awakens */}
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{
          duration: t.environment.duration / 1000,
          delay: t.environment.enter / 1000,
          ease: HOUSE_EASE,
        }}
      >
        <AmbientGlyphField density="ambient" opacityClass="text-accent/10" />
      </motion.div>

      {/* Beats 2–3 — code line settles up as a caption after typing in.
          The per-character reveal lives inside TypewriterLine (below)
          so this container only needs to handle the Beat 3 settle:
          translate up + scale down + dim to caption opacity. */}
      <motion.div
        className="absolute inset-x-0 flex justify-center"
        initial={{ y: 0, scale: 1, opacity: 1 }}
        animate={{
          y: -140,
          scale: 0.75,
          opacity: 0.35,
        }}
        transition={{
          duration: t.codeSettleCaption.duration / 1000,
          delay: t.codeSettleCaption.enter / 1000,
          ease: HOUSE_EASE,
        }}
      >
        {/* Code line gets its own glass-frame treatment so the
            monospace text reads as a proper REPL snippet instead of
            floating pixels. Subtle backdrop-blur + border tints the
            background; the flash keyframe is on this wrapper so the
            "it just ran" cue reads on the whole code block, not the
            text alone. */}
        <motion.div
          className="rounded-lg border border-accent/20 bg-panel/30 px-5 py-3 font-mono text-[20px] leading-none tracking-tight text-accent/90 shadow-[0_0_0_1px_rgb(0_0_0_/_0.15)_inset] backdrop-blur-sm"
          animate={{
            boxShadow: [
              "inset 0 0 0 1px rgb(0 0 0 / 0.15), 0 0 0 rgb(var(--color-accent) / 0)",
              "inset 0 0 0 1px rgb(0 0 0 / 0.15), 0 0 32px rgb(var(--color-accent) / 0.55)",
              "inset 0 0 0 1px rgb(0 0 0 / 0.15), 0 0 0 rgb(var(--color-accent) / 0)",
            ],
            borderColor: [
              "rgb(var(--color-accent) / 0.2)",
              "rgb(var(--color-accent) / 0.8)",
              "rgb(var(--color-accent) / 0.2)",
            ],
          }}
          transition={{
            duration: t.codeFlash.duration / 1000,
            delay: t.codeFlash.enter / 1000,
            ease: "easeInOut",
          }}
        >
          <TypewriterLine
            text={CODE_LINE}
            startDelayMs={t.codeType.enter}
            charIntervalMs={110}
            showCursor={true}
            cursorHideAt={t.codeFlash.enter + t.codeFlash.duration}
            charReveal="hard"
          />
        </motion.div>
      </motion.div>

      {/* Beat 4 — hero name materializes where the code was.
          The stack uses a larger gap (10) after the hero and a
          tighter inner gap (3) between subtitle and support line,
          so subtitle + support read as ONE coupled statement — not
          three equal-weight lines. */}
      <div className="relative z-10 flex flex-col items-center gap-10">
        <motion.div
          className="relative"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{
            duration: 0.2,
            delay: t.heroType.enter / 1000,
          }}
        >
          <TypewriterLine
            text={heroLine}
            startDelayMs={t.heroType.enter}
            charIntervalMs={140}
            className="select-none whitespace-nowrap font-display text-[84px] font-[600] leading-[1] tracking-[-0.02em] text-ink"
            showCursor={false}
            wrapInline
          />
          {/* Hero glow: box-shadow pulse behind the text once the name
              has fully typed. Pointer-events-none so it doesn't eat
              clicks from the Skip affordance above it. */}
          <motion.div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 -z-10 rounded-full"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{
              opacity: [0, 1, 0],
              scale: [0.8, 1.15, 1.15],
              boxShadow: [
                "0 0 0px rgb(var(--color-accent) / 0)",
                "0 0 40px rgb(var(--color-accent) / 0.35)",
                "0 0 0px rgb(var(--color-accent) / 0)",
              ],
            }}
            transition={{
              duration: t.heroGlow.duration / 1000,
              delay: t.heroGlow.enter / 1000,
              ease: HOUSE_EASE,
            }}
          />

          {/* Ring pulse chime — anchored to the hero text's own
              relative container so its center coincides exactly with
              the visual center of "Hi, {firstName}!" The previous
              implementation positioned the ring at the viewport
              center (left-1/2 top-1/2), which fought the hero cluster's
              flex-centered + gapped stack and read as off-center. A
              fixed 24-px base circle, absolutely centered within the
              hero line, grows to scale 40 so it consumes the whole
              frame as it fades — the "ding" the user sees around
              their own name, not somewhere else on screen. */}
          <motion.div
            aria-hidden="true"
            className="pointer-events-none absolute left-1/2 top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-accent/60"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 40, opacity: [0, 0.8, 0] }}
            transition={{
              duration: t.ringPulse.duration / 1000,
              delay: t.ringPulse.enter / 1000,
              ease: MATERIAL_EASE,
              times: [0, 0.2, 1],
            }}
          />
        </motion.div>

        {/* Subtitle + support line form a coupled pair (gap-3), inside
            the outer gap-10 stack so they sit together as one
            "statement" below the hero, not as separate trailing
            lines. Support line inherits the subtitle's typographic
            voice (Inter medium, muted palette) — just scaled down
            and slightly fainter. */}
        <div className="flex flex-col items-center gap-3 text-center">
          {/* Beat 5 — subtitle */}
          <motion.p
            className="text-[22px] font-medium leading-relaxed text-muted"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: t.subtitle.duration / 1000,
              delay: t.subtitle.enter / 1000,
              ease: HOUSE_EASE,
            }}
          >
            {subtitle}
          </motion.p>

          {/* Beat 6 tail — support line. Same font family + weight as
              the subtitle; just a scale and opacity step down. Reads
              as the continuation of the subtitle's thought, not
              "Loading…" chrome. */}
          {supportLine && (
            <motion.p
              className="text-[15px] font-medium leading-relaxed tracking-[-0.005em] text-muted/60"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{
                duration: t.supportLine.duration / 1000,
                delay: t.supportLine.enter / 1000,
              }}
            >
              {supportLine}
            </motion.p>
          )}
        </div>
      </div>

      {/* Beat 7 — ring pulse is rendered INSIDE the hero container
          (see above) so it stays centered on the hero text. Removed
          from here — the previous viewport-centered version looked
          off-center because the hero cluster uses flex-gap stacking,
          not strict viewport centering. */}
    </motion.div>
  );
}

// ---- minimal mode (welcome-back) ---------------------------------------

function MinimalCinematic({
  heroLine,
  subtitle,
  exiting,
}: CinematicGreetingProps & { exiting: boolean }) {
  const t = MINIMAL_TIMELINE;
  return (
    <motion.div
      className="relative flex h-full w-full items-center justify-center"
      animate={exiting ? { opacity: 0 } : { opacity: 1 }}
      transition={{ duration: t.exitFade.duration / 1000, ease: HOUSE_EASE }}
    >
      {/* Beat A — director's-lens backdrop (softer than full mode —
          this is a daily heartbeat, not opening credits). Key light
          + vignette + light grain; skip fill + rim since the surface
          shouldn't work as hard as the first-run cinematic. */}
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at 50% 50%, rgb(var(--color-accent) / 0.15), transparent 60%)",
        }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.8 }}
        transition={{ duration: t.radialGlow.duration / 1000, ease: HOUSE_EASE }}
      />
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 45%, rgb(0 0 0 / 0.45) 95%)",
        }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: t.radialGlow.duration / 1000, ease: HOUSE_EASE }}
      />
      {/* Grain at a lower opacity than full mode — present, but
          quieter, matching the overall restraint of this surface. */}
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            'url("data:image/svg+xml;utf8,<svg xmlns=%27http://www.w3.org/2000/svg%27 width=%27240%27 height=%27240%27><filter id=%27n%27><feTurbulence type=%27fractalNoise%27 baseFrequency=%271.8%27 numOctaves=%273%27 stitchTiles=%27stitch%27/></filter><rect width=%27100%25%27 height=%27100%25%27 filter=%27url(%23n)%27/></svg>")',
          mixBlendMode: "overlay",
        }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.08 }}
        transition={{ duration: t.radialGlow.duration / 1000, ease: HOUSE_EASE }}
      />

      <div className="relative z-10 flex flex-col items-center gap-3">
        {/* Beat B — hero */}
        <TypewriterLine
          text={heroLine}
          startDelayMs={t.heroType.enter}
          charIntervalMs={115}
          className="select-none whitespace-nowrap font-display text-[64px] font-[600] leading-[1] tracking-[-0.015em] text-ink"
          showCursor={false}
          wrapInline
        />

        {/* Beat C — subtitle */}
        <motion.p
          className="text-[18px] font-medium text-muted"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: t.subtitle.duration / 1000,
            delay: t.subtitle.enter / 1000,
            ease: HOUSE_EASE,
          }}
        >
          {subtitle}
        </motion.p>
      </div>
    </motion.div>
  );
}

// ---- reduced-motion fallback -------------------------------------------

function ReducedMotionFallback({
  heroLine,
  subtitle,
  onSkip,
}: {
  heroLine: string;
  subtitle: string;
  onSkip?: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-3 bg-bg text-center text-ink"
      role="presentation"
    >
      <motion.h1
        className="font-display text-[56px] font-[600] leading-tight tracking-tight"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5 }}
      >
        {heroLine}
      </motion.h1>
      <motion.p
        className="text-[18px] text-muted"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5, delay: 0.3 }}
      >
        {subtitle}
      </motion.p>
      {onSkip && (
        <button
          type="button"
          onClick={onSkip}
          className="absolute bottom-6 right-6 rounded-md px-2 py-1 text-[11px] text-muted/60 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Skip intro →
        </button>
      )}
    </div>
  );
}

// ---- typewriter primitive ----------------------------------------------

interface TypewriterProps {
  text: string;
  startDelayMs: number;
  charIntervalMs: number;
  showCursor?: boolean;
  /** After this wall-clock ms, hide the cursor. Only relevant when
   *  showCursor is true. If omitted, the cursor persists. */
  cursorHideAt?: number;
  className?: string;
  /** When true, wrap each character in an inline span so they don't
   *  collapse into block children (important for hero text). Defaults
   *  to block per-char, which is what the monospace code line wants. */
  wrapInline?: boolean;
  /** Per-character reveal style.
   *   "hard" — each char appears INSTANTLY (no fade, no blur). Cadence
   *            alone creates the rhythm. Correct for a monospace REPL
   *            line where each char should read as a discrete keystroke.
   *   "soft" — fade + blur-resolve over 120 ms. Good for a hero
   *            moment where individual letters arriving is part of the
   *            drama but we want smooth readability. Default.
   * The overlapping smooth fades of `soft` at a 75 ms cadence read as
   * a flowing wave, not keystrokes — that's why "hard" exists. */
  charReveal?: "soft" | "hard";
}

/**
 * Character-by-character reveal with per-character blur-resolve. Uses
 * a single setInterval so it's cheap regardless of message length.
 * `opacity 0 → 1` + `filter blur(3 px) → 0` per char; cadence is
 * `charIntervalMs` between chars.
 *
 * Doesn't use framer-motion on each span — framer-motion per-char gets
 * expensive and we'd fight the bundler over per-element motion values.
 * Plain CSS transition on inline styles is plenty for character text.
 */
function TypewriterLine({
  text,
  startDelayMs,
  charIntervalMs,
  showCursor = false,
  cursorHideAt,
  className,
  wrapInline = false,
  charReveal = "soft",
}: TypewriterProps) {
  const [revealed, setRevealed] = useState(0);
  const [cursorVisible, setCursorVisible] = useState(showCursor);

  useEffect(() => {
    const start = window.setTimeout(() => {
      let i = 0;
      const id = window.setInterval(() => {
        i += 1;
        setRevealed(i);
        if (i >= text.length) window.clearInterval(id);
      }, charIntervalMs);
      return () => window.clearInterval(id);
    }, startDelayMs);
    return () => window.clearTimeout(start);
  }, [text, startDelayMs, charIntervalMs]);

  useEffect(() => {
    if (!showCursor || cursorHideAt === undefined) return;
    const t = window.setTimeout(() => setCursorVisible(false), cursorHideAt);
    return () => window.clearTimeout(t);
  }, [showCursor, cursorHideAt]);

  return (
    <span className={className}>
      {Array.from(text).map((char, i) => {
        const isRevealed = i < revealed;
        // "hard": zero transition, no blur. Char just snaps in when
        // revealed flips true — the 75 ms cadence between reveals is
        // what creates the keystroke rhythm.
        // "soft": 120 ms opacity+blur fade-in. Smoother, good for a
        // hero moment where the cinematic feel of characters
        // arriving is the point; bad for a REPL line where it
        // reads as a flowing wave.
        const style: React.CSSProperties =
          charReveal === "hard"
            ? {
                display: wrapInline ? "inline" : "inline-block",
                opacity: isRevealed ? 1 : 0,
                whiteSpace: "pre",
              }
            : {
                display: wrapInline ? "inline" : "inline-block",
                opacity: isRevealed ? 1 : 0,
                filter: isRevealed ? "blur(0)" : "blur(3px)",
                transition: "opacity 120ms ease-out, filter 120ms ease-out",
                whiteSpace: "pre",
              };
        return (
          <span key={`${char}-${i}`} style={style}>
            {char}
          </span>
        );
      })}
      {showCursor && (
        <AnimatePresence>
          {cursorVisible && (
            <motion.span
              key="cursor"
              className="ml-0.5 inline-block h-[1em] w-[2px] -translate-y-[2px] bg-accent align-middle animate-blink"
              initial={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              aria-hidden="true"
            />
          )}
        </AnimatePresence>
      )}
    </span>
  );
}
