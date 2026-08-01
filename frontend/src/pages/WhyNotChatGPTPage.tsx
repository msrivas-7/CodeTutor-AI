import { Link } from "react-router-dom";
import { SimpleMarketingNav } from "../features/marketing/components/SimpleMarketingNav";
import { MarketingFooter } from "../features/marketing/components/MarketingFooter";
import { FIRST_LESSON_CONTRACT } from "../productContract";

// Phase A — A7 (per competitive-intel): the public /why-not-chatgpt page.
// The cheapest positioning win: every beginner's honest first question is
// "why wouldn't I just ask ChatGPT?" — so we answer it in public, on our
// own terms, including the cases where ChatGPT genuinely is the better
// tool. The credibility of the page comes from that concession; the
// conversion comes from naming the difference between GETTING an answer
// and being able to PRODUCE one.
//
// Deliberately a calm, mostly-static reading page — no WebGL/lighting
// stack. This is an argument, not a trailer. "Python" stays in the SEO
// title/meta surface per growth-marketing's nuance; body copy talks
// about learning to code.

const DIFFERENCES: Array<{ title: string; them: string; us: string }> = [
  {
    title: "What happens when you're stuck",
    them: "ChatGPT can explain, coach, or generate working code — the choice is yours. That flexibility is useful, but it also leaves the learning discipline to you.",
    us: "Our tutor diagnoses first, then offers questions and progressively stronger hints. It guides the next thought — but the line of code that fixes it still comes out of your keyboard.",
  },
  {
    title: "The shape of the journey",
    them: "ChatGPT has memory, projects, and a dedicated Study mode. It can carry context forward, but it is still a general-purpose assistant rather than this course's fixed learning path.",
    us: "A curriculum with a visible shape and an end: lessons build on each other, your dashboard shows the whole road, and next is always one click.",
  },
  {
    title: "What 'done' means",
    them: "ChatGPT's Study mode can quiz you and check understanding, but a general conversation does not own this course's completion rules.",
    us: "A lesson counts only when your code passes real checks — and you answer a quick question from memory before we call it complete.",
  },
  {
    title: "Where the code runs",
    them: "ChatGPT can analyze or run code in supported tools, but it is not continuously tied to this lesson's starter files, runner, and completion checks.",
    us: "Every lesson is a live workspace. You type, run, and watch real output — including the errors, which is where the learning is.",
  },
];

export default function WhyNotChatGPTPage() {
  return (
    <div className="min-h-screen bg-bg text-ink">
      <SimpleMarketingNav />
      <main className="mx-auto max-w-3xl px-5 pb-8 pt-28 sm:px-8">
        <p className="text-[12px] font-semibold uppercase tracking-wider text-accent">
          The honest question
        </p>
        <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight sm:text-5xl">
          Why not just use ChatGPT?
        </h1>
        <p className="mt-5 text-base leading-relaxed text-muted">
          Fair question — ChatGPT is easy to open, remarkably capable, and
          can be an excellent learning partner. The difference is the product
          contract: a flexible assistant can help you learn, while CodeTutor
          is built to make practice, proof, and progression unavoidable.
        </p>

        <div className="mt-12 flex flex-col gap-6">
          {DIFFERENCES.map((d) => (
            <section
              key={d.title}
              className="rounded-xl border border-border bg-panel p-5"
            >
              <h2 className="text-base font-bold text-ink sm:text-sm">
                {d.title}
              </h2>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg bg-elevated/60 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-faint">
                    ChatGPT
                  </p>
                  <p className="mt-1.5 text-base leading-relaxed text-muted sm:text-sm">
                    {d.them}
                  </p>
                </div>
                <div className="rounded-lg bg-accent/5 p-3 ring-1 ring-accent/20">
                  <p className="text-xs font-semibold uppercase tracking-wider text-accent">
                    CodeTutor
                  </p>
                  <p className="mt-1.5 text-base leading-relaxed text-ink/90 sm:text-sm">
                    {d.us}
                  </p>
                </div>
              </div>
            </section>
          ))}
        </div>

        {/* The concession — this is what makes the rest believable. */}
        <section className="mt-12 rounded-xl border border-border-soft/60 bg-panel/60 p-5">
          <h2 className="text-base font-bold text-ink sm:text-sm">
            When ChatGPT <em>is</em> the better tool
          </h2>
          <p className="mt-2 text-base leading-relaxed text-muted sm:text-sm">
            If you already know how to code and need a one-off script, a
            regex, or a rubber duck at 2am — use ChatGPT. It's excellent at
            that, and pretending otherwise would be silly. This product is
            for the different job: going from "I can't code" to "I can" —
            which happens through your fingers, not your clipboard.
          </p>
        </section>

        {/* Receipts, not vibes: the standing refusals. */}
        <section className="mt-8">
          <h2 className="text-base font-bold text-ink sm:text-sm">
            Promises we've made in writing
          </h2>
          <ul className="mt-3 flex flex-col gap-2 text-base leading-relaxed text-muted sm:text-sm">
            <li>
              — There is no "give me the answer" button in the tutor. There
              never will be.
            </li>
            <li>
              — No streak-shame mechanics. Your streak is a fact we show
              you, not a leash.
            </li>
            <li>
              — A lesson is complete when you can do the thing, not when
              you've clicked through it.
            </li>
          </ul>
        </section>

        <div className="mt-12 flex flex-col items-start gap-3">
          <Link
            to={FIRST_LESSON_CONTRACT.route}
            className="inline-flex min-h-11 items-center rounded-lg bg-gradient-to-r from-accent to-violet px-6 py-3 text-sm font-bold text-bg shadow-glow transition hover:opacity-90"
          >
            Judge for yourself — try lesson 1, no signup →
          </Link>
          <p className="text-sm leading-relaxed text-muted">
            About {FIRST_LESSON_CONTRACT.estimatedMinutes} minutes, in your browser. The tutor is designed to guide the
            next thought without replacing your work — that's the point.
          </p>
        </div>
      </main>
      <MarketingFooter />
    </div>
  );
}
