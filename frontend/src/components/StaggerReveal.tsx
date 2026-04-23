import { motion, type Variants } from "framer-motion";
import type { ReactNode } from "react";

// Shared stagger-reveal primitives for page content. Wrap a page's
// main content region in <StaggerReveal> and mark each section with
// <StaggerItem>. On mount, items fade up in sequence — no page-level
// motion needed; the shared `bg-bg` background bridges navigations
// and the content-assembles-itself pattern covers the reveal.
//
// `prefers-reduced-motion` is honored automatically by framer-motion.

const containerVariants: Variants = {
  hidden: {},
  show: {
    transition: {
      staggerChildren: 0.14,
      delayChildren: 0.12,
    },
  },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 14, scale: 0.985 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.62, ease: [0.22, 1, 0.36, 1] as const },
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
