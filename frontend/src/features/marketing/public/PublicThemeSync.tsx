import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

function subscribePublicTheme(notify: () => void) {
  window.addEventListener("codetutor:route-change", notify);
  window.addEventListener("popstate", notify);
  return () => {
    window.removeEventListener("codetutor:route-change", notify);
    window.removeEventListener("popstate", notify);
  };
}

/** Reuse the pre-paint classifier; don't maintain a second workspace route list. */
export function useIsPublicTheme() {
  return useSyncExternalStore(
    subscribePublicTheme,
    () => document.documentElement.hasAttribute("data-public-theme"),
    () => false,
  );
}

/** The inline pre-paint script owns the classifier, including on reload. */
export function PublicThemeSync() {
  const location = useLocation();
  const { pathname, hash, key } = location;
  const navigationType = useNavigationType();
  const initialLocation = useRef(location);
  const fragmentSettled = useRef(false);
  useLayoutEffect(() => {
    if (fragmentSettled.current) return;
    const initial = initialLocation.current;
    const navigation = performance.getEntriesByType("navigation")[0] as
      | PerformanceNavigationTiming
      | undefined;
    if (
      initial.pathname !== "/" || !initial.hash ||
      location.key !== initial.key || location.pathname !== initial.pathname ||
      location.search !== initial.search || location.hash !== initial.hash ||
      navigation?.type === "back_forward"
    ) {
      fragmentSettled.current = true;
      return;
    }
    let id: string;
    try {
      id = decodeURIComponent(initial.hash.slice(1));
    } catch {
      fragmentSettled.current = true;
      return;
    }

    // Native fragment scrolling can run before the lazy homepage exists.
    // Wait for its actual content, not its graphics, and never replay a scroll
    // after the visitor takes control or navigates elsewhere (including Back).
    const events = ["pointerdown", "touchstart", "wheel", "keydown"] as const;
    const cleanup = () => {
      observer.disconnect();
      events.forEach(event => window.removeEventListener(event, cancel, true));
    };
    const cancel = () => {
      fragmentSettled.current = true;
      cleanup();
    };
    const restore = () => {
      const homepage = document.querySelector('[data-marketing="glyph-homepage"]');
      if (!homepage) return;
      cancel();
      const target = document.getElementById(id);
      if (target && homepage.contains(target)) {
        target.scrollIntoView({ behavior: "instant", block: "start" });
        // WebKit does not move its sequential keyboard starting point when a
        // late fragment is only scrolled. Match the native anchor handoff.
        // Focus the section's heading, not its full multi-screen layout box.
        const focusTarget = target.matches("section")
          ? target.querySelector<HTMLElement>("h1, h2") ?? target
          : target;
        if (!focusTarget.hasAttribute("tabindex")) focusTarget.tabIndex = -1;
        focusTarget.focus({ preventScroll: true });
      }
    };
    const observer = new MutationObserver(restore);
    observer.observe(document.body, { childList: true, subtree: true });
    events.forEach(event => window.addEventListener(event, cancel, { capture: true, passive: true }));
    restore();
    // StrictMode may re-arm an unfulfilled request; only fulfillment or actual
    // visitor intent consumes it, not effect cleanup itself.
    return cleanup;
  }, [location]);
  useLayoutEffect(() => {
    window.dispatchEvent(new Event("codetutor:route-change"));
    // New public destinations start with their heading, even when the link
    // was in a long page's footer. Leave history restoration and explicit
    // anchors to the browser/owning page; never move an internal workspace.
    if (
      navigationType !== "POP" &&
      !hash &&
      document.documentElement.hasAttribute("data-public-theme")
    ) {
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    }
  }, [pathname, hash, key, navigationType]);
  return null;
}
