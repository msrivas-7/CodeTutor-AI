import type { ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { HOUSE_EASE } from "../../../components/cinema/easing";

// Phase 22C — generic "How it works" beat container.
//
// Three of these stack vertically in Section 2 of the marketing page:
//   ① Read.   A real lesson, not a wall of text.   [vignette]
//   ② Ask.    The tutor asks. You think.            [vignette]
//   ③ Check.  When the test passes, you earned it.  [vignette]
//
// The beat is readable before any observer callback fires. Vignettes can
// still animate when they enter view, but essential marketing copy never
// starts at opacity zero (which previously made the lower page appear
// empty when intersection events were delayed or unavailable).
//
// The composition is intentional: number + heading + one-line line is
// the LEFT column; the vignette panel is the RIGHT column on desktop,
// stacked below on mobile. This keeps the rhythm — "label, evidence,
// label, evidence" — visible in the first scroll pass.

export interface HowItWorksBeatProps {
  /** "①" / "②" / "③". Roman numerals or arabic also fine — pick one
   *  set and stay consistent. We use the circled-Latin "①" trio for
   *  the brand. */
  glyph: string;
  title: string;
  oneLine: string;
  vignette: ReactNode;
  /** 0-indexed beat position; drives the stagger. */
  beatIndex: number;
}

export function HowItWorksBeat({
  glyph,
  title,
  oneLine,
  vignette,
  beatIndex,
}: HowItWorksBeatProps) {
  const reduce = useReducedMotion();
  const baseDelay = beatIndex * 0.05;

  return (
    <motion.div
      initial={false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, ease: HOUSE_EASE, delay: baseDelay }}
      className="grid grid-cols-1 gap-8 py-12 md:grid-cols-12 md:gap-12 md:py-20"
    >
      {/* Left column — label, heading, one-liner. The heading IS the
          word on its own ("Read.", "Ask.", "Check.") so the beat's name
          is visually the strongest thing in this column. */}
      <div className="md:col-span-5">
        <div className="flex items-baseline gap-3">
          <span
            aria-hidden="true"
            className="select-none font-display text-[34px] font-medium leading-none text-faint/80 sm:text-[40px]"
          >
            {glyph}
          </span>
          <h3 className="font-display text-[40px] font-semibold leading-[1.05] tracking-tight text-ink sm:text-[48px]">
            {title}
          </h3>
        </div>
        <p className="mt-3 max-w-[34ch] text-[15px] leading-relaxed text-muted sm:text-[16px]">
          {oneLine}
        </p>
      </div>

      {/* Right column — vignette panel. Each beat owns its own motion
          inside the panel; we just provide the staged container. */}
      <div className="md:col-span-7">
        <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-panel/60 p-5 shadow-[0_24px_60px_-30px_rgba(0,0,0,0.6)] backdrop-blur-md md:p-6">
          {vignette}
        </div>
      </div>
    </motion.div>
  );
}
