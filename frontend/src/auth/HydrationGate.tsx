import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePreferencesStore } from "../state/preferencesStore";
import { useProgressStore } from "../features/learning/stores/progressStore";
import { useProjectStore } from "../state/projectStore";
import { useAuthStore } from "./authStore";
import { bumpGen } from "./generation";
import { AuthLoader } from "./AuthLoader";

// Elapsed thresholds for the loading-slowly escape hatches. 3s is the
// point where "Setting things up…" stops looking like normal latency and
// starts looking stuck — we soften the copy. 8s is the point where we
// treat "no hydrateError, just hanging" as effectively failed and offer
// the same Retry + Sign-out affordance as a real error. This matters
// most when a tab comes back from sleep with expired sockets — the
// fetch can hang until the browser's connection-recovery timeout fires.
const SLOW_MS = 3_000;
const STUCK_MS = 8_000;

function useLoadingElapsed(active: boolean): number {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number | null>(null);
  useEffect(() => {
    if (!active) {
      startRef.current = null;
      setElapsed(0);
      return;
    }
    startRef.current = Date.now();
    setElapsed(0);
    const id = window.setInterval(() => {
      if (startRef.current !== null) {
        setElapsed(Date.now() - startRef.current);
      }
    }, 500);
    return () => window.clearInterval(id);
  }, [active]);
  return elapsed;
}

// Phase 18b: after a user signs in, their preferences + progress are pulled
// from the server. Components that render pre-hydration would flash defaults
// (dark theme before the user's saved light theme; WelcomeOverlay before the
// welcomeDone flag lands; Monaco starter content before the persisted editor
// project) for a frame or two. This gate blocks the authenticated tree until
// every store reports `hydrated: true`, eliminating the whole class of
// hydration races.
//
// On fetch failure, stores now record `hydrateError` and leave `hydrated`
// at false so this gate stays up. That's intentional: if we let the app
// render with defaults after a transient Supabase outage, the first user
// mutation would overwrite the real row with those defaults. Instead we
// show a Retry button and a Sign-out escape hatch.
//
// Unauthenticated users bypass the gate — `useAuthStore.user` is null so
// there's no user state to hydrate yet; they see the login page directly.
export function HydrationGate({ children }: { children: ReactNode }) {
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);
  const prefsHydrated = usePreferencesStore((s) => s.hydrated);
  const prefsError = usePreferencesStore((s) => s.hydrateError);
  const progressHydrated = useProgressStore((s) => s.hydrated);
  const progressError = useProgressStore((s) => s.hydrateError);
  const editorHydrated = useProjectStore((s) => s.editorHydrated);
  const editorError = useProjectStore((s) => s.editorHydrateError);

  // Minimum display gate. Even if the three stores land in <50ms (warm
  // cache, test env), we hold the loader on screen for the AuthLoader's
  // configured minimum so a fast-path render doesn't flash for one frame
  // and read as a visual glitch.
  const [minElapsed, setMinElapsed] = useState(false);
  // Reset the min gate whenever the user changes — a fresh login should
  // also honor the minimum display, not be "already elapsed" from a
  // previous user's session.
  const userIdKey = user?.id ?? null;
  useEffect(() => {
    setMinElapsed(false);
  }, [userIdKey]);

  const dataReady =
    !!user && prefsHydrated && progressHydrated && editorHydrated;
  const stillLoading = !!user && (!dataReady || !minElapsed);
  const firstError = prefsError ?? progressError ?? editorError;
  const elapsed = useLoadingElapsed(stillLoading);

  // Only trip the stuck branch once data is actually outstanding. If the
  // stores are all hydrated and we're only holding on the min-display
  // timer, don't misreport that as "server hasn't responded".
  const showErrorBranch = stillLoading && !dataReady && (firstError || elapsed >= STUCK_MS);

  // Compute a 0..1 progress number so the bar advances as each store
  // finishes. Auth being resolved counts as the first step so the user
  // sees immediate forward motion rather than a flat-zero bar.
  const steps = [!!user, prefsHydrated, progressHydrated, editorHydrated];
  const completed = steps.filter(Boolean).length;
  const progress = completed / steps.length;

  const retry = () => {
    const g = bumpGen();
    void usePreferencesStore.getState().hydrate(g);
    void useProgressStore.getState().hydrate(g);
    void useProjectStore.getState().hydrateEditor(g);
  };

  if (showErrorBranch) {
    const headline = firstError
      ? "Couldn't load your data."
      : "Still loading — something's taking too long.";
    const detailMsg =
      firstError ?? "The server hasn't responded yet. You can retry or sign out.";
    return (
      <div
        className="flex h-full items-center justify-center bg-bg text-fg"
        role="alert"
        aria-live="assertive"
        data-testid="hydration-gate-error"
      >
        <div className="flex max-w-sm flex-col items-center gap-3 text-center">
          <p className="text-sm font-medium">{headline}</p>
          <p className="text-xs text-muted">{detailMsg}</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={retry}
              className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent/90"
            >
              Retry
            </button>
            <button
              type="button"
              onClick={() => void signOut()}
              className="rounded border border-border px-3 py-1.5 text-xs font-medium hover:bg-elevated"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (stillLoading) {
    const slow = elapsed >= SLOW_MS && !dataReady;
    // Automation (Playwright, Selenium, etc.) sets navigator.webdriver=true.
    // Skip AuthLoader's MIN_VISIBLE_MS floor in that case so e2e specs
    // don't each eat 6s waiting for the decorative reveal. Real users
    // keep the full choreographed intro.
    const isAutomated =
      typeof navigator !== "undefined" && navigator.webdriver === true;
    return (
      <div className="flex h-full flex-col bg-bg" data-testid="hydration-gate">
        <AuthLoader
          progress={progress}
          done={dataReady}
          enforceMinDuration={!isAutomated}
          onMinDurationReached={() => setMinElapsed(true)}
        />
        {slow && (
          <div className="flex justify-center pb-6">
            <button
              type="button"
              onClick={retry}
              className="text-xs text-accent underline hover:no-underline"
              data-testid="hydration-gate-retry-soft"
            >
              Retry
            </button>
          </div>
        )}
      </div>
    );
  }

  return <>{children}</>;
}
