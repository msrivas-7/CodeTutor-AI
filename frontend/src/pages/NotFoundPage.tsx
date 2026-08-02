import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { CinematicLighting } from "../components/cinema/CinematicLighting";
import { FilmGrain } from "../components/cinema/FilmGrain";
import { Wordmark } from "../components/Wordmark";
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
    <div className="relative min-h-screen overflow-hidden bg-bg text-ink">
      <CinematicLighting
        variant="three-point"
        fadeInMs={300}
        keyColor="accent"
        intensity="soft"
      />
      <FilmGrain intensity="hero" fadeInMs={300} />

      <header className="relative mx-auto flex max-w-5xl items-center px-5 pt-7 sm:px-10 sm:pt-10">
        <Link
          to="/"
          aria-label="CodeTutor AI home"
          className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-4 focus-visible:ring-offset-bg"
        >
          <Wordmark size="md" />
        </Link>
      </header>

      <main className="relative mx-auto flex min-h-[calc(100vh-5rem)] max-w-5xl items-center px-5 py-12 sm:px-10 sm:py-16">
        <section className="w-full max-w-2xl">
          <div className="font-mono text-xs font-semibold uppercase tracking-[0.2em] text-accent">
            Route not found · 404
          </div>
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
            <Link
              to="/"
              className="inline-flex min-h-11 items-center justify-center rounded-full bg-gradient-to-r from-violet to-accent px-5 py-2.5 text-sm font-bold text-bg shadow-glow transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
            >
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
      </main>
    </div>
  );
}
