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
      const alreadyMeaningful = active instanceof HTMLElement &&
        active !== document.body &&
        active.isConnected &&
        active.matches("a, button, input, select, textarea, h1, main");
      if (alreadyMeaningful) return;
      const target = document.querySelector<HTMLElement>(
        "main h1, h1, #main-content",
      );
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
