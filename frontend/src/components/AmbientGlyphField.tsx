import { useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";

// Decorative code atmosphere for low-density product surfaces. Earlier
// versions animated individual punctuation marks across the full viewport.
// Those marks regularly crossed headings, cards, and the footer, where they
// looked like clipped markup rather than intentional art. Keep the code motif,
// but render complete tokens inside faint chips and confine them to desktop
// edge gutters. Meaningful content owns the centre of every surface.

interface CodeToken {
  text: string;
  leftPct: number;
  topPct: number;
  phase: number;
}

const AMBIENT_TOKENS: CodeToken[] = [
  { text: "</>", leftPct: 4, topPct: 20, phase: 0 },
  { text: "{ }", leftPct: 89, topPct: 34, phase: 0.9 },
  { text: "[ ]", leftPct: 6, topPct: 72, phase: 1.8 },
  { text: "=>", leftPct: 90, topPct: 82, phase: 2.7 },
];

const HERO_TOKENS: CodeToken[] = [
  { text: "</>", leftPct: 3, topPct: 12, phase: 0 },
  { text: "{ }", leftPct: 88, topPct: 18, phase: 0.65 },
  { text: "[ ]", leftPct: 7, topPct: 37, phase: 1.3 },
  { text: "=>", leftPct: 90, topPct: 43, phase: 1.95 },
  { text: "( )", leftPct: 4, topPct: 65, phase: 2.6 },
  { text: "&&", leftPct: 87, topPct: 70, phase: 3.25 },
  { text: "::", leftPct: 9, topPct: 86, phase: 3.9 },
  { text: "//", leftPct: 92, topPct: 88, phase: 4.55 },
];

export function AmbientGlyphField({
  density = "ambient",
  opacityClass = "text-accent/70",
}: {
  density?: "ambient" | "hero";
  opacityClass?: string;
}) {
  const reduce = useReducedMotion();
  const tokens = useMemo(
    () => (density === "hero" ? HERO_TOKENS : AMBIENT_TOKENS),
    [density],
  );

  return (
    <div
      aria-hidden="true"
      data-testid="ambient-glyph-field"
      data-density={density}
      className="ambient-glyph-field pointer-events-none absolute inset-0 overflow-hidden"
    >
      {tokens.map((token) => (
        <motion.span
          key={`${token.text}-${token.leftPct}-${token.topPct}`}
          data-glyph-token={token.text}
          className={`absolute hidden select-none items-center gap-1.5 rounded-full border border-accent/25 bg-accent/5 px-2.5 py-1 font-mono text-[10px] tracking-[0.16em] backdrop-blur-sm lg:inline-flex ${opacityClass}`}
          style={{ left: `${token.leftPct}%`, top: `${token.topPct}%` }}
          initial={false}
          animate={
            reduce
              ? { y: 0, opacity: 0.9 }
              : { y: [-3, 3, -3], opacity: [0.75, 1, 0.75] }
          }
          transition={
            reduce
              ? { duration: 0 }
              : {
                  duration: 7.5,
                  delay: token.phase,
                  repeat: Infinity,
                  ease: "easeInOut",
                }
          }
        >
          <span className="h-1 w-1 rounded-full bg-accent/60" />
          <span>{token.text}</span>
        </motion.span>
      ))}
    </div>
  );
}
