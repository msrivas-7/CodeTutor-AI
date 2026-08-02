import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { AuthShell } from "../auth/AuthShell";
import { PasswordSignupForm } from "../auth/PasswordSignupForm";
import { ResendEmailButton } from "../auth/ResendEmailButton";
import { useAuthStore } from "../auth/authStore";
import { api } from "../api/client";
import { readAnonStash } from "../features/anon/anonStash";
import { authPath, authReturnTarget } from "../auth/returnTarget";

export default function SignupPage() {
  const nav = useNavigate();
  const location = useLocation();
  // Phase 20-P0 #9: when account-deletion finishes we redirect here with
  // `?deleted=1` so the user gets a gentle confirmation rather than a
  // silent bounce. It is a status message, not a blocker.
  const [searchParams] = useSearchParams();
  const justDeleted = searchParams.get("deleted") === "1";
  const returnTo = authReturnTarget(location.search, location.state);
  const destination = readAnonStash() !== null ? "/start" : returnTo;
  const user = useAuthStore((s) => s.user);
  const loading = useAuthStore((s) => s.loading);
  const resendSignupConfirmation = useAuthStore(
    (s) => s.resendSignupConfirmation,
  );
  const [sentEmail, setSentEmail] = useState<string | null>(null);
  // Phase 27-v2.2 audit fix A3 follow-on (staff-pm P2-2): guard against
  // StrictMode / re-render double-fire of anon_signup_completed.
  const signupEventFiredRef = useRef(false);

  // If the Supabase project has email confirmation OFF (local dev default),
  // signUp completes with a live session attached. The auth subscriber will
  // push that into the store within a tick; when it does, we want the user
  // on the app — not parked on the "check your email" panel.
  // Phase 22C: in-product home is /start, not / (marketing page is /).
  useEffect(() => {
    if (sentEmail && user) {
      // Phase 27-v2.2 Fix 6 — funnel telemetry: anon_signup_completed
      // fires when a freshly-created user has the anon-trial stash
      // present (Maya converted from /try/). Direct-signup users (no
      // stash) don't emit this event — that's the event's whole
      // discriminator. Fire BEFORE nav so even a slow route transition
      // doesn't lose the event. Fire-and-forget. The matching
      // anon_lesson2_reached fires after StartPage's handoff success
      // branch — tells us whether the conversion stuck end-to-end.
      if (!signupEventFiredRef.current && readAnonStash() !== null) {
        signupEventFiredRef.current = true;
        api.postFunnelEvent("anon_signup_completed");
      }
      nav(destination, { replace: true });
    }
  }, [sentEmail, user, nav, destination]);

  if (!loading && user && !sentEmail) {
    return <Navigate to={destination} replace />;
  }

  if (sentEmail) {
    return (
      <AuthShell
        title="Check your email"
        subtitle={`We sent a confirmation link to ${sentEmail}. Click it to activate your account.`}
        footer={
          <button
            type="button"
            onClick={() => nav("/login")}
            className="text-accent hover:underline"
          >
            Back to sign in
          </button>
        }
      >
        <p className="text-center text-sm text-muted">
          If you don't see it, check your spam folder. The link expires in
          an hour.
        </p>
        <div className="mt-3 flex justify-center">
          <ResendEmailButton
            onResend={() => resendSignupConfirmation(sentEmail, destination)}
            label="confirmation email"
          />
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Create your account"
      subtitle="Make a place for yourself. Your work, anywhere you sign in."
      footer={
        <>
          Already have an account?{" "}
          <Link to={authPath("/login", returnTo)} className="text-accent hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      {justDeleted && (
        <div
          role="status"
          className="mb-3 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-success"
        >
          Your account has been deleted.
        </div>
      )}
      <PasswordSignupForm
        idPrefix="signup-page"
        returnTo={destination}
        onSubmitted={setSentEmail}
      />
    </AuthShell>
  );
}
