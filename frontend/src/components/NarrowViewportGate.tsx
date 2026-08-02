import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useFirstRunStore } from "../features/firstRun/useFirstRunStore";

// Phase 20-P3 Bucket 3 (#5): soft "your screen is narrow" nudge.
//
// The editor + lesson layout assumes ≥1024 px wide. On phones (< 640 px) it
// collapses to something barely usable; on tablets (640–1023 px) it's
// cramped but functional. We don't block either — users who want to push
// through on a phone can, that's their call. We just show a dismissible
// banner that explains why a laptop is better.
//
// QA-M5: dismissal is localStorage-scoped and keyed on screen-class ("phone"
// / "tablet"). A tablet user who dismisses doesn't see the banner again in
// any new tab; if they switch to a phone later, the phone-specific banner
// still shows. Before, sessionStorage meant every new tab re-showed it.

export const PHONE_MAX_PX = 639;
export const TABLET_MAX_PX = 1023;
export const DISMISS_KEY_PREFIX = "ui:narrow-viewport-dismissed:";

export type Size = "phone" | "tablet" | "wide";

export function dismissKey(size: Size): string {
  return `${DISMISS_KEY_PREFIX}${size}`;
}

export function readSize(widthPx?: number): Size {
  const w = typeof widthPx === "number"
    ? widthPx
    : (typeof window === "undefined" ? Number.POSITIVE_INFINITY : window.innerWidth);
  if (w <= PHONE_MAX_PX) return "phone";
  if (w <= TABLET_MAX_PX) return "tablet";
  return "wide";
}

// Phase A — A2: paths where the gate is fully suppressed (no banner,
// no apologetic copy). Today the only entry is `/try/` — Maya's anon
// trial path. Authed `/learn/` and the editor page keep the banner.
// Extracted as a pure helper so the suppression rule is unit-testable
// without standing up a renderer.
export function shouldSuppressForPath(pathname: string): boolean {
  return pathname.startsWith("/try/") || pathname === "/try";
}

export function NarrowViewportGate() {
  const dismissRef = useRef<HTMLButtonElement>(null);
  const [size, setSize] = useState<Size>(() => readSize());
  const [dismissedSizes, setDismissedSizes] = useState<Set<Size>>(() => {
    if (typeof window === "undefined") return new Set();
    const next = new Set<Size>();
    for (const s of ["phone", "tablet"] as const) {
      if (localStorage.getItem(dismissKey(s)) === "1") next.add(s);
    }
    return next;
  });

  useEffect(() => {
    const update = () => setSize(readSize());
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // Phase A — A2 (device contract): hard-suppress on the anon `/try/*`
  // surface — Maya should NEVER see "you'll have a better time on a
  // laptop" before she has the trial product in her hands. Phone is
  // the discovery surface; the warm graduation handoff (after lesson 1
  // completion) is the right moment to introduce "open this on a
  // laptop." Authed `/learn/.../` keeps the banner — that surface IS
  // the laptop-learning surface, and the apologetic prompt is
  // information the learner can use after committing.
  const location = useLocation();
  const suppressForPath = shouldSuppressForPath(location.pathname);

  // Phase 27-v2.2 Fix 4 — suppress during the first-run choreography
  // flow on /welcome → /learn/.../?firstRun=1. The banner takes a
  // strip of screen real estate at top-2 z-40 — visually obscured
  // behind the cinematic (z-60) and coach (z-50/51) but still
  // consuming layout space when those overlays clear and the lesson
  // chrome briefly transitions. While the cinematic is showing OR
  // the scripted walkthrough is mid-flight (firstRunStep !== "idle"
  // && !== "done"), the banner stays hidden. Re-shows on dashboard /
  // non-first-run pages and after the walkthrough reaches "done".
  // `cinematicShowing` is the flag CinematicGreeting toggles on
  // mount/unmount (Phase 27-v2.1 audit fix #4).
  const cinematicShowing = useFirstRunStore((s) => s.cinematicShowing);
  const firstRunStep = useFirstRunStore((s) => s.step);
  const choreographyActive =
    firstRunStep !== "idle" && firstRunStep !== "done";

  if (suppressForPath) return null;
  if (cinematicShowing || choreographyActive) return null;
  if (size === "wide" || dismissedSizes.has(size)) return null;

  const onDismiss = () => {
    localStorage.setItem(dismissKey(size), "1");
    setDismissedSizes((prev) => {
      const next = new Set(prev);
      next.add(size);
      return next;
    });
    window.setTimeout(() => {
      const firstWorkspaceControl = document.querySelector<HTMLElement>(
        "#main-content button, #main-content a[href], #main-content select, #main-content textarea, #main-content [tabindex]:not([tabindex='-1'])",
      );
      firstWorkspaceControl?.focus();
    }, 0);
  };

  const isPhone = size === "phone";
  const headline = isPhone
    ? "You'll have a better time on a laptop"
    : "Looking a little cramped";
  const body = isPhone
    ? "CodeTutor's editor and lessons are built for bigger screens. Things will feel squeezed on a phone — you're welcome to keep going, but a laptop or tablet will make everything easier to read and tap."
    : "The editor is designed for wider screens. Everything fits on your tablet, but panels are tight. For the best experience, open this on a laptop when you have one handy.";

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-10 left-2 right-2 z-40 rounded-lg border border-border bg-panel/95 px-3 py-2 text-xs text-ink shadow-md backdrop-blur sm:left-auto sm:right-3 sm:w-[26rem]"
      style={{ maxWidth: "calc(100vw - 1rem)" }}
    >
      <div className="flex items-start gap-2">
        <svg
          className="mt-[2px] h-4 w-4 flex-shrink-0 text-accent"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="2" y="4" width="20" height="14" rx="2" />
          <line x1="2" y1="20" x2="22" y2="20" />
        </svg>
        <div className="flex-1">
          <p className="font-medium text-ink">{headline}</p>
          <p className="mt-0.5 text-[11px] text-muted">{body}</p>
        </div>
        <button
          ref={dismissRef}
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="ml-1 flex min-h-11 min-w-11 flex-shrink-0 items-center justify-center rounded text-muted hover:bg-border/40 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <svg
            className="h-3.5 w-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>
  );
}
