import { useEffect } from "react";
import { useLocation } from "react-router-dom";

/**
 * Restores a meaningful keyboard arrival point after the full-screen welcome
 * replay returns to an authenticated route. It lives inside HydrationGate, so
 * the destination route has committed before this effect looks for its H1 or
 * main region.
 */
export function ReplayReturnFocus() {
  const location = useLocation();
  const shouldFocus = Boolean(
    (location.state as { focusAfterReplay?: boolean } | null)?.focusAfterReplay,
  );

  useEffect(() => {
    if (!shouldFocus) return;
    let userInteracted = false;
    const timers: number[] = [];
    const markInteraction = () => {
      userInteracted = true;
    };
    window.addEventListener("pointerdown", markInteraction, { capture: true });
    window.addEventListener("keydown", markInteraction, { capture: true });

    const focusDestination = () => {
      if (userInteracted) return;
      const active = document.activeElement;
      // Collapsed workspace panes deliberately keep their content mounted.
      // Ignore those hidden headings: focus() on a display-none H1 is a no-op
      // and would strand keyboard arrival on BODY after the replay.
      const heading = Array.from(
        document.querySelectorAll<HTMLElement>("main h1, h1"),
      ).find(
        (candidate) =>
          candidate.getClientRects().length > 0 &&
          !candidate.closest('[aria-hidden="true"], [inert]'),
      );
      const alreadyMeaningful = active instanceof HTMLElement &&
        active !== document.body &&
        active.isConnected &&
        active.matches("a, button, input, select, textarea, h1, main");
      // A slow lesson route can expose and focus <main> before its real H1 is
      // mounted. Keep that accessible interim arrival point, but let a later
      // retry upgrade it to the lesson title. Never steal focus from any
      // other meaningful control or from an interacted-with destination.
      const canUpgradeInterimMain = active instanceof HTMLElement &&
        active.matches("main") &&
        heading !== null;
      if (alreadyMeaningful && !canUpgradeInterimMain) return;
      const target = heading ?? document.querySelector<HTMLElement>("#main-content");
      if (!target) return;
      if (!target.matches("a, button, input, select, textarea, [tabindex]")) {
        target.tabIndex = -1;
      }
      target.focus({ preventScroll: true });
    };

    // A lesson can briefly mount a focused loading/status owner and then
    // replace it with the real workspace. Retry only across that bounded
    // handoff window; any actual learner interaction cancels every attempt.
    for (const delay of [200, 700, 1_400, 3_000, 5_000]) {
      timers.push(window.setTimeout(focusDestination, delay));
    }
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
      window.removeEventListener("pointerdown", markInteraction, {
        capture: true,
      });
      window.removeEventListener("keydown", markInteraction, { capture: true });
    };
  }, [location.key, shouldFocus]);

  return null;
}
