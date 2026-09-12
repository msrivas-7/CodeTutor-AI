import { Link } from "react-router-dom";
import { PublicPage } from "../features/marketing/public/PublicPage";
import { FIRST_LESSON_CONTRACT } from "../productContract";

// Phase A — A7 (per competitive-intel): the public /why-not-chatgpt page.
// The cheapest positioning win: every beginner's honest first question is
// "why wouldn't I just ask ChatGPT?" — so we answer it in public, on our
// own terms, including the cases where ChatGPT genuinely is the better
// tool. The credibility of the page comes from that concession; the
// conversion comes from naming the difference between GETTING an answer
// and being able to PRODUCE one.
//
// Deliberately a calm reading page with quiet shared background atmosphere.
// This is an argument, not a trailer. "Python" stays in the SEO
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
    <PublicPage
      className="public-surface public-comparison"
      composition="ambient"
      headerAction={
        <Link to="/login" className="brand-header-action public-back">
          Sign in
        </Link>
      }
      footerLinks={
        <nav aria-label="Product links">
          <Link to="/why-not-chatgpt">Why not ChatGPT?</Link>
          <a href="/learn-to-code/">Lessons</a>
          <Link to="/login">Sign in</Link>
          <a
            href="https://github.com/msrivas-7/CodeTutor-AI"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub
          </a>
          <a
            href="https://www.linkedin.com/in/msrivas7/"
            target="_blank"
            rel="noopener noreferrer"
          >
            LinkedIn
          </a>
        </nav>
      }
    >
      <div className="public-comparison-copy">
        <p className="public-eyebrow">The honest question</p>
        <h1 className="mt-5">Why not just use ChatGPT?</h1>
        <p className="public-intro mt-6">
          Fair question — ChatGPT is easy to open, remarkably capable, and can
          be an excellent learning partner. The difference is the product
          contract: a flexible assistant can help you learn, while CodeTutor is
          built to make practice, proof, and progression unavoidable.
        </p>

        <div className="public-comparison-rows">
          {DIFFERENCES.map((d) => (
            <section key={d.title} className="public-comparison-row">
              <h2>{d.title}</h2>
              <div className="public-comparison-pair">
                <div>
                  <p className="public-eyebrow text-faint">ChatGPT</p>
                  <p className="mt-3 text-muted">{d.them}</p>
                </div>
                <div>
                  <p className="public-eyebrow">CodeTutor</p>
                  <p className="mt-3 text-ink">{d.us}</p>
                </div>
              </div>
            </section>
          ))}
        </div>

        {/* The concession — this is what makes the rest believable. */}
        <section className="public-comparison-concession">
          <h2>
            When ChatGPT <em>is</em> the better tool
          </h2>
          <p className="mt-4 text-muted">
            If you already know how to code and need a one-off script, a regex,
            or a rubber duck at 2am — use ChatGPT. It's excellent at that, and
            pretending otherwise would be silly. This product is for the
            different job: going from "I can't code" to "I can" — which happens
            through your fingers, not your clipboard.
          </p>
        </section>

        {/* Receipts, not vibes: the standing refusals. */}
        <section className="mt-8">
          <h2>Promises we've made in writing</h2>
          <ul className="mt-4 flex flex-col gap-3 text-muted">
            <li>
              — There is no "give me the answer" button in the tutor. There
              never will be.
            </li>
            <li>
              — No streak-shame mechanics. Your streak is a fact we show you,
              not a leash.
            </li>
            <li>
              — A lesson is complete when you can do the thing, not when you've
              clicked through it.
            </li>
          </ul>
        </section>

        <div className="mt-12 flex flex-col items-start gap-3">
          <Link to={FIRST_LESSON_CONTRACT.route} className="public-action">
            Judge for yourself — try lesson 1, no signup →
          </Link>
          <p className="text-sm leading-relaxed text-muted">
            About {FIRST_LESSON_CONTRACT.estimatedMinutes} minutes, in your
            browser. The tutor is designed to guide the next thought without
            replacing your work — that's the point.
          </p>
        </div>
      </div>
    </PublicPage>
  );
}
