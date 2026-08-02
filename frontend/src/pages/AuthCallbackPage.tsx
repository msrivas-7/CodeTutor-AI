import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { AuthShell } from "../auth/AuthShell";
import { supabase } from "../auth/supabaseClient";
import { useAuthStore } from "../auth/authStore";
import { readAnonStash } from "../features/anon/anonStash";
import { api } from "../api/client";
import { authPath, consumeReturnTarget } from "../auth/returnTarget";

// Landing route for Supabase's email + OAuth redirects. Our client is
// configured with `detectSessionInUrl: true`, so `getSession()` kicks off
// the PKCE exchange automatically on mount. We just wait for it to resolve
// (or fail) and then either send the user into the app or surface the
// error.
//
// Microcopy notes: the failure message needs to be actionable, not just
// "failed". The three realistic causes (expired link, already-clicked
// link, unknown-tenant OAuth) all share the same fix — go back and start
// the sign-in again — so we surface that as a primary action rather than
// forcing the user to reason about a raw Supabase error string.

// Phase 20-P1: Supabase surfaces raw strings like `AuthApiError: invalid
// request: both auth code and code verifier should be non-empty` or
// `Email link is invalid or has expired`. Those are noise to a user and
// noise to a support ticket. Classify into 3 buckets we can actually act
// on. The raw message still goes to the console for debugging.
type AuthErrorKind = "expired" | "state" | "unknown";

function classifyAuthError(raw: string): AuthErrorKind {
  const s = raw.toLowerCase();
  if (s.includes("expired") || s.includes("already been used")) {
    return "expired";
  }
  // `code verifier` errors fire when the browser state got wiped between
  // starting and finishing the PKCE dance — e.g. the callback ran in a new
  // window, or cookies got cleared, or the user opened the link in a
  // different browser from the one that requested it.
  if (
    s.includes("code verifier") ||
    s.includes("flow_state_not_found") ||
    s.includes("invalid request")
  ) {
    return "state";
  }
  return "unknown";
}

function friendlyAuthMessage(kind: AuthErrorKind): string {
  switch (kind) {
    case "expired":
      return "That sign-in link has expired or already been used. Request a new one to continue.";
    case "state":
      return "We lost track of this sign-in. This usually happens if you opened the link in a different browser or cleared cookies mid-flow. Start again from the sign-in page.";
    case "unknown":
      return "Something went wrong finishing sign-in. Request a new link and try again.";
  }
}

export default function AuthCallbackPage() {
  const location = useLocation();
  const user = useAuthStore((s) => s.user);
  const [err, setErr] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  // Phase 27-v2.2 audit fix A3 (fresh-eyes + bug-hunter): the funnel
  // event `anon_signup_completed` was only fired from SignupPage's
  // email/password path. OAuth signups (and email-confirm-on flows
  // that land here post-confirm) never triggered it, so the funnel's
  // signup numerator silently undercounts and the wall→signup ratio
  // looks much lower than it is. Fire here when the session resolves
  // AND a fresh anon stash is present (only-when-relevant guard).
  // useRef prevents StrictMode double-mount from double-counting.
  const signupEventFiredRef = useRef(false);
  const returnTargetRef = useRef(consumeReturnTarget(location.search));
  const callbackError = new URLSearchParams(location.search).get("error");
  const callbackErrorDescription = new URLSearchParams(location.search).get(
    "error_description",
  );
  const oauthCancelled = callbackError === "access_denied";

  useEffect(() => {
    let cancelled = false;
    const handle = (raw: string) => {
      console.error("[auth-callback]", raw);
      setErr(friendlyAuthMessage(classifyAuthError(raw)));
    };
    if (callbackError) {
      setErr(
        oauthCancelled
          ? "Sign-in was canceled. Nothing changed — you can try again whenever you're ready."
          : "The sign-in provider couldn't finish this request. Try again or choose another sign-in method.",
      );
      if (callbackErrorDescription) {
        console.info("[auth-callback] provider response", callbackErrorDescription);
      }
      setReady(true);
      return () => {
        cancelled = true;
      };
    }
    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          handle(error.message);
        } else if (!data.session) {
          setErr(friendlyAuthMessage("expired"));
        } else if (!signupEventFiredRef.current && readAnonStash() !== null) {
          // Session resolved successfully + stash exists ⇒ this is an
          // anon→authed conversion landing on /auth/callback. Fire the
          // event before <Navigate> takes us to /start (where StartPage
          // will fire anon_lesson2_reached on handoff success).
          signupEventFiredRef.current = true;
          api.postFunnelEvent("anon_signup_completed");
        }
        setReady(true);
      })
      .catch((e) => {
        if (cancelled) return;
        handle((e as Error).message);
        setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [callbackError, callbackErrorDescription, oauthCancelled]);

  // Phase 22C: in-product home is /start (/ is the public marketing page).
  if (ready && user) {
    const destination = readAnonStash() !== null ? "/start" : returnTargetRef.current;
    return <Navigate to={destination} replace />;
  }

  return (
    <AuthShell
      title={err ? "We couldn't finish signing you in" : "Signing you in…"}
      subtitle={
        err ??
        "Verifying your link — this only takes a moment."
      }
      footer={
        err ? (
          <Link to={authPath("/login", returnTargetRef.current)} className="text-accent hover:underline">
            {oauthCancelled ? "Choose another sign-in method" : "Back to sign in"}
          </Link>
        ) : undefined
      }
    >
      {err ? (
        <div
          role="alert"
          aria-live="assertive"
          className="flex flex-col items-center gap-2 text-center text-xs text-muted"
        >
          <p>
            {oauthCancelled
              ? "Your account and lesson are unchanged."
              : "If you came from a magic-link email, request a new link. Links expire after an hour and can only be used once."}
          </p>
        </div>
      ) : (
        <div
          role="status"
          aria-live="polite"
          aria-busy="true"
          className="flex items-center justify-center gap-2 text-[11px] text-muted"
        >
          <span className="inline-block h-1.5 w-1.5 animate-pulseDot rounded-full bg-accent" />
          <span>Verifying your link…</span>
        </div>
      )}
    </AuthShell>
  );
}
