const PUBLIC_APP_EXACT_PATHS = new Set([
  "/",
  "/why-not-chatgpt",
  "/privacy",
  "/terms",
  "/support",
  "/login",
  "/signup",
  "/reset-password",
  "/auth/callback",
]);

const PUBLIC_APP_PREFIXES = ["/s/", "/try/lesson/"];

const DEFERRED_AUTH_PATHS = new Set([
  "/",
  "/why-not-chatgpt",
  "/privacy",
  "/terms",
  "/support",
]);

function normalizePublicPathname(pathname: string): string {
  const lowerPathname = pathname.toLowerCase();
  if (lowerPathname === "/") return lowerPathname;
  return lowerPathname.replace(/\/+$/, "");
}

/**
 * Direct entries that can paint through the lightweight public route tree.
 *
 * The anonymous lesson deliberately uses the workspace visual theme, but it is
 * still a logged-out direct entry and does not need the authenticated app shell.
 * App.tsx retains the same public routes for SPA navigation after a workspace
 * entry has already selected the full route tree.
 */
export function shouldUsePublicApp(pathname: string): boolean {
  const normalizedPathname = normalizePublicPathname(pathname);
  if (PUBLIC_APP_EXACT_PATHS.has(normalizedPathname)) return true;
  return PUBLIC_APP_PREFIXES.some((prefix) =>
    normalizedPathname.startsWith(prefix)
  );
}

/** Acquisition and trust pages can defer session hydration until entry intent. */
export function shouldDeferAuthHydration(pathname: string): boolean {
  return DEFERRED_AUTH_PATHS.has(normalizePublicPathname(pathname));
}
