import { motion, useReducedMotion } from "framer-motion";
import { HOUSE_EASE } from "./easing";

// Cinema Kit — FilmGrain.
//
// SVG-turbulence texture rendered as a background-image on a
// pointer-events:none overlay div with `mixBlendMode: "overlay"`.
// Overlay blend keeps grain hue-neutral so it reads on any theme.
// The data URI is a module-scope constant so the browser rasterizes
// the filter result once and reuses it — mounting dozens of instances
// is free.
//
// Three intensities, no "none" — if you don't want grain, don't mount
// the component. Grain is a director's choice, not a configurable
// knob.
//
// Reduced-motion returns null. Grain is decorative texture; safe to
// drop entirely for motion-sensitive users — no information lost.

const GRAIN_URI =
  'url("data:image/svg+xml;utf8,<svg xmlns=%27http://www.w3.org/2000/svg%27 width=%27240%27 height=%27240%27><filter id=%27n%27><feTurbulence type=%27fractalNoise%27 baseFrequency=%271.8%27 numOctaves=%273%27 stitchTiles=%27stitch%27/></filter><rect width=%27100%25%27 height=%27100%25%27 filter=%27url(%23n)%27/></svg>")';

const INTENSITY_OPACITY = {
  ambient: 0.04,
  scene: 0.08,
  hero: 0.12,
} as const;

export interface FilmGrainProps {
  /** Visual weight of the texture. `hero` = cinematic full mode,
   *  `scene` = cinematic minimal / medium surfaces,
   *  `ambient` = compound moments, return cards. */
  intensity?: "ambient" | "scene" | "hero";
  /** When > 0, grain fades in from 0 over this many ms. Default 0
   *  (instant). The cinematic fades in; compound surfaces should
   *  usually sit static. */
  fadeInMs?: number;
  /** Wait this many ms after mount before starting the fade. */
  fadeInDelayMs?: number;
  /** Pass-through class for positioning overrides (e.g. `inset-x-0
   *  top-0 h-1/2`). Default covers full parent. */
  className?: string;
}

export function FilmGrain({
  intensity = "ambient",
  fadeInMs = 0,
  fadeInDelayMs = 0,
  className = "absolute inset-0",
}: FilmGrainProps) {
  const reduce = useReducedMotion();
  if (reduce) return null;

  const targetOpacity = INTENSITY_OPACITY[intensity];

  // Static path — skip the motion wrapper entirely when not fading,
  // so the browser only pays for one layer, no animation machinery.
  if (fadeInMs === 0) {
    return (
      <div
        aria-hidden="true"
        className={`pointer-events-none ${className}`}
        style={{
          backgroundImage: GRAIN_URI,
          mixBlendMode: "overlay",
          opacity: targetOpacity,
        }}
      />
    );
  }

  return (
    <motion.div
      aria-hidden="true"
      className={`pointer-events-none ${className}`}
      style={{
        backgroundImage: GRAIN_URI,
        mixBlendMode: "overlay",
      }}
      initial={{ opacity: 0 }}
      animate={{ opacity: targetOpacity }}
      transition={{
        duration: fadeInMs / 1000,
        delay: fadeInDelayMs / 1000,
        ease: HOUSE_EASE,
      }}
    />
  );
}
