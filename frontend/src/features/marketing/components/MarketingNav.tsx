import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { Wordmark } from "../../../components/Wordmark";
import { HOUSE_EASE } from "../../../components/cinema/easing";
import { useMarketingAuth } from "../useMarketingAuth";

// Phase 22C — top chrome for the marketing page.
//
// Composition: Wordmark left, single auth affordance right. No menu,
// no pricing link, no docs link. The Linear pattern: every element
// in the nav is the user's next click; clutter dilutes the funnel.
//
// Auth-aware label: anonymous visitors see "Sign in" → /login. Logged-
// in visitors see "Dashboard" → /start. Same slot, different word —
// matches Linear / Stripe / Vercel where a returning logged-in user
// can re-visit the marketing page without being bounced, and gets a
// one-click way back into the product.
//
// Behavior: floats with a subtle backdrop blur once the user scrolls
// past the hero. The scroll-listener is OWNED HERE (rather than the
// parent page mutating a data-attribute via querySelector) so the
// component is self-contained — the nav doesn't depend on its parent
// for visual state.

export function MarketingNav() {
  const reduce = useReducedMotion();
  const { isLoggedIn } = useMarketingAuth();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <motion.header
      initial={reduce ? undefined : { opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: HOUSE_EASE, delay: 0.1 }}
      className="fixed inset-x-0 top-0 z-30 flex items-center justify-between gap-6 px-5 py-4 transition-colors duration-300 data-[scrolled=true]:bg-bg/55 data-[scrolled=true]:backdrop-blur-xl sm:px-8"
      data-scrolled={scrolled ? "true" : "false"}
    >
      <Link to="/" className="flex items-center" aria-label="CodeTutor AI home">
        <Wordmark size="md" />
      </Link>

      {/* Auth-affordance slot. The lightweight persisted-session hint
          chooses the returning-user label before full auth hydration. */}
      <nav className="flex items-center gap-1 sm:gap-3">
        {isLoggedIn ? (
          <Link
            to="/start"
            className="rounded-full border border-accent/30 bg-accent/[0.08] px-4 py-1.5 text-[12.5px] font-medium text-accent transition hover:bg-accent/[0.14] hover:text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 sm:text-[13.5px]"
          >
            Dashboard →
          </Link>
        ) : (
          <Link
            to="/login"
            className="rounded-full px-4 py-1.5 text-[12.5px] font-medium text-muted transition hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 sm:text-[13.5px]"
          >
            Sign in
          </Link>
        )}
      </nav>
    </motion.header>
  );
}
