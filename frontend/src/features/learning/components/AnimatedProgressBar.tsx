import { motion } from "framer-motion";

/**
 * Linear progress bar with an on-mount fill animation and a subtle
 * shimmer overlay during the fill. The fill class is handed in so the
 * component stays tone-agnostic (the course page uses solid violet,
 * practice uses a gradient, etc.). `prefers-reduced-motion` is honored
 * automatically by framer-motion — the fill snaps to final width with
 * zero duration when the OS flag is set.
 */
export function AnimatedProgressBar({
  pct,
  height = 8,
  fillClassName = "bg-accent",
  trackClassName = "bg-elevated",
  ariaLabel,
  shimmer = true,
}: {
  pct: number; // 0-100
  height?: number;
  fillClassName?: string;
  trackClassName?: string;
  ariaLabel?: string;
  shimmer?: boolean;
}) {
  const clamped = Math.max(0, Math.min(100, pct));

  return (
    <div
      className={`relative overflow-hidden rounded-full ${trackClassName}`}
      style={{ height }}
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={ariaLabel}
    >
      <motion.div
        className={`relative h-full rounded-full ${fillClassName}`}
        initial={{ width: 0 }}
        animate={{ width: `${clamped}%` }}
        transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
      >
        {/* Shimmer sheen that sweeps across the fill during mount. Bounded
            to the fill's width by being a child; the inset pseudo-frame
            fades out once the fill settles via opacity transition. */}
        {shimmer && clamped > 0 && (
          <motion.span
            className="pointer-events-none absolute inset-y-0 left-0 w-1/3 rounded-full"
            style={{
              background:
                "linear-gradient(90deg, transparent, rgba(255,255,255,0.28), transparent)",
            }}
            initial={{ x: "-100%", opacity: 0 }}
            animate={{ x: "300%", opacity: [0, 1, 1, 0] }}
            transition={{ duration: 1.1, ease: "easeOut", times: [0, 0.1, 0.9, 1] }}
          />
        )}
      </motion.div>
    </div>
  );
}
