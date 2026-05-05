import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { MeshGradient } from "@paper-design/shaders-react";
import Lenis from "lenis";

import { CinematicLighting } from "../components/cinema/CinematicLighting";
import { FilmGrain } from "../components/cinema/FilmGrain";
import { HOUSE_EASE } from "../components/cinema/easing";

import { useAuthStore } from "../auth/authStore";

import { MarketingNav } from "../features/marketing/components/MarketingNav";
import { MatchCutHero } from "../features/marketing/components/MatchCutHero";
import { HowItWorksBeat } from "../features/marketing/components/HowItWorksBeat";
import { ReadVignette } from "../features/marketing/components/ReadVignette";
import { AskVignette } from "../features/marketing/components/AskVignette";
import { CheckVignette } from "../features/marketing/components/CheckVignette";
import { MarketingCta } from "../features/marketing/components/MarketingCta";
import { MarketingFooter } from "../features/marketing/components/MarketingFooter";
import { pickHeroCopy } from "../features/marketing/heroCopy";

// Phase 22C — Cinematic Marketing Page.
//
// The first thing a stranger sees when they land on codetutor.msrivas.com.
// Composition follows the locked plan:
//   §1  Hero — wordmark + nav, hero claim (gradient sweep), 5s match-cut
//                motion piece, primary CTA + "How it works ↓" link
//   §2  How it works — three beats (Read / Ask / Check), each with a
//                3-second motion vignette
//   §3  CTA repeat + minimal footer
//
// Atmosphere stack (back-to-front):
//   1. <MeshGradient> WebGL shader — a slow, dim mesh gradient on the
//      bg-tier. Adds a photographic depth no CSS gradient achieves.
//      Speed is intentionally near-zero so it reads as "the bg has
//      texture", not "a screensaver."
//   2. <CinematicLighting variant="three-point" intensity="soft"> —
//      the same lighting rig the cinematic onboarding uses. Marketing
//      inherits the brand's lighting unchanged.
//   3. <FilmGrain intensity="hero"> — physical film texture on top.
//      Final 0.12 opacity — feels filmic without overwhelming type.
//
// Smooth scroll: `lenis` provides the buttery 60fps scroll feel that
// premium sites are known for. Initialized once on mount, torn down on
// unmount. Reduced-motion bypasses Lenis (native browser scroll).

const HERO = pickHeroCopy();

export default function MarketingPage() {
  const reduce = useReducedMotion();
  // Phase 27 §3a: anonymous "Try a lesson — no signup" link is shown
  // ONLY to logged-out visitors. Logged-in users hitting / get the
  // "Continue learning" path via MarketingCta + the nav's Dashboard
  // affordance — pushing them toward an anon path would be a
  // regression. While auth is hydrating, an invisible spacer
  // reserves the link's row width so the CTA row doesn't reflow
  // when the resolved state arrives. Mirrors MarketingNav's
  // "flash of Sign in" defense — Maya is on mobile with a 90s
  // attention budget; a CTA-row reflow mid-paint reads as
  // "broken site, still loading."
  const authUser = useAuthStore((s) => s.user);
  const authLoading = useAuthStore((s) => s.loading);
  // Lenis instance lives in a ref so the "How it works ↓" click handler
  // can call lenis.scrollTo() — using native scrollIntoView() while
  // Lenis is hijacking wheel/touch events would have the two scroll
  // engines fight each other and produce a janky takeover.
  const lenisRef = useRef<Lenis | null>(null);

  // Lenis smooth scroll. The library hijacks wheel + touch events and
  // drives a single rAF loop with eased deltas. Reduced-motion bypasses
  // Lenis entirely (native browser scroll); the nav's scroll-state
  // listener still fires on real scroll events, so the backdrop blur
  // works in both modes.
  useEffect(() => {
    if (reduce) return;
    const lenis = new Lenis({
      duration: 1.1,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      lerp: 0.1,
      wheelMultiplier: 1,
      smoothWheel: true,
    });
    lenisRef.current = lenis;
    let raf = 0;
    const tick = (time: number) => {
      lenis.raf(time);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      lenis.destroy();
      lenisRef.current = null;
    };
  }, [reduce]);

  return (
    // No `bg-bg` on the wrapper — the WebGL mesh + lighting stack IS the
    // background, and a solid color layer here would paint over it. The
    // `text-ink` keeps the default ink color for any descendants.
    <div className="relative min-h-screen overflow-x-hidden text-ink">
      {/* ================================================================
          ATMOSPHERIC BACKDROP STACK
          ================================================================ */}

      {/* WebGL mesh gradient — the deepest layer. Sized to viewport with
          fixed positioning so it scrolls with the user. Colors keyed off
          the brand palette but BRIGHTENED so the mesh reads as a lit
          atmosphere rather than near-black. Distortion + swirl provide
          organic warp; speed is intentionally low so the motion feels
          like the room is breathing, not a screensaver. */}
      {!reduce && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 -z-30"
        >
          <MeshGradient
            colors={[
              "#0a0e22", // ink-deep
              "#1d1758", // violet-deep
              "#5b2cb0", // violet (brand)
              "#1d5b9e", // accent-deep
            ]}
            distortion={0.7}
            swirl={0.6}
            speed={0.22}
            scale={1.3}
            style={{ width: "100%", height: "100%" }}
          />
        </div>
      )}
      {reduce && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 -z-30 bg-gradient-to-br from-[#0a0e22] via-[#1d1758] to-[#1d5b9e]"
        />
      )}

      {/* Three-point lighting + grain — same primitives as the
          cinematic onboarding. Marketing and product inherit the same
          atmosphere, so a returning user feels they never left the
          stage. */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-20">
        <CinematicLighting
          variant="three-point"
          intensity="soft"
          keyColor="accent"
          fadeInMs={reduce ? 0 : 700}
        />
      </div>
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10">
        <FilmGrain intensity="hero" fadeInMs={reduce ? 0 : 600} />
      </div>

      {/* ================================================================
          NAV
          ================================================================ */}
      <MarketingNav />

      {/* ================================================================
          §1  HERO
          ================================================================ */}
      <section className="relative mx-auto flex min-h-screen max-w-6xl flex-col items-center justify-center px-5 pb-24 pt-32 text-center sm:px-8 md:pt-40">
        {/* The hero claim — Fraunces 48–72px, gradient sweep, balanced
            line-wrap, optical-size animation. The claim is the ONE
            gradient on the page; everything else is solid ink/muted. */}
        <HeroClaim claim={HERO.claim} />

        {/* Subhead — Inter 14–16, muted. Fades in after the claim's
            gradient sweep settles. */}
        <motion.p
          initial={reduce ? undefined : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: 0.6,
            ease: HOUSE_EASE,
            delay: reduce ? 0 : 1.6,
          }}
          className="mt-5 max-w-[44ch] text-balance text-[15px] leading-relaxed text-muted sm:text-[16.5px]"
        >
          {HERO.subhead}
        </motion.p>

        {/* The match-cut motion panel. Mounts with its own opacity/y
            stagger; once mounted, runs its 7s loop forever. */}
        <motion.div
          initial={reduce ? undefined : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: 0.7,
            ease: HOUSE_EASE,
            delay: reduce ? 0 : 1.9,
          }}
          className="mt-12 flex w-full justify-center md:mt-14"
        >
          <MatchCutHero />
        </motion.div>

        {/* CTA row — primary pill + secondary anchor link. */}
        <motion.div
          initial={reduce ? undefined : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: 0.5,
            ease: HOUSE_EASE,
            delay: reduce ? 0 : 2.4,
          }}
          className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:gap-6"
        >
          <MarketingCta size="hero" />
          {/* Phase 27 §3a: no-friction entry point for the TikTok
              audience — Maya can run lesson 1 without signing up.
              Anchored to the same row as the primary CTA on desktop;
              wraps below on mobile. Anon-only — a logged-in user
              hitting / shouldn't be invited back into the trial path.
              During auth hydration we render an invisible spacer
              matching the link's footprint so the CTA row doesn't
              reflow when the resolved state arrives. */}
          {authLoading ? (
            <span
              aria-hidden="true"
              className="invisible text-[13.5px]"
            >
              Or try a lesson — no signup →
            </span>
          ) : !authUser ? (
            <Link
              to="/try/lesson/python-fundamentals/hello-world"
              className="text-[13.5px] text-accent transition hover:text-accent/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              Or try a lesson — no signup →
            </Link>
          ) : null}
          <a
            href="#how-it-works"
            onClick={(e) => {
              e.preventDefault();
              // Prefer Lenis when active so the smooth-scroll respects
              // the same easing as the rest of the page; fall back to
              // native scrollIntoView under reduced-motion (when Lenis
              // is intentionally not initialized).
              const lenis = lenisRef.current;
              if (lenis) {
                lenis.scrollTo("#how-it-works", { offset: -64 });
              } else {
                const el = document.getElementById("how-it-works");
                if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
              }
            }}
            className="text-[13.5px] text-muted transition hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            How it works ↓
          </a>
        </motion.div>
      </section>

      {/* ================================================================
          §2  HOW IT WORKS
          ================================================================ */}
      <section
        id="how-it-works"
        // scroll-margin-top reserves space for the fixed nav (~64px) so
        // smooth-scrolling to this anchor lands the eyebrow below the nav
        // chrome rather than under it.
        className="relative mx-auto max-w-6xl scroll-mt-24 px-5 sm:px-8"
      >
        <div className="border-t border-border-soft/40 pt-20">
          <div className="divide-y divide-border-soft/40">
            <HowItWorksBeat
              beatIndex={0}
              glyph="①"
              title="Read."
              oneLine="A real lesson, not a wall of text. Every concept has a moment to land."
              vignette={<ReadVignette />}
            />
            <HowItWorksBeat
              beatIndex={1}
              glyph="②"
              title="Ask."
              oneLine="The tutor asks. You think. The answer is yours."
              vignette={<AskVignette />}
            />
            <HowItWorksBeat
              beatIndex={2}
              glyph="③"
              title="Check."
              oneLine="When the test passes, you earned it. Run it. See the green. Move on."
              vignette={<CheckVignette />}
            />
          </div>
        </div>
      </section>

      {/* ================================================================
          §3  CTA REPEAT + FOOTER
          ================================================================ */}
      <section className="relative mx-auto max-w-6xl px-5 pt-20 pb-12 sm:px-8">
        <div className="flex flex-col items-center gap-6 text-center">
          <MarketingCta
            size="repeat"
            fineprint="Free to start. No card. About 5 minutes for your first lesson."
          />
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hero claim — Fraunces variable-axis with a gradient sweep + opacity
// fade-in. Variable-weight + opsz axes are animated together so the
// type "settles" as the gradient lands — a tiny detail that makes the
// type feel printed rather than rendered.
// ---------------------------------------------------------------------------

function HeroClaim({ claim }: { claim: string }) {
  const reduce = useReducedMotion();

  return (
    <motion.h1
      // Long claims wrap to 2 lines; tight tracking + balanced wrap keeps
      // the visual density even. text-balance prevents the orphan-word
      // wrap that ruins serif display headlines.
      //
      // Why the relaxed leading + padding-block-end + line-height-normal
      // overrides on the inner span: bg-clip-text on a gradient paints
      // ONLY the element's content box. With Fraunces at display sizes,
      // the "y" / "g" / "p" descenders extend below the line-box, so a
      // tight leading would clip them to invisibility. We give the
      // gradient enough vertical room to paint the entire glyph.
      className="bg-gradient-to-r from-success via-accent to-violet bg-clip-text font-display font-semibold leading-[1.16] tracking-[-0.022em] text-transparent [text-wrap:balance] [padding-block-end:0.22em]"
      style={{
        backgroundSize: "200% 100%",
        // Initial Fraunces variation — slightly lighter weight + lower
        // optical size, so the gradient-sweep's "settle" can transition
        // toward heavier weight + higher opsz for a tactile arrival.
        fontVariationSettings: reduce ? '"opsz" 96, "wght" 600' : '"opsz" 80, "wght" 540',
      }}
      initial={
        reduce
          ? { opacity: 1, backgroundPosition: "0% 50%" }
          : { opacity: 0, backgroundPosition: "100% 50%" }
      }
      animate={{
        opacity: 1,
        backgroundPosition: "0% 50%",
        fontVariationSettings: '"opsz" 96, "wght" 600',
      }}
      transition={{
        opacity: {
          duration: reduce ? 0 : 0.6,
          delay: reduce ? 0 : 0.7,
          ease: HOUSE_EASE,
        },
        backgroundPosition: {
          duration: reduce ? 0 : 1.4,
          delay: reduce ? 0 : 0.9,
          ease: HOUSE_EASE,
        },
        fontVariationSettings: {
          duration: reduce ? 0 : 1.4,
          delay: reduce ? 0 : 0.9,
          ease: HOUSE_EASE,
        },
      }}
    >
      {/* clamp() prevents long candidates from overflowing on iPhone-13-class
          viewports (390px). Floors at 32px so wrap stays balanced even for
          the longer hero claims; the SM/MD steps preserve the full display
          size on larger screens. */}
      <span className="block text-[clamp(32px,8.6vw,44px)] sm:text-[60px] md:text-[72px]">
        {claim}
      </span>
    </motion.h1>
  );
}
