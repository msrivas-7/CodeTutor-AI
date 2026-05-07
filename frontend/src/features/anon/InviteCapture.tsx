// Phase A — A2 (device contract): magic-link invite capture.
//
// The graduation handoff email points learners at
// `/start?invite=<token>`. `/start` is gated by RequireAuth, so an
// unauthenticated learner who opens the link on their laptop gets
// bounced to `/login` — and react-router's default behavior drops the
// search params on the login → original-route round-trip (LoginPage's
// post-auth nav reads `from.pathname` only, not `from.search`). That
// would silently lose the invite token, defeating the device-contract
// promise.
//
// This component runs ABOVE the route tree on every navigation. When
// it sees `?invite=<token>` on any path, it stashes the token in
// sessionStorage and strips it from the URL. The downstream redemption
// logic (StartPage on mount) reads sessionStorage instead of the URL,
// so the invite survives the auth round-trip cleanly.
//
// SessionStorage (not local) so a learner who closes the tab and
// re-opens later doesn't accidentally redeem an old token; magic
// links are short-lived (24h) and single-use anyway, but tab-scoped
// is the principle of least surprise.

import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";

export const PENDING_INVITE_KEY = "codetutor.pendingLaptopInvite";

// 12-char Crockford-style alphabet (a–z minus l/o + 2–9). Same shape
// the backend route validates (`^[a-z2-9]{12}$`) AND the DB CHECK
// constraint enforces. We re-validate here so a malformed param
// doesn't pollute sessionStorage. Exported so the test pins the same
// regex source — drift between client and backend (or between the
// component and its test) would be silent otherwise.
export const TOKEN_RE = /^[a-z2-9]{12}$/;

export function InviteCapture() {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(location.search);
    const token = params.get("invite");
    if (!token) return;
    // Validate shape before storing — keeps junk out of sessionStorage
    // and gives the redemption call a tighter error surface.
    if (!TOKEN_RE.test(token)) {
      // Strip the bad param even if it's not a valid token shape; we
      // don't want it sitting in the URL for the rest of the session.
      params.delete("invite");
      navigate(
        { pathname: location.pathname, search: paramsToSearch(params) },
        { replace: true },
      );
      return;
    }
    try {
      window.sessionStorage.setItem(PENDING_INVITE_KEY, token);
    } catch {
      // Private-mode Safari etc. — fail soft. The redemption path
      // checks for the key and just skips when it's absent.
    }
    // Strip the param so a refresh doesn't replay the URL → side-
    // effect chain. sessionStorage is the single source of truth from
    // here on.
    params.delete("invite");
    navigate(
      { pathname: location.pathname, search: paramsToSearch(params) },
      { replace: true },
    );
  }, [location.search, location.pathname, navigate]);

  return null;
}

function paramsToSearch(params: URLSearchParams): string {
  const s = params.toString();
  return s.length > 0 ? `?${s}` : "";
}
