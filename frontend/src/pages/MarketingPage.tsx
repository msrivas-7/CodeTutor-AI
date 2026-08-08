import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import type Lenis from "lenis";

import { CinematicLighting } from "../components/cinema/CinematicLighting";
import { FilmGrain } from "../components/cinema/FilmGrain";
import { HOUSE_EASE } from "../components/cinema/easing";

import { MarketingNav } from "../features/marketing/components/MarketingNav";
import { MatchCutHero } from "../features/marketing/components/MatchCutHero";
import { HowItWorksBeat } from "../features/marketing/components/HowItWorksBeat";
import { ReadVignette } from "../features/marketing/components/ReadVignette";
import { AskVignette } from "../features/marketing/components/AskVignette";
import { CheckVignette } from "../features/marketing/components/CheckVignette";
import { MarketingCta } from "../features/marketing/components/MarketingCta";
import { MarketingFooter } from "../features/marketing/components/MarketingFooter";
import { pickHeroCopy } from "../features/marketing/heroCopy";
import { useMarketingAuth } from "../features/marketing/useMarketingAuth";
import {
  FIRST_LESSON_FINEPRINT,
} from "../productContract";

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
const loadMeshGradient = () =>
  import("@paper-design/shaders-react").then(({ MeshGradient }) => ({
    default: MeshGradient,
  }));
const DeferredMeshGradient = lazy(loadMeshGradient);

export default function MarketingPage() {
  const reduce = useReducedMotion();
  const [compactMotion, setCompactMotion] = useState(() =>
    window.matchMedia("(max-width: 640px)").matches,
  );
  const staticHero = Boolean(reduce || compactMotion);
  const [atmosphereReady, setAtmosphereReady] = useState(false);
  // Phase 27 §3a: anonymous "Try a lesson — no signup" link is shown
  // ONLY to logged-out visitors. Logged-in users hitting / get the
  // "Continue learning" path via MarketingCta + the nav's Dashboard
  // affordance — pushing them toward an anon path would be a
  // regression. A persisted-session hint selects the returning-user
  // treatment immediately; deferred Supabase hydration verifies it.
  const { isLoggedIn } = useMarketingAuth();
  // Lenis instance lives in a ref so the "How it works ↓" click handler
  // can call lenis.scrollTo() — using native scrollIntoView() while
  // Lenis is hijacking wheel/touch events would have the two scroll
  // engines fight each other and produce a janky takeover.
  const lenisRef = useRef<Lenis | null>(null);

  // Browser emulation and real device rotation can change the compact
  // breakpoint after the route has mounted. Track it instead of treating the
  // first viewport sample as permanent, otherwise a phone can accidentally
  // receive the desktop choreography during a resize race.
  useEffect(() => {
    const query = window.matchMedia("(max-width: 640px)");
    const update = () => setCompactMotion(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  // The WebGL atmosphere is decorative, so it must not delay the product's
  // actual promise, demo, or CTA. Paint the equivalent static gradient first,
  // then upgrade to the shader after the browser has had a full frame plus a
  // short quiet window. This avoids shader compilation becoming the page's
  // first meaningful paint on lower-end phones while preserving the effect.
  useEffect(() => {
    if (staticHero) {
      setAtmosphereReady(false);
      return;
    }

    let cancelled = false;
    const frame = requestAnimationFrame(() => {
      void loadMeshGradient().then(() => {
        if (!cancelled) setAtmosphereReady(true);
      });
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [staticHero]);

  // Lenis smooth scroll. The library hijacks wheel + touch events and
  // drives a single rAF loop with eased deltas. Reduced-motion bypasses
  // Lenis entirely (native browser scroll); the nav's scroll-state
  // listener still fires on real scroll events, so the backdrop blur
  // works in both modes.
  useEffect(() => {
    if (staticHero) return;
    let cancelled = false;
    let raf = 0;
    const timer = setTimeout(() => {
      void import("lenis").then(({ default: LenisConstructor }) => {
        if (cancelled) return;
        const lenis = new LenisConstructor({
          duration: 1.1,
          easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
          lerp: 0.1,
          wheelMultiplier: 1,
          smoothWheel: true,
        });
        lenisRef.current = lenis;
        const tick = (time: number) => {
          lenis.raf(time);
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      });
    }, 2500);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      cancelAnimationFrame(raf);
      lenisRef.current?.destroy();
      lenisRef.current = null;
    };
  }, [staticHero]);

  return (
    // No `bg-bg` on the wrapper — the WebGL mesh + lighting stack IS the
    // background, and a solid color layer here would paint over it. The
    // `text-ink` keeps the default ink color for any descendants.
    <div className="marketing-page relative min-h-screen overflow-x-clip text-ink">
      {/* ================================================================
          ATMOSPHERIC BACKDROP STACK
          ================================================================ */}

      {/* WebGL mesh gradient — the deepest layer. Sized to viewport with
          fixed positioning so it scrolls with the user. Colors keyed off
          the brand palette but BRIGHTENED so the mesh reads as a lit
          atmosphere rather than near-black. Distortion + swirl provide
          organic warp; speed is intentionally low so the motion feels
          like the room is breathing, not a screensaver. */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 -z-30"
        style={{
          backgroundColor: "#0a0e22",
          // Match the shader's settled color masses closely enough that the
          // lazy WebGL upgrade adds texture and motion instead of repainting
          // the room behind an already-settled hero.
          backgroundImage: [
            "radial-gradient(ellipse at 72% 32%, rgba(91,44,176,.72) 0%, rgba(91,44,176,.22) 34%, transparent 62%)",
            "radial-gradient(ellipse at 18% 72%, rgba(29,91,158,.78) 0%, rgba(29,91,158,.2) 38%, transparent 66%)",
            "radial-gradient(ellipse at 34% 18%, rgba(31,108,96,.42) 0%, transparent 50%)",
            "linear-gradient(135deg, #0a0e22 0%, #1d1758 52%, #142f62 100%)",
          ].join(","),
        }}
      >
        {!staticHero && atmosphereReady && (
          <motion.div
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1.4, ease: HOUSE_EASE }}
          >
            <Suspense fallback={null}>
              <DeferredMeshGradient
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
            </Suspense>
          </motion.div>
        )}
      </div>

      {/* Three-point lighting + grain — same primitives as the
          cinematic onboarding. Marketing and product inherit the same
          atmosphere, so a returning user feels they never left the
          stage. */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-20">
        <CinematicLighting
          variant="three-point"
          intensity="soft"
          keyColor="accent"
          fadeInMs={staticHero ? 0 : 700}
        />
      </div>
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10">
        {!staticHero && <FilmGrain intensity="hero" fadeInMs={600} />}
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
        <HeroClaim claim={HERO.claim} staticMotion={staticHero} />

        {/* Subhead — Inter 14–16, muted. It is readable from first paint;
            the delayed lift still preserves the intended choreography
            without making essential copy wait on JavaScript or WebGL. */}
        <motion.p
          initial={staticHero ? false : { y: 6 }}
          animate={staticHero ? undefined : { y: 0 }}
          transition={{
            duration: 0.6,
            ease: HOUSE_EASE,
            delay: staticHero ? 0 : 1.6,
          }}
          className="mt-5 max-w-[44ch] text-balance text-[15px] leading-relaxed text-muted sm:text-[16.5px]"
        >
          {HERO.subhead}
        </motion.p>

        {/* CTA row — primary pill + secondary anchor link. */}
        <motion.div
          initial={staticHero ? false : { y: 8 }}
          animate={staticHero ? undefined : { y: 0 }}
          transition={{
            duration: 0.5,
            ease: HOUSE_EASE,
            delay: staticHero ? 0 : 1.9,
          }}
          className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:gap-5"
        >
          <MarketingCta size="hero" />
          {/* The account-free product experience is the primary anonymous
              action. Account creation remains available as a clearly
              labelled secondary action. */}
          {!isLoggedIn ? (
            <Link
              to="/signup"
              className="inline-flex min-h-11 items-center rounded-md px-2 text-sm text-accent transition hover:bg-accent/5 hover:text-accent/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              Create a free account
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
            className="inline-flex min-h-11 items-center rounded-md px-2 text-sm text-muted transition hover:bg-elevated/50 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            How it works ↓
          </a>
        </motion.div>

        {/* The cinematic demo supports the promise after the visitor has a
            visible way to act. This keeps the primary action above the fold
            on common 720px laptop screens without sacrificing the demo. */}
        <motion.div
          initial={staticHero ? false : { y: 12 }}
          animate={staticHero ? undefined : { y: 0 }}
          transition={{
            duration: 0.7,
            ease: HOUSE_EASE,
            delay: staticHero ? 0 : 2.2,
          }}
          className="mt-9 flex w-full justify-center md:mt-11"
        >
          <MatchCutHero staticMotion={staticHero} />
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
            fineprint={FIRST_LESSON_FINEPRINT}
          />
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hero claim — Fraunces variable-axis with a gradient sweep. The claim
// is visible from first paint; variable-weight + opsz axes animate so the
// type "settles" as the gradient lands — a tiny detail that makes the
// type feel printed rather than rendered.
// ---------------------------------------------------------------------------

function HeroClaim({ claim, staticMotion }: { claim: string; staticMotion: boolean }) {
  const reduce = useReducedMotion();
  const staticClaim = Boolean(reduce || staticMotion);

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
        backgroundPosition: staticClaim ? "0% 50%" : undefined,
        // Initial Fraunces variation — slightly lighter weight + lower
        // optical size, so the gradient-sweep's "settle" can transition
        // toward heavier weight + higher opsz for a tactile arrival.
        fontVariationSettings: staticClaim ? '"opsz" 96, "wght" 600' : '"opsz" 80, "wght" 540',
      }}
      initial={
        staticClaim
          ? false
          : { opacity: 1, backgroundPosition: "100% 50%" }
      }
      animate={
        staticClaim
          ? undefined
          : {
              opacity: 1,
              backgroundPosition: "0% 50%",
              fontVariationSettings: '"opsz" 96, "wght" 600',
            }
      }
      transition={{
        opacity: {
          duration: staticClaim ? 0 : 0.6,
          delay: staticClaim ? 0 : 0.7,
          ease: HOUSE_EASE,
        },
        backgroundPosition: {
          duration: staticClaim ? 0 : 1.4,
          delay: staticClaim ? 0 : 0.9,
          ease: HOUSE_EASE,
        },
        fontVariationSettings: {
          duration: staticClaim ? 0 : 1.4,
          delay: staticClaim ? 0 : 0.9,
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
