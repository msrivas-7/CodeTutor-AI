import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import {
  PublicPage,
} from "../features/marketing/public/PublicPage";
import { FIRST_LESSON_CONTRACT } from "../productContract";

export default function NotFoundPage() {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = "Page not found · CodeTutor AI";
    headingRef.current?.focus();
    return () => {
      document.title = previousTitle;
    };
  }, []);

  return (
    <PublicPage className="public-recovery" focusOnNavigation={false}>
      <div className="public-reading-header">
        <section className="public-recovery-copy">
          <div className="public-eyebrow">Route not found · 404</div>
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="mt-4 max-w-xl font-display text-4xl font-semibold leading-[1.05] tracking-tight text-ink outline-none sm:text-5xl md:text-6xl"
          >
            This page isn&apos;t here.
          </h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-muted sm:text-lg sm:leading-8">
            The address may be mistyped, or the page may have moved. Your
            account, lesson progress, and code have not been changed.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <Link to="/" className="public-action">
              Go to homepage
            </Link>
            <a
              href="/learn-to-code/"
              className="inline-flex min-h-11 items-center justify-center rounded-full border border-borderSoft bg-panel/80 px-5 py-2.5 text-sm font-medium text-ink transition hover:border-accent/40 hover:bg-accent/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
            >
              Browse public lessons
            </a>
            <Link
              to={FIRST_LESSON_CONTRACT.route}
              className="inline-flex min-h-11 items-center justify-center rounded-full px-5 py-2.5 text-sm font-medium text-muted transition hover:bg-panel/60 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
            >
              Try the first lesson
            </Link>
          </div>
        </section>
      </div>
    </PublicPage>
  );
}
