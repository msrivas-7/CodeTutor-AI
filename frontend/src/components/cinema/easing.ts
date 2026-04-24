// Cinema Kit — easing + duration constants.
//
// Lifted verbatim from the first-run cinematic so every surface using
// these primitives reads with the same kinetic grammar. Pinned as
// `as const` tuples so framer-motion type-checks them as cubic-bezier
// arrays instead of widening to `number[]`.

/**
 * Fast-out, slow-settle. The house curve for 95% of cinema motion —
 * landings, enters, resolves. Feels luxurious because the settle
 * portion holds ~2x longer than the ramp.
 */
export const HOUSE_EASE = [0.22, 1, 0.36, 1] as const;

/**
 * Material ease-in-out. Reserved for ring-pulse expansions — rings
 * look wrong with a snappy exit curve, they need symmetrical ramps.
 */
export const MATERIAL_EASE = [0.4, 0, 0.2, 1] as const;

/**
 * Canonical duration vocabulary. Callers should consume these rather
 * than hard-coding ms values so a single edit tunes the whole product.
 */
export const CINEMA_DURATIONS = {
  /** Full ring-pulse expansion + fade. */
  ringPulse: 1000,
  /** The cinematic's exit blur at the very end. */
  exitBlur: 500,
  /** Route transition out (exit side). Fast — the enter does the work. */
  routeOut: 160,
  /** Route transition in. Slightly slower than out for an asymmetric feel. */
  routeIn: 240,
  /** Tactile press scale-down + rebound. */
  tactileTap: 120,
  /** Success glow duration on a successful Run. */
  successPulse: 200,
  /** Hold before confetti on lesson pass — lets the brain register the win. */
  sonarHold: 250,
} as const;
