import { motion, type Variants } from "framer-motion";
import type { ReactNode } from "react";

// Shared stagger-reveal primitives for page content. Wrap a page's
// main content region in <StaggerReveal> and mark each section with
// <StaggerItem>. On mount, items glide up in sequence — no page-level
// motion needed; the shared `bg-bg` background bridges navigations
// and the content-assembles-itself pattern covers the reveal.
//
// `prefers-reduced-motion` is honored automatically by framer-motion.

// Timings tuned after staff-UX review — original values (stagger 0.14s,
// duration 0.62s) pushed "All Courses" header ~800 ms past hydration
// finish, which read as latency rather than choreography. Halved the
// stagger + duration; content-assembles-itself feel survives, the
// perceived-latency cost halves.
const containerVariants: Variants = {
  hidden: {},
  show: {
    transition: {
      staggerChildren: 0.06,
      delayChildren: 0.06,
    },
  },
};

const itemVariants: Variants = {
  // Keep text fully opaque throughout the reveal. Fading an entire section
  // temporarily drops otherwise-valid text below WCAG contrast, especially
  // while a nested stagger is starting. Translation + scale retain the
  // polished assembly motion without sacrificing legibility at any frame.
  hidden: { y: 8, scale: 0.99 },
  show: {
    y: 0,
    scale: 1,
    transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] as const },
  },
};

export function StaggerReveal({
  children,
  className,
  nested = false,
}: {
  children: ReactNode;
  className?: string;
  // When nested inside another StaggerReveal, omit initial/animate so
  // this container inherits its "hidden" → "show" state from the parent
  // motion tree. That way the inner cascade only kicks off when the
  // outer stagger reaches this section — rather than firing immediately
  // on mount in parallel with the outer fade.
  nested?: boolean;
}) {
  const framerProps = nested ? { variants: containerVariants } : {
    variants: containerVariants,
    initial: "hidden",
    animate: "show",
  };
  return (
    <motion.div {...framerProps} className={className}>
      {children}
    </motion.div>
  );
}

export function StaggerItem({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.div variants={itemVariants} className={className}>
      {children}
    </motion.div>
  );
}
