import { Link } from "react-router-dom";
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "framer-motion";

import { useMarketingAuth } from "../useMarketingAuth";
import { FIRST_LESSON_CONTRACT } from "../../../productContract";

// Phase 22C — primary CTA pill.
//
// Two visual jobs:
//   - Gradient fill matching the LessonCompletePanel's primary action,
//     so the marketing CTA visually rhymes with the in-product reward
//     button. The user crosses from marketing into product feeling like
//     the same hand designed both moments.
//   - "Magnetic" hover: a tiny cursor-tracked translate (capped at 6px)
//     plus an internal glow that follows the cursor across the pill.
//     Dialed to "you barely notice it" — the point is depth, not show.
//
// Auth-aware: anonymous visitors get "Try your first lesson →" → the
// account-free lesson;
// returning logged-in visitors get "Continue learning →" → /start. Mirrors
// the nav so a returning user clicking the giant CTA doesn't get bounced
// to a signup form.
//
// Reduced-motion drops the magnet entirely; the static gradient pill is
// already the win.

const MotionLink = motion.create(Link);

export interface MarketingCtaProps {
  /** Override the destination. Defaults to lesson 1 (anon) or /start (logged-in). */
  to?: string;
  /** Override the button label. */
  label?: string;
  /** Subtle fine-print line directly below the button (e.g. "Free to use…"). */
  fineprint?: string;
  /** Adjust scale variant — `hero` for the in-hero CTA, `repeat` for the
   *  Section 4 repeat (slightly smaller). */
  size?: "hero" | "repeat";
}

export function MarketingCta({
  to,
  label,
  fineprint,
  size = "hero",
}: MarketingCtaProps) {
  const reduce = useReducedMotion();
  const { isLoggedIn } = useMarketingAuth();
  const effectiveTo = to ?? (isLoggedIn ? "/start" : FIRST_LESSON_CONTRACT.route);
  const effectiveLabel =
    label ?? (isLoggedIn ? "Continue learning" : "Try your first lesson");

  // Magnet motion values — reset to (0, 0) on leave; spring on enter
  // for a slow-settle curve.
  const dx = useMotionValue(0);
  const dy = useMotionValue(0);
  const lx = useMotionValue(0.5);
  const ly = useMotionValue(0.5);
  const dxSpring = useSpring(dx, { stiffness: 240, damping: 26 });
  const dySpring = useSpring(dy, { stiffness: 240, damping: 26 });
  const lxSpring = useSpring(lx, { stiffness: 200, damping: 26 });
  const lySpring = useSpring(ly, { stiffness: 200, damping: 26 });
  const lightX = useTransform(lxSpring, [0, 1], ["20%", "80%"]);
  const lightY = useTransform(lySpring, [0, 1], ["20%", "80%"]);
  // Hoisted: calling useTransform inside the conditional `{!reduce && ...}`
  // branch below would violate rules-of-hooks if the OS reduced-motion
  // preference flips at runtime (React would see a different hook count).
  const cursorLightBg = useTransform(
    [lightX, lightY],
    ([x, y]: (string | number)[]) =>
      `radial-gradient(circle at ${x} ${y}, rgba(255,255,255,0.55), transparent 50%)`,
  );

  function handleMove(e: React.MouseEvent<HTMLAnchorElement>) {
    if (reduce) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    // Magnet: translate up to 6px toward the cursor — dampened sharply
    // so the pill feels heavier than a balloon.
    dx.set(Math.max(-6, Math.min(6, (e.clientX - cx) * 0.18)));
    dy.set(Math.max(-4, Math.min(4, (e.clientY - cy) * 0.18)));
    // Light: track normalized cursor in pill-local space.
    lx.set((e.clientX - rect.left) / rect.width);
    ly.set((e.clientY - rect.top) / rect.height);
  }
  function handleLeave() {
    dx.set(0);
    dy.set(0);
    lx.set(0.5);
    ly.set(0.5);
  }

  const padX = size === "hero" ? "px-7" : "px-6";
  const padY = size === "hero" ? "py-3.5" : "py-3";
  const text = size === "hero" ? "text-[14.5px]" : "text-[14px]";

  return (
    <div className="flex flex-col items-center gap-2.5">
      <MotionLink
        to={effectiveTo}
        onMouseMove={handleMove}
        onMouseLeave={handleLeave}
        style={{ x: reduce ? 0 : dxSpring, y: reduce ? 0 : dySpring }}
        whileTap={reduce ? undefined : { scale: 0.97 }}
        className={`relative isolate inline-flex select-none items-center gap-2 overflow-hidden rounded-full ${padX} ${padY} ${text} font-semibold text-bg shadow-[0_18px_40px_-18px_rgba(56,189,248,0.55)] outline-none focus-visible:ring-2 focus-visible:ring-accent/70`}
      >
        {/* Static gradient base — accent → violet, the brand pair.
            Sized 200% wide so a small backgroundPosition shift on hover
            reveals a fresh band of color (subtle "fluid" feel). */}
        <span
          aria-hidden="true"
          className="absolute inset-0 -z-10 bg-gradient-to-r from-accent via-sky-400 to-violet"
          style={{
            backgroundSize: "200% 100%",
            backgroundPosition: "0% 50%",
          }}
        />
        {/* Cursor-tracked highlight. Sits over the gradient, screen-blends
            so it adds light without changing hue. */}
        {!reduce && (
          <motion.span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 -z-10 mix-blend-screen"
            style={{ background: cursorLightBg }}
          />
        )}

        <span className="relative">{effectiveLabel}</span>
        <span aria-hidden="true" className="relative translate-y-[0.5px]">
          →
        </span>
      </MotionLink>

      {fineprint && <p className="text-[11.5px] text-faint">{fineprint}</p>}
    </div>
  );
}
