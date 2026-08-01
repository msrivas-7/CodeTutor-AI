import { useEffect, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { CinematicLighting } from "../components/cinema/CinematicLighting";
import { FilmGrain } from "../components/cinema/FilmGrain";
import { Wordmark } from "../components/Wordmark";

const UPDATED = "July 31, 2026";
const SUPPORT_EMAIL = "support@msrivas.com";

interface SectionProps {
  id?: string;
  title: string;
  children: ReactNode;
}

function Section({ id, title, children }: SectionProps) {
  return (
    <section id={id} className="scroll-mt-24 border-t border-border-soft/70 pt-8">
      <h2 className="font-display text-2xl font-semibold tracking-tight text-ink">
        {title}
      </h2>
      <div className="mt-3 space-y-3 text-base leading-7 text-muted sm:text-[15px]">
        {children}
      </div>
    </section>
  );
}

function PrivacyContent() {
  return (
    <>
      <Section title="The short version">
        <p>
          CodeTutor stores what it needs to run your account and learning workspace. We do
          not sell personal information and we do not use it for targeted advertising.
        </p>
      </Section>
      <Section title="Information we collect">
        <ul className="list-disc space-y-2 pl-5 marker:text-accent">
          <li>Account details such as your name, email address, and sign-in provider.</li>
          <li>Your code, lesson progress, preferences, tutor conversations, feedback, and projects.</li>
          <li>Service and security data such as request timing, usage counts, errors, and abuse signals.</li>
          <li>
            For the signed-out trial, a one-way hash derived from the network address is used
            for rate limits and short-lived learning continuity. The raw address is not stored in
            those trial ledgers.
          </li>
        </ul>
      </Section>
      <Section id="ai" title="How code and AI requests are used">
        <p>
          When you ask the tutor for help, the relevant prompt, lesson context, and code are
          sent through CodeTutor's server to OpenAI to generate the response. Code you run is
          sent to an isolated execution environment so the program can be evaluated.
        </p>
        <p>
          If you save your own OpenAI API key, CodeTutor encrypts it at rest and uses it only
          to make tutor requests you initiate. The interface never returns the stored key.
        </p>
        <p>
          Signed-out learners can separately choose to help improve tutor quality. This choice
          is off by default. When enabled, 5% of successful, CodeTutor-funded anonymous tutor
          turns are selected. Before anything is saved, CodeTutor removes source code, files,
          selections, terminal input and output, paths, contact details, secrets, and unknown
          identifiers. Raw history and network addresses are not included. Conversations made
          with your own API key are never part of this program.
        </p>
        <p>
          These redacted quality samples expire within 30 days and are available only through
          audited administrator review. Turning the choice off stops new sampling and requests
          deletion of retained samples from that browser. If you later create an account, any
          retained samples from that browser are linked only so they appear in your export and
          are removed when your account is deleted. Sampled traffic never enters the protected
          evaluation holdout directly; reviewers can use a redacted pattern to author a new
          synthetic test instead.
        </p>
      </Section>
      <Section title="Service providers">
        <p>
          CodeTutor relies on service providers to operate the product: Microsoft Azure for
          hosting, execution, monitoring, and email; Supabase for authentication and database
          services; OpenAI for tutor responses; and Google or GitHub when you choose one of
          those sign-in methods. They receive only the information needed to perform those
          services under their own terms and privacy commitments.
        </p>
      </Section>
      <Section title="Public sharing">
        <p>
          A lesson share is public to anyone with its link. It can include the code snippet,
          lesson, completion details, and a display name only when that name is included in the
          share. Do not publish secrets or personal information in code. Signed-in learners can
          revoke their shares.
        </p>
      </Section>
      <Section title="Retention and control">
        <p>
          Account data is kept while the account is active. You can download a JSON copy of
          your data and permanently delete your account from Settings. Deletion removes active
          account data; limited copies may remain temporarily in protected backups and security
          records until they age out through normal operations or must be kept for legal reasons.
        </p>
        <p>
          Anonymous usage ledgers and anonymous shares have a 30-day retention target, and
          some short-lived handoff records expire sooner. Cleanup may not happen immediately
          at the boundary. You can ask us to access, correct, or delete information by
          contacting support.
        </p>
      </Section>
      <Section title="Browser storage and tracking">
        <p>
          CodeTutor uses browser storage and essential authentication data to keep you signed
          in, preserve the signed-out lesson handoff, and remember interface state. It does not
          use third-party advertising trackers. Because there is no targeted-ad tracking, the
          service does not currently change behavior in response to Do Not Track signals.
        </p>
      </Section>
      <Section title="Children and changes">
        <p>
          CodeTutor is not directed to children under 13. If you believe a child provided
          personal information, contact us so we can review and remove it. Material changes to
          this notice will be reflected here with a new updated date.
        </p>
      </Section>
    </>
  );
}

function TermsContent() {
  return (
    <>
      <Section title="Using CodeTutor">
        <p>
          CodeTutor is an educational coding service. By creating an account or using the
          service, you agree to these terms and the Privacy notice. You must be at least 13 and
          able to enter this agreement where you live; if you are under the age of majority,
          use the service with a parent or guardian's permission.
        </p>
      </Section>
      <Section title="Your account and content">
        <p>
          Keep your account secure and provide accurate account information. You retain your
          rights in code and other content you submit. You give CodeTutor permission to host,
          process, transmit, and display that content only as needed to provide, secure, and
          improve the service or when you deliberately create a public share.
        </p>
      </Section>
      <Section title="Responsible use">
        <p>Do not use CodeTutor to:</p>
        <ul className="list-disc space-y-2 pl-5 marker:text-accent">
          <li>break laws, infringe rights, or harm another person;</li>
          <li>probe, bypass, overload, or disrupt security and rate limits;</li>
          <li>run malware, mine cryptocurrency, attack networks, or access systems without permission;</li>
          <li>publish credentials, private data, or content you do not have permission to share; or</li>
          <li>automate account creation or resell access without written permission.</li>
        </ul>
      </Section>
      <Section title="AI and code execution">
        <p>
          Tutor responses and program output can be incomplete or wrong. Review important code
          yourself; CodeTutor is not a substitute for professional, security, legal, medical,
          or financial advice. If you connect your own OpenAI key, charges from that provider
          are your responsibility.
        </p>
      </Section>
      <Section title="Availability and changes">
        <p>
          The service may change, pause, impose limits, or discontinue features. There is no
          guaranteed uptime or permanent free allowance. We may suspend access that threatens
          the service or violates these terms, and we will use reasonable judgment when doing so.
        </p>
      </Section>
      <Section title="Warranty and responsibility">
        <p>
          CodeTutor is provided on an “as available” basis without promises that every feature,
          lesson, response, or execution result will be uninterrupted or error-free. To the
          extent permitted by law, CodeTutor and its operator are not responsible for indirect,
          incidental, or consequential losses arising from use of the service. Nothing here
          limits rights or remedies that cannot legally be limited.
        </p>
      </Section>
      <Section title="Ending use and updates">
        <p>
          You can stop using CodeTutor and delete your account at any time. We may update these
          terms as the product changes; the updated date and revised terms will appear here.
          Continuing to use the service after an update means you accept the revised terms.
        </p>
      </Section>
    </>
  );
}

function SupportContent() {
  return (
    <>
      <Section title="Get help">
        <p>
          Tell us what you were trying to do, what happened instead, and the device and browser
          you used. Do not include passwords, API keys, authentication links, or other secrets.
        </p>
        <a
          href={`mailto:${SUPPORT_EMAIL}?subject=CodeTutor%20support`}
          className="inline-flex min-h-11 items-center rounded-full bg-accent px-5 py-2 text-sm font-semibold text-bg transition hover:bg-accentMuted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        >
          Email {SUPPORT_EMAIL}
        </a>
      </Section>
      <Section title="Account and privacy requests">
        <p>
          Signed-in learners can export their data or delete their account from Settings. For
          access, correction, privacy, safety, or public-share concerns, email support from the
          address on your account when possible so we can verify the request safely.
        </p>
      </Section>
      <Section title="Something broken right now?">
        <p>
          Preserve your code locally, refresh once, and try again. If the secure runner is
          starting from cold, the first run can take around 20 seconds. Include the exact error
          text and approximate time in your support message.
        </p>
      </Section>
    </>
  );
}

const PAGE_COPY = {
  privacy: {
    eyebrow: "Trust center",
    title: "Privacy, in plain language.",
    intro: "What CodeTutor collects, why it needs it, and the controls you have.",
    content: <PrivacyContent />,
  },
  terms: {
    eyebrow: "Trust center",
    title: "Terms of use.",
    intro: "The practical rules for learning, building, and sharing with CodeTutor.",
    content: <TermsContent />,
  },
  support: {
    eyebrow: "Help",
    title: "Let's get you unstuck.",
    intro: "A direct path for product help, account questions, and privacy requests.",
    content: <SupportContent />,
  },
} as const;

export default function TrustPage() {
  const location = useLocation();
  const key = location.pathname.slice(1) as keyof typeof PAGE_COPY;
  const page = PAGE_COPY[key] ?? PAGE_COPY.support;

  useEffect(() => {
    const previous = document.title;
    document.title = `${page.title.replace(/\.$/, "")} | CodeTutor`;
    return () => {
      document.title = previous;
    };
  }, [page.title]);

  useEffect(() => {
    if (!location.hash) return;
    const id = decodeURIComponent(location.hash.slice(1));
    const target = document.getElementById(id);
    if (!target) return;
    const frame = window.requestAnimationFrame(() => {
      target.scrollIntoView({ block: "start" });
      if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
      target.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [location.hash, page]);

  return (
    <div className="relative min-h-screen overflow-hidden bg-bg text-ink">
      <CinematicLighting variant="key-only" intensity="soft" />
      <FilmGrain intensity="ambient" />
      <header className="relative mx-auto flex max-w-5xl items-center justify-between px-5 py-6 sm:px-8">
        <Link to="/" aria-label="CodeTutor home" className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
          <Wordmark size="md" />
        </Link>
        <Link to="/" className="inline-flex min-h-11 items-center rounded-md px-3 text-sm text-muted transition hover:bg-elevated hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
          Back to CodeTutor
        </Link>
      </header>
      <main className="relative mx-auto max-w-3xl px-5 pb-20 pt-10 sm:px-8 sm:pt-16">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">{page.eyebrow}</p>
        <h1 className="mt-4 text-balance font-display text-4xl font-semibold leading-tight tracking-tight sm:text-6xl">
          {page.title}
        </h1>
        <p className="mt-5 max-w-2xl text-lg leading-8 text-muted">{page.intro}</p>
        <p className="mt-3 text-xs text-faint">Updated {UPDATED}</p>
        <div className="mt-12 space-y-10">{page.content}</div>
      </main>
      <footer className="relative border-t border-border-soft/70 bg-panel/30 px-5 py-8 text-sm text-muted">
        <nav aria-label="Trust and support" className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-5 gap-y-2">
          <Link className="inline-flex min-h-11 items-center hover:text-ink" to="/privacy">Privacy</Link>
          <Link className="inline-flex min-h-11 items-center hover:text-ink" to="/terms">Terms</Link>
          <Link className="inline-flex min-h-11 items-center hover:text-ink" to="/support">Support</Link>
          <a className="inline-flex min-h-11 items-center hover:text-ink" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
        </nav>
      </footer>
    </div>
  );
}
