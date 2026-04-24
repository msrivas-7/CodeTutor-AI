import { motion, useReducedMotion } from "framer-motion";
import { HOUSE_EASE } from "./easing";

// Cinema Kit — CinematicLighting.
//
// Three-point lighting rig (key + fill + rim) plus a vignette. When
// combined, flat surfaces gain the depth of a studio shot. The
// cinematic's full-mode background reads as "a stage, lit" — not "a
// screen, on." This primitive encapsulates that exact layering.
//
// Two variants:
//   three-point: full rig. Key + fill + rim + vignette.
//   key-only:    just the key + vignette. Half the weight.
//
// RESERVED PRIMITIVE. The plan explicitly calls for CinematicLighting
// to stay scoped to the cinematic itself during this pass — other
// surfaces use FilmGrain + Fraunces + RingPulse for continuity. This
// module is exported so future hero moments (Course Complete, etc.)
// can earn the full rig.
//
// Reduced-motion skips the fade-in animations but still renders the
// static gradients. The vignette especially is too useful for
// readability to drop.

const GRADIENTS = {
  keyAccent:
    "radial-gradient(circle at 50% 48%, rgb(var(--color-accent) / 0.22), transparent 55%)",
  keyViolet:
    "radial-gradient(circle at 50% 48%, rgb(var(--color-violet) / 0.22), transparent 55%)",
  fill: "radial-gradient(circle at 72% 68%, rgb(var(--color-violet) / 0.16), transparent 50%)",
  rim: "radial-gradient(circle at 18% 22%, rgb(var(--color-accent) / 0.10), transparent 45%)",
  vignette:
    "radial-gradient(ellipse at center, transparent 40%, rgb(0 0 0 / 0.55) 95%)",
} as const;

// Final (fully-lit) opacities matching the cinematic verbatim.
const FULL_OPACITY = {
  key: 0.9,
  fill: 0.75,
  rim: 0.8,
  vignette: 1,
} as const;

const LAYER_CLASS = "pointer-events-none absolute inset-0";

export interface CinematicLightingProps {
  variant: "three-point" | "key-only";
  /** Fade-in duration for the whole rig in ms. 0 = instant (no motion). */
  fadeInMs?: number;
  /** Warm key tone. Defaults to accent. */
  keyColor?: "accent" | "violet";
  /** `soft` halves non-vignette opacities for a quieter, ambient surface. */
  intensity?: "full" | "soft";
}

interface LayerProps {
  background: string;
  finalOpacity: number;
  /** Extra delay (ms) on top of the base fade-in start. */
  delayMs: number;
  fadeInMs: number;
  animate: boolean;
}

function LightLayer({
  background,
  finalOpacity,
  delayMs,
  fadeInMs,
  animate,
}: LayerProps) {
  if (!animate) {
    return (
      <div
        aria-hidden="true"
        className={LAYER_CLASS}
        style={{ background, opacity: finalOpacity }}
      />
    );
  }
  return (
    <motion.div
      aria-hidden="true"
      className={LAYER_CLASS}
      style={{ background }}
      initial={{ opacity: 0 }}
      animate={{ opacity: finalOpacity }}
      transition={{
        duration: fadeInMs / 1000,
        delay: delayMs / 1000,
        ease: HOUSE_EASE,
      }}
    />
  );
}

export function CinematicLighting({
  variant,
  fadeInMs = 0,
  keyColor = "accent",
  intensity = "full",
}: CinematicLightingProps) {
  const reduce = useReducedMotion();
  const animate = !reduce && fadeInMs > 0;
  const scale = intensity === "soft" ? 0.5 : 1;
  const keyBg = keyColor === "violet" ? GRADIENTS.keyViolet : GRADIENTS.keyAccent;

  return (
    <>
      <LightLayer
        background={keyBg}
        finalOpacity={FULL_OPACITY.key * scale}
        delayMs={0}
        fadeInMs={fadeInMs}
        animate={animate}
      />
      {variant === "three-point" && (
        <>
          <LightLayer
            background={GRADIENTS.fill}
            finalOpacity={FULL_OPACITY.fill * scale}
            delayMs={300}
            fadeInMs={fadeInMs}
            animate={animate}
          />
          <LightLayer
            background={GRADIENTS.rim}
            finalOpacity={FULL_OPACITY.rim * scale}
            delayMs={500}
            fadeInMs={fadeInMs}
            animate={animate}
          />
        </>
      )}
      {/* Vignette always renders at full opacity — pulls the eye inward.
          Not scaled by `intensity`; its job is focus, not glow. */}
      <LightLayer
        background={GRADIENTS.vignette}
        finalOpacity={FULL_OPACITY.vignette}
        delayMs={0}
        fadeInMs={fadeInMs}
        animate={animate}
      />
    </>
  );
}
