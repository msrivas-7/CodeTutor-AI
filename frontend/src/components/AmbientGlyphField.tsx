import { useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";

// Atmospheric backdrop: individual code glyphs drift upward behind the real
// product surface. The field deliberately owns z-0 while every meaningful
// call-site paints its content at z-10, so a glyph can travel freely without
// ever sitting on top of a heading, card, form, control, or footer.
//
// Tuned for two densities:
//   - `hero` (loaders/reveals): a richer field with slightly stronger contrast
//   - `ambient` (auth/Start): fewer, quieter marks
//
// Framer Motion honors prefers-reduced-motion for these transforms. The
// repository-wide reduced-motion rule also collapses repeating animations.

const GLYPHS = ["{", "}", "<", ">", "/", ";", "·", "&", "[", "]"];

interface FloatingGlyph {
  char: string;
  leftPct: number;
  duration: number;
  delay: number;
  size: number;
  staticTopPct: number;
}

// Deterministic positions avoid StrictMode remount jitter while retaining the
// irregular, organic field that made the original atmosphere feel alive.
function buildGlyphField(count: number, seedBase: number): FloatingGlyph[] {
  const rng = (seed: number) => {
    const x = Math.sin((seed + seedBase) * 9973) * 10000;
    return x - Math.floor(x);
  };

  return Array.from({ length: count }, (_, index) => ({
    char: GLYPHS[index % GLYPHS.length],
    leftPct: rng(index + 1) * 100,
    duration: 10 + rng(index + 23) * 8,
    delay: rng(index + 47) * 6,
    size: 10 + Math.floor(rng(index + 71) * 8),
    staticTopPct: 6 + rng(index + 89) * 88,
  }));
}

export function AmbientGlyphField({
  density = "ambient",
  opacityClass = "text-accent/8",
  occludeCenter = false,
}: {
  density?: "ambient" | "hero";
  opacityClass?: string;
  occludeCenter?: boolean;
}) {
  const reduce = useReducedMotion();
  const count = density === "hero" ? 24 : 7;
  const seedBase = density === "hero" ? 1 : 2;
  const glyphs = useMemo(
    () => buildGlyphField(count, seedBase),
    [count, seedBase],
  );

  return (
    <div
      aria-hidden="true"
      data-testid="ambient-glyph-field"
      data-density={density}
      className={`ambient-glyph-field pointer-events-none absolute inset-0 z-0 overflow-hidden${occludeCenter ? " ambient-glyph-field--center-safe" : ""}`}
    >
      {glyphs.map((glyph, index) => (
        <motion.span
          key={`${glyph.char}-${index}`}
          data-floating-glyph={glyph.char}
          className={`absolute bottom-[-10%] select-none font-mono ${opacityClass}`}
          style={{
            left: `${glyph.leftPct}%`,
            top: reduce ? `${glyph.staticTopPct}%` : undefined,
            bottom: reduce ? "auto" : "-10%",
            fontSize: glyph.size,
          }}
          animate={
            reduce
              ? { x: 0, y: 0, opacity: 0.35 }
              : {
                  y: "-120vh",
                  x: [0, glyph.leftPct % 2 === 0 ? 12 : -12, 0],
                  opacity: [0, 1, 1, 0],
                }
          }
          transition={
            reduce
              ? { duration: 0 }
              : {
                  y: {
                    duration: glyph.duration,
                    repeat: Infinity,
                    ease: "linear",
                    delay: -glyph.delay,
                  },
                  x: {
                    duration: glyph.duration / 2,
                    repeat: Infinity,
                    repeatType: "reverse",
                    ease: "easeInOut",
                    delay: -glyph.delay,
                  },
                  opacity: {
                    duration: glyph.duration,
                    repeat: Infinity,
                    ease: "linear",
                    delay: -glyph.delay,
                    times: [0, 0.15, 0.85, 1],
                  },
                }
          }
        >
          {glyph.char}
        </motion.span>
      ))}
    </div>
  );
}
