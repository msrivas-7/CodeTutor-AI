import { Link } from "react-router-dom";

import { MarketingFooter } from "../features/marketing/components/MarketingFooter";
import { SimpleMarketingNav } from "../features/marketing/components/SimpleMarketingNav";
import { pickHeroCopy } from "../features/marketing/heroCopy";
import { useMarketingAuth } from "../features/marketing/useMarketingAuth";
import {
  FIRST_LESSON_CONTRACT,
  FIRST_LESSON_FINEPRINT,
} from "../productContract";

const HERO = pickHeroCopy();

const BEATS = [
  {
    glyph: "①",
    title: "Read.",
    copy: "A real lesson, not a wall of text. Every concept has a moment to land.",
  },
  {
    glyph: "②",
    title: "Ask.",
    copy: "The tutor asks. You think. The answer is yours.",
  },
  {
    glyph: "③",
    title: "Check.",
    copy: "When the test passes, you earned it. Run it. See the green. Move on.",
  },
] as const;

/** Mobile-first acquisition surface with no animation-runtime dependency. */
export default function CompactMarketingPage() {
  const { isLoggedIn } = useMarketingAuth();
  const primaryTo = isLoggedIn ? "/start" : FIRST_LESSON_CONTRACT.route;
  const primaryLabel = isLoggedIn ? "Continue learning" : "Try your first lesson";

  return (
    <div className="marketing-page relative min-h-screen overflow-x-clip bg-gradient-to-br from-[#0a0e22] via-[#1d1758] to-[#1d5b9e] text-ink">
      <SimpleMarketingNav />

      <main>
        <section className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center px-5 pb-20 pt-28 text-center">
          <h1 className="bg-gradient-to-r from-success via-accent to-violet bg-clip-text font-display text-[clamp(34px,10vw,46px)] font-semibold leading-[1.12] tracking-[-0.022em] text-transparent [text-wrap:balance]">
            {HERO.claim}
          </h1>
          <p className="mt-4 max-w-[34ch] text-[15px] leading-relaxed text-muted">
            {HERO.subhead}
          </p>

          <div className="mt-9 w-full overflow-hidden rounded-2xl border border-border/70 bg-panel/90 p-5 text-left shadow-[0_24px_70px_-28px_rgba(0,0,0,0.6)]">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-faint">
              Example learner · Maya
            </p>
            <pre className="overflow-hidden whitespace-pre-wrap font-mono text-[12.5px] leading-[1.65] text-ink"><code><span className="text-ink">name</span> <span className="text-faint">=</span> <span className="text-success">&quot;Maya&quot;</span>{"\n"}<span className="text-ink">points</span> <span className="text-faint">=</span> <span className="text-violet">100</span>{"\n"}<span className="text-ink">message</span> <span className="text-faint">=</span> ({"\n"}  <span className="text-ink">name</span> <span className="text-faint">+</span> <span className="text-success">&quot; earned &quot;</span>{"\n"}  <span className="text-faint">+</span> <span className="text-ink">points</span> <span className="text-faint">+</span> <span className="text-success">&quot; points!&quot;</span>{"\n"}){"\n"}<span className="text-violet">print</span>(message)</code></pre>
            <div className="mt-5 rounded-xl border border-accent/25 bg-accent/[0.06] px-4 py-3 text-sm italic text-accent">
              <span aria-hidden="true" className="pr-2 not-italic text-faint">&gt;</span>
              Why does this fail when points is 100?
            </div>
          </div>

          <div className="mt-8 flex w-full flex-col items-center gap-3">
            <Link
              to={primaryTo}
              className="inline-flex min-h-12 items-center rounded-full bg-gradient-to-r from-accent via-sky-400 to-violet px-7 py-3.5 text-[14.5px] font-semibold text-bg shadow-[0_18px_40px_-18px_rgba(56,189,248,0.55)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
            >
              {primaryLabel} <span aria-hidden="true" className="ml-2">→</span>
            </Link>
            {!isLoggedIn && (
              <Link
                to="/signup"
                className="inline-flex min-h-11 items-center rounded-md px-2 text-sm text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
              >
                Create a free account
              </Link>
            )}
            <a
              href="#how-it-works"
              className="inline-flex min-h-11 items-center rounded-md px-2 text-sm text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              How it works ↓
            </a>
          </div>
        </section>

        <section id="how-it-works" className="mx-auto max-w-xl scroll-mt-20 px-5">
          <div className="divide-y divide-border-soft/50 border-y border-border-soft/50">
            {BEATS.map((beat) => (
              <article key={beat.title} className="py-12 text-center">
                <span aria-hidden="true" className="font-display text-3xl text-faint">{beat.glyph}</span>
                <h3 className="mt-3 font-display text-4xl font-semibold tracking-tight">{beat.title}</h3>
                <p className="mx-auto mt-3 max-w-[34ch] text-sm leading-relaxed text-muted">{beat.copy}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="px-5 py-20 text-center">
          <Link
            to={primaryTo}
            className="inline-flex min-h-12 items-center rounded-full bg-gradient-to-r from-accent to-violet px-6 py-3 text-sm font-semibold text-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
          >
            {primaryLabel} <span aria-hidden="true" className="ml-2">→</span>
          </Link>
          <p className="mt-3 text-xs text-faint">{FIRST_LESSON_FINEPRINT}</p>
        </section>
      </main>

      <MarketingFooter />
    </div>
  );
}
