import { useEffect } from "react";
import { animate, motion, useMotionValue, useTransform } from "framer-motion";

/**
 * Circular progress indicator for the learning dashboard. Replaces the
 * flat linear bar with a ring that draws itself on mount and tickers the
 * center percentage up from 0. Scoped to one use today (course progress
 * summary) but takes no lesson-specific props, so it can move to any
 * "% of N" surface later.
 *
 * Honors `prefers-reduced-motion` automatically via framer-motion —
 * when the OS flag is set, `animate()` short-circuits to the final value.
 */
export function ProgressRing({
  pct,
  size = 64,
  stroke = 6,
  label,
}: {
  pct: number; // 0-100
  size?: number;
  stroke?: number;
  label?: string;
}) {
  const clamped = Math.max(0, Math.min(100, pct));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;

  const value = useMotionValue(0);
  const dashOffset = useTransform(value, (v) => circumference * (1 - v / 100));
  const displayed = useTransform(value, (v) => Math.round(v));

  useEffect(() => {
    const controls = animate(value, clamped, { duration: 0.9, ease: [0.22, 1, 0.36, 1] });
    return controls.stop;
  }, [clamped, value]);

  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      aria-label={label ?? `${clamped}% complete`}
      role="img"
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* Track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgb(var(--color-elevated))"
          strokeWidth={stroke}
        />
        {/* Arc — rotated so 0% starts at 12 o'clock and fills clockwise */}
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgb(var(--color-accent))"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          style={{
            strokeDashoffset: dashOffset,
            transformOrigin: "center",
            transform: "rotate(-90deg)",
          }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <motion.span
          className="text-sm font-bold tabular-nums text-ink"
          aria-hidden="true"
        >
          {displayed}
        </motion.span>
      </div>
    </div>
  );
}
