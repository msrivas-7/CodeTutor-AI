import { Link } from "react-router-dom";
import { MarketingNav } from "../features/marketing/components/MarketingNav";
import { MarketingFooter } from "../features/marketing/components/MarketingFooter";

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
    them: "ChatGPT hands you working code. You paste it, it runs, and the moment passes — along with the learning.",
    us: "Our tutor asks you a question first. It will hint, narrow, and nudge — but the line of code that fixes it comes out of your keyboard.",
  },
  {
    title: "The shape of the journey",
    them: "A chat thread has no map. Every session starts from a blank box, and 'what should I learn next?' is your problem.",
    us: "A curriculum with a visible shape and an end: lessons build on each other, your dashboard shows the whole road, and next is always one click.",
  },
  {
    title: "What 'done' means",
    them: "A conversation ends when you stop typing. Nothing checks whether any of it stuck.",
    us: "A lesson counts only when your code passes real checks — and you answer a cold retrieval question before we call it complete.",
  },
  {
    title: "Where the code runs",
    them: "Code in a chat window is text. You read it; you rarely run it.",
    us: "Every lesson is a live workspace. You type, run, and watch real output — including the errors, which is where the learning is.",
  },
];

export default function WhyNotChatGPTPage() {
  return (
    <div className="min-h-screen bg-bg text-ink">
      <MarketingNav />
      <main className="mx-auto max-w-3xl px-5 pb-8 pt-28 sm:px-8">
        <p className="text-[12px] font-semibold uppercase tracking-wider text-accent">
          The honest question
        </p>
        <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight sm:text-5xl">
          Why not just use ChatGPT?
        </h1>
        <p className="mt-5 text-base leading-relaxed text-muted">
          Fair question — it's free, it's brilliant, and it will happily write
          every line of code you ever ask for. That's exactly the problem.
          Getting an answer and being able to produce one are different
          skills, and only one of them is called "knowing how to code."
        </p>

        <div className="mt-12 flex flex-col gap-6">
          {DIFFERENCES.map((d) => (
            <section
              key={d.title}
              className="rounded-xl border border-border bg-panel p-5"
            >
              <h2 className="text-sm font-bold text-ink">{d.title}</h2>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg bg-elevated/60 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-faint">
                    A chat assistant
                  </p>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
                    {d.them}
                  </p>
                </div>
                <div className="rounded-lg bg-accent/5 p-3 ring-1 ring-accent/20">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-accent">
                    CodeTutor
                  </p>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-ink/90">
                    {d.us}
                  </p>
                </div>
              </div>
            </section>
          ))}
        </div>

        {/* The concession — this is what makes the rest believable. */}
        <section className="mt-12 rounded-xl border border-border-soft/60 bg-panel/60 p-5">
          <h2 className="text-sm font-bold text-ink">
            When ChatGPT <em>is</em> the better tool
          </h2>
          <p className="mt-2 text-[13px] leading-relaxed text-muted">
            If you already know how to code and need a one-off script, a
            regex, or a rubber duck at 2am — use ChatGPT. It's excellent at
            that, and pretending otherwise would be silly. This product is
            for the different job: going from "I can't code" to "I can" —
            which happens through your fingers, not your clipboard.
          </p>
        </section>

        {/* Receipts, not vibes: the standing refusals. */}
        <section className="mt-8">
          <h2 className="text-sm font-bold text-ink">
            Promises we've made in writing
          </h2>
          <ul className="mt-3 flex flex-col gap-1.5 text-[13px] leading-relaxed text-muted">
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
            to="/try/lesson/python-fundamentals/hello-world"
            className="rounded-lg bg-gradient-to-r from-accent to-violet px-6 py-3 text-sm font-bold text-bg shadow-glow transition hover:opacity-90"
          >
            Judge for yourself — try lesson 1, no signup →
          </Link>
          <p className="text-[11px] text-faint">
            Ten minutes, in your browser. The tutor will refuse to write it
            for you — that's the point.
          </p>
        </div>
      </main>
      <MarketingFooter />
    </div>
  );
}
