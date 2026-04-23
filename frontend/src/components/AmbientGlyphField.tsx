import { useMemo } from "react";
import { motion } from "framer-motion";

// Atmospheric backdrop: ASCII/code glyphs drifting upward at random
// positions. Signals "code platform" without being literal or busy.
// Tuned for two call-site densities:
//   - `hero` mode (AuthLoader, splash pages): more glyphs, higher opacity
//   - `ambient` mode (Dashboard, StartPage, CourseOverview): fewer
//     glyphs, low opacity — texture, not content
//
// Intentionally skipped on LessonPage + /editor — those surfaces are
// already dense with code content, additional glyph motion would fight
// the primary UI.
//
// `prefers-reduced-motion` is honored automatically by framer-motion.

const GLYPHS = ["{", "}", "<", ">", "/", ";", "·", "&", "[", "]"];

interface FloatingGlyph {
  char: string;
  leftPct: number;
  duration: number;
  delay: number;
  size: number;
}

// Cheap deterministic hash so two identical call-sites produce the same
// field (avoids StrictMode double-mount jitter).
function buildGlyphField(count: number, seedBase: number): FloatingGlyph[] {
  const rng = (seed: number) => {
    const x = Math.sin((seed + seedBase) * 9973) * 10000;
    return x - Math.floor(x);
  };
  return Array.from({ length: count }, (_, i) => ({
    char: GLYPHS[i % GLYPHS.length],
    leftPct: rng(i + 1) * 100,
    duration: 10 + rng(i + 23) * 8, // 10–18s (slower drift for ambient)
    delay: rng(i + 47) * 6,
    size: 10 + Math.floor(rng(i + 71) * 8),
  }));
}

export function AmbientGlyphField({
  density = "ambient",
  opacityClass = "text-accent/8",
}: {
  density?: "ambient" | "hero";
  // Tailwind color class controlling visibility. Defaults to very subtle;
  // hero call sites (AuthLoader) override to /25.
  opacityClass?: string;
}) {
  const count = density === "hero" ? 24 : 7;
  const seedBase = density === "hero" ? 1 : 2;
  const glyphs = useMemo(() => buildGlyphField(count, seedBase), [count, seedBase]);

  return (
    // mix-blend-mode: screen means glyphs only add light — they effectively
    // vanish against bright/opaque surfaces (header backdrops, card fills)
    // and only register where there's dark negative space. Combined with the
    // low base opacity, this keeps the field atmospheric rather than visible-
    // through-the-UI noise.
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden"
      style={{ mixBlendMode: "screen" }}
    >
      {glyphs.map((g, i) => (
        <motion.span
          key={i}
          className={`absolute bottom-[-10%] select-none font-mono ${opacityClass}`}
          style={{ left: `${g.leftPct}%`, fontSize: g.size }}
          animate={{
            y: "-120vh",
            x: [0, g.leftPct % 2 === 0 ? 12 : -12, 0],
            opacity: [0, 1, 1, 0],
          }}
          transition={{
            y: {
              duration: g.duration,
              repeat: Infinity,
              ease: "linear",
              delay: g.delay,
            },
            x: {
              duration: g.duration / 2,
              repeat: Infinity,
              repeatType: "reverse",
              ease: "easeInOut",
              delay: g.delay,
            },
            opacity: {
              duration: g.duration,
              repeat: Infinity,
              ease: "linear",
              delay: g.delay,
              times: [0, 0.15, 0.85, 1],
            },
          }}
        >
          {g.char}
        </motion.span>
      ))}
    </div>
  );
}
