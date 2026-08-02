import { Link } from "react-router-dom";

export function MissingContentState({ kind }: { kind: "course" | "lesson" }) {
  const label = kind === "course" ? "course" : "lesson";
  return (
    <section
      role="status"
      aria-labelledby="missing-content-title"
      className="mx-auto flex max-w-lg flex-col items-center px-6 py-16 text-center"
    >
      <div
        aria-hidden="true"
        className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-elevated text-2xl text-muted ring-1 ring-border"
      >
        ?
      </div>
      <h1 id="missing-content-title" className="font-display text-2xl font-semibold text-ink">
        {kind === "course" ? "Course unavailable" : "Lesson unavailable"}
      </h1>
      <p className="mt-3 text-base leading-relaxed text-muted">
        We couldn't find this {label}. The link may be out of date, mistyped,
        or point to content that is not available yet.
      </p>
      <div className="mt-6 flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
        <Link
          to="/learn"
          className="inline-flex min-h-11 items-center justify-center rounded-lg bg-accent px-5 py-2 text-sm font-semibold text-bg transition hover:bg-accentMuted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Browse guided learning
        </Link>
        <Link
          to="/start"
          className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border bg-panel px-5 py-2 text-sm font-semibold text-muted transition hover:bg-elevated hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Go to Start
        </Link>
      </div>
    </section>
  );
}
