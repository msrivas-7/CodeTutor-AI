import { useEffect, useRef, useState } from "react";

// Shared loader shown during the auth-resolve → store-hydrate sequence.
// RequireAuth renders it first (waiting for `useAuthStore.loading`); the
// HydrationGate renders the same component while the three user-scoped
// stores hydrate. Keeping the DOM identical across that hand-off prevents
// the 150-300ms visual flicker we'd otherwise get from swapping one
// skeleton for another.
//
// Minimum display duration: the loader paints for at least MIN_VISIBLE_MS
// once mounted. Without a floor, a sub-50ms hydrate on a warm cache
// produces a one-frame flash that reads as a visual glitch. A brief but
// deterministic loader is calmer than an instant hand-off that flickers.
//
// Progress: the caller passes a `progress` in [0,1]. We smooth it with a
// CSS transition, and nudge the displayed value to at least 8% on mount
// so the bar never renders as a flat zero-width line. Actual progress
// overrides the nudge as soon as it exceeds 8%.

const MIN_VISIBLE_MS = 1_000;

export interface AuthLoaderProps {
  label?: string;
  testId?: string;
  // 0..1. Caller computes: (# of dependencies finished) / (# total).
  // Omit to fall back to an indeterminate shimmer.
  progress?: number;
  // Optional sub-label shown under the main label — useful for surfacing
  // which dependency is in flight ("Loading your projects…").
  detail?: string;
  // When true, the loader latches on-screen for MIN_VISIBLE_MS after the
  // first paint even if the caller would otherwise unmount it. Default
  // true because the whole point of this prop is to avoid flicker;
  // callers can opt out (e.g. in tests) by passing `enforceMinDuration
  // ={false}`.
  enforceMinDuration?: boolean;
  // When `enforceMinDuration` is true and the parent would dismiss the
  // loader, it passes `done={true}` to signal "ready to hand off". The
  // loader then resolves as soon as the minimum has elapsed. We split
  // this from unmount-on-ready so the parent doesn't have to keep the
  // loader in its tree manually — see HydrationGate for the pattern.
  done?: boolean;
  onMinDurationReached?: () => void;
}

export function AuthLoader({
  label = "Setting up your workspace",
  detail,
  testId = "auth-loader",
  progress,
  enforceMinDuration = true,
  done = false,
  onMinDurationReached,
}: AuthLoaderProps) {
  const [minElapsed, setMinElapsed] = useState(!enforceMinDuration);

  // Stash the callback in a ref so its changing identity across parent
  // renders doesn't reset the timer below. HydrationGate re-renders
  // frequently (progress + elapsed tickers) and inlines this prop as an
  // arrow function, so without the ref the setTimeout would be cleared
  // and recreated every render and the minimum-duration gate would never
  // fire.
  const onMinRef = useRef(onMinDurationReached);
  useEffect(() => {
    onMinRef.current = onMinDurationReached;
  }, [onMinDurationReached]);

  useEffect(() => {
    if (!enforceMinDuration) return;
    const t = window.setTimeout(() => {
      setMinElapsed(true);
      onMinRef.current?.();
    }, MIN_VISIBLE_MS);
    return () => window.clearTimeout(t);
  }, [enforceMinDuration]);

  // If the caller has finished AND the minimum has elapsed, render a
  // transparent placeholder for one frame so the fade-out looks smooth
  // instead of a hard pop. The parent is responsible for swapping us out
  // on the next tick.
  const fading = done && minElapsed;

  // Determinate when we got a number, otherwise indeterminate shimmer.
  const hasProgress = typeof progress === "number";
  // Floor the displayed value at 8% on mount so the user sees forward
  // motion even before the first dependency resolves. Cap at 100%.
  const displayedPct = hasProgress
    ? Math.max(8, Math.min(100, Math.round(progress! * 100)))
    : 0;

  return (
    <div
      className={`relative flex h-full min-h-[320px] items-center justify-center overflow-hidden bg-bg text-ink transition-opacity duration-200 ${
        fading ? "opacity-0" : "opacity-100"
      }`}
      role="status"
      aria-live="polite"
      aria-busy={!done}
      data-testid={testId}
    >
      {/* Subtle animated gradient backdrop — uses existing accent/violet
          tokens so it matches AuthShell branding. Low opacity keeps focus
          on the card content. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,theme(colors.accent/.18),transparent_50%),radial-gradient(circle_at_80%_60%,theme(colors.violet/.16),transparent_55%)]"
      />

      <div className="relative z-10 flex w-full max-w-xs flex-col items-center gap-5">
        {/* Brand mark, identical to AuthShell so the loader feels like
            the same page. Pulse animation gives it life without being
            busy. */}
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-violet text-base font-bold text-bg shadow-glow animate-pulse">
          AI
        </div>

        <div className="flex flex-col items-center gap-1 text-center">
          <p className="text-sm font-semibold tracking-tight">{label}</p>
          {detail && (
            <p className="text-[11px] text-muted">{detail}</p>
          )}
        </div>

        {/* Progress track. In determinate mode: width follows `progress`.
            In indeterminate mode: a ~30%-wide sliver loops across the
            track (shimmer). */}
        <div
          className="relative h-1.5 w-full overflow-hidden rounded-full bg-elevated"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={hasProgress ? displayedPct : undefined}
          aria-label={label}
        >
          {hasProgress ? (
            <div
              className="h-full rounded-full bg-gradient-to-r from-accent to-violet transition-[width] duration-500 ease-out"
              style={{ width: `${displayedPct}%` }}
            />
          ) : (
            <div className="absolute inset-y-0 -left-1/3 h-full w-1/3 rounded-full bg-gradient-to-r from-transparent via-accent to-transparent animate-loader-shimmer" />
          )}
        </div>

        {hasProgress && (
          <p
            className="text-[10px] font-medium tabular-nums text-faint"
            aria-hidden="true"
          >
            {displayedPct}%
          </p>
        )}
      </div>
    </div>
  );
}

