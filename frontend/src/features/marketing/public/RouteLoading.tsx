import { useLayoutEffect } from "react";
import { useLocation } from "react-router-dom";
import { PublicPage } from "./PublicPage";
import { useIsPublicTheme } from "./PublicThemeSync";

/** Public route waits keep the same navigation and canvas as the destination.
 * Workspace waits retain their existing presentation; no auth state is read. */
export function RouteLoading({ fullHeight = false }: { fullHeight?: boolean }) {
  const isPublic = useIsPublicTheme();
  const { pathname, search, hash } = useLocation();
  useLayoutEffect(() => {
    if (!isPublic) return;
    return () => {
      const active = document.activeElement;
      if (!(active instanceof HTMLElement) || !active.closest(".public-route-loading")) return;
      const link = active instanceof HTMLAnchorElement ? active : null;
      const mainFocused = active.id === "public-content";
      if (!link && !mainFocused) return;
      // Suspense replaces its fallback in the same commit. Restore only an
      // equivalent control on this destination, and never override new focus.
      requestAnimationFrame(() => {
        if (window.location.pathname + window.location.search + window.location.hash !== pathname + search + hash) return;
        if (document.activeElement !== document.body) return;
        // Nested lazy boundaries can replace one fallback with another before
        // the destination is ready. Hand focus through that shell too; its own
        // cleanup will transfer it when the final page arrives.
        const page = Array.from(document.querySelectorAll<HTMLElement>('.public-page, [data-marketing="glyph-homepage"]'))
          .find(candidate => candidate.getClientRects().length > 0);
        let target = mainFocused
          ? page?.querySelector<HTMLElement>("#public-content")
          : Array.from(page?.querySelectorAll<HTMLAnchorElement>("a") ?? []).find(candidate =>
              candidate.href === link!.href &&
              candidate.getAttribute("aria-label") === link!.getAttribute("aria-label") &&
              candidate.textContent === link!.textContent,
            );
        // The homepage deliberately has its own editorial layout, but its
        // skip, home and main destinations are equivalents of this shell's.
        if (!target && page?.matches('[data-marketing="glyph-homepage"]')) {
          if (mainFocused) target = page.querySelector<HTMLElement>("#study-title");
          else if (link?.classList.contains("public-skip")) target = page.querySelector<HTMLElement>(".study-skip");
          else if (link?.origin === window.location.origin && link.pathname === "/" && !link.search && !link.hash) {
            target = page.querySelector<HTMLElement>('[aria-label="CodeTutor AI home"]');
          }
        }
        // An activated skip requested readable content, not just offscreen
        // focus below the homepage artwork. Equivalent header links stay put.
        const revealHomepageMain = mainFocused && page?.matches('[data-marketing="glyph-homepage"]');
        target?.focus({ preventScroll: !revealHomepageMain });
      });
    };
  }, [isPublic, pathname, search, hash]);
  if (!isPublic) {
    return (
      <div className={`route-loading flex ${fullHeight ? "min-h-screen" : "h-full"} items-center justify-center bg-bg text-muted`}>
        <span className="skeleton h-4 w-32 rounded" />
      </div>
    );
  }
  const auth = /^\/(?:login|signup|reset-password|auth\/callback)\/?$/i.test(pathname);
  return (
    <PublicPage
      className="public-route-loading"
      composition={auth ? "auth" : "ambient"}
      focusOnNavigation={false}
      documentNavigation
    >
      <div role="status" className="text-muted">
        <h1 className="sr-only">Loading page</h1>
        <p>Loading…</p>
      </div>
    </PublicPage>
  );
}
