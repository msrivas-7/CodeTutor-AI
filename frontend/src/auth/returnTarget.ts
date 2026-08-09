import type { Location } from "react-router-dom";

const RETURN_TARGET_KEY = "codetutor.auth.return-target";
const FALLBACK = "/start";

function isAuthLoop(pathname: string): boolean {
  return ["/login", "/signup", "/auth/callback", "/reset-password"].some(
    (route) => pathname === route,
  );
}

/** Accept only same-origin application paths and never return into auth. */
export function normalizeReturnTarget(
  value: string | null | undefined,
  fallback = FALLBACK,
): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return fallback;
  }

  try {
    const origin = typeof window === "undefined"
      ? "https://codetutor.invalid"
      : window.location.origin;
    const parsed = new URL(value, origin);
    if (parsed.origin !== origin || isAuthLoop(parsed.pathname)) {
      return fallback;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

export function locationReturnTarget(location: Pick<Location, "pathname" | "search" | "hash">): string {
  return normalizeReturnTarget(
    `${location.pathname}${location.search}${location.hash}`,
  );
}

export function authReturnTarget(
  search: string,
  state: unknown,
): string {
  const queryTarget = new URLSearchParams(search).get("returnTo");
  const from = (state as { from?: Partial<Location> } | null)?.from;
  const stateTarget = from?.pathname
    ? `${from.pathname}${from.search ?? ""}${from.hash ?? ""}`
    : null;
  return normalizeReturnTarget(queryTarget ?? stateTarget);
}

export function callbackUrl(returnTo: string): string {
  const callback = new URL("/auth/callback", window.location.origin);
  callback.searchParams.set("returnTo", normalizeReturnTarget(returnTo));
  return callback.toString();
}

export function rememberReturnTarget(returnTo: string): void {
  try {
    sessionStorage.setItem(RETURN_TARGET_KEY, normalizeReturnTarget(returnTo));
  } catch {
    // Private browsing can deny storage. The callback query remains primary.
  }
}

export function consumeReturnTarget(search: string): string {
  const queryTarget = new URLSearchParams(search).get("returnTo");
  let stored: string | null = null;
  try {
    stored = sessionStorage.getItem(RETURN_TARGET_KEY);
    sessionStorage.removeItem(RETURN_TARGET_KEY);
  } catch {
    // Fall through to query/default.
  }
  return normalizeReturnTarget(queryTarget ?? stored);
}

export function authPath(
  path: "/login" | "/signup",
  returnTo: string,
  reason?: "session-ended",
): string {
  const params = new URLSearchParams({
    returnTo: normalizeReturnTarget(returnTo),
  });
  if (reason) params.set("reason", reason);
  return `${path}?${params.toString()}`;
}
