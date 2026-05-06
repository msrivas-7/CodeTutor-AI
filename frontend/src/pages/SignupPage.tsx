import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { AuthShell } from "../auth/AuthShell";
import { OAuthButtons } from "../auth/OAuthButtons";
import { PasswordField } from "../auth/PasswordField";
import { ResendEmailButton } from "../auth/ResendEmailButton";
import { isValidEmail } from "../auth/emailValidation";
import { isPasswordAcceptable } from "../auth/passwordPolicy";
import { useAuthStore } from "../auth/authStore";
import { api } from "../api/client";
import { readAnonStash } from "../features/anon/anonStash";

export default function SignupPage() {
  const nav = useNavigate();
  // Phase 20-P0 #9: when account-deletion finishes we redirect here with
  // `?deleted=1` so the user gets a gentle confirmation rather than a
  // silent bounce. The banner auto-hides if they start typing — it's not
  // a blocker, just a closure signal.
  const [searchParams] = useSearchParams();
  const justDeleted = searchParams.get("deleted") === "1";
  const user = useAuthStore((s) => s.user);
  const loading = useAuthStore((s) => s.loading);
  const signUpWithPassword = useAuthStore((s) => s.signUpWithPassword);
  const resendSignupConfirmation = useAuthStore(
    (s) => s.resendSignupConfirmation,
  );
  const clearError = useAuthStore((s) => s.clearError);

  // Phase 22B: lastName dropped — the cinematic onboarding is firstName-only
  // (3 spoken beats: hero "Hello, ${firstName}", greet, praise) and lastName
  // appeared nowhere else in the experience. Cutting one field is a
  // measurable conversion win on the signup wall without any narrative loss.
  const [firstName, setFirstName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  // Phase 27-v2.2 audit fix A3 follow-on (staff-pm P2-2): guard against
  // StrictMode / re-render double-fire of anon_signup_completed.
  const signupEventFiredRef = useRef(false);

  // Display-name validation is intentionally permissive: names contain
  // apostrophes (O'Neil), hyphens (Anne-Marie), spaces, and non-Latin
  // characters. We check only length + non-emptiness; everything stricter
  // tends to reject real people.
  const firstNameValid = firstName.trim().length > 0 && firstName.trim().length <= 50;

  // If the Supabase project has email confirmation OFF (local dev default),
  // signUp completes with a live session attached. The auth subscriber will
  // push that into the store within a tick; when it does, we want the user
  // on the app — not parked on the "check your email" panel.
  // Phase 22C: in-product home is /start, not / (marketing page is /).
  useEffect(() => {
    if (sent && user) {
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
      nav("/start", { replace: true });
    }
  }, [sent, user, nav]);

  if (!loading && user && !sent) {
    return <Navigate to="/start" replace />;
  }

  const emailValid = email === "" || isValidEmail(email);
  const confirmValid = confirm === "" || confirm === password;
  const passwordOk = isPasswordAcceptable(password);
  const canSubmit =
    firstNameValid &&
    isValidEmail(email) &&
    passwordOk &&
    password === confirm &&
    !submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    clearError();
    setSubmitting(true);
    try {
      await signUpWithPassword(email.trim(), password, {
        firstName: firstName.trim(),
      });
      // Supabase default: email confirmation is ON. Show the check-inbox
      // panel rather than bouncing to `/` (which they can't access yet).
      // If the project has confirmations disabled, onAuthStateChange will
      // fire with a session immediately and RequireAuth flow takes over —
      // the `sent` screen is then just a momentary message.
      setSent(true);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  if (sent) {
    return (
      <AuthShell
        title="Check your email"
        subtitle={`We sent a confirmation link to ${email}. Click it to activate your account.`}
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
        <p className="text-center text-[11px] text-muted">
          If you don't see it, check your spam folder. The link expires in
          an hour.
        </p>
        <div className="mt-3 flex justify-center">
          <ResendEmailButton
            onResend={() => resendSignupConfirmation(email.trim())}
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
          <Link to="/login" className="text-accent hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      {justDeleted && (
        <div
          role="status"
          className="mb-3 rounded-md border border-success/30 bg-success/10 px-3 py-2 text-[11px] text-success"
        >
          Your account has been deleted.
        </div>
      )}
      {/* Phase 20-P1: OAuth above the long signup form — most users finish
          sign-up in 2 clicks via GitHub/Google and never see this form. */}
      <OAuthButtons disabled={submitting} />

      <div className="my-4 flex items-center gap-2 text-[10px] text-faint">
        <div className="h-px flex-1 bg-border" />
        <span>or sign up with email</span>
        <div className="h-px flex-1 bg-border" />
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3" noValidate>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="firstName" className="text-[11px] font-medium text-muted">
            First name
          </label>
          <input
            id="firstName"
            type="text"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            placeholder="Ada"
            autoComplete="given-name"
            maxLength={50}
            aria-invalid={firstName.length > 0 && !firstNameValid}
            disabled={submitting}
            className="rounded-md border border-border bg-elevated px-2.5 py-1.5 text-xs text-ink transition placeholder:text-faint focus:border-accent/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-danger/60"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="email" className="text-[11px] font-medium text-muted">
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            aria-invalid={!emailValid}
            disabled={submitting}
            className="rounded-md border border-border bg-elevated px-2.5 py-1.5 text-xs text-ink transition placeholder:text-faint focus:border-accent/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-danger/60"
          />
          {!emailValid && (
            <span className="text-[10px] text-danger">
              Enter a valid email address.
            </span>
          )}
        </div>

        <PasswordField
          id="password"
          label="Password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          disabled={submitting}
          showPolicy
          describedById="password-policy"
        />

        <div className="flex flex-col gap-1.5">
          <label htmlFor="confirm" className="text-[11px] font-medium text-muted">
            Confirm password
          </label>
          <input
            id="confirm"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            aria-invalid={!confirmValid}
            disabled={submitting}
            className="rounded-md border border-border bg-elevated px-2.5 py-1.5 text-xs text-ink transition focus:border-accent/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-danger/60"
          />
          {!confirmValid && (
            <span className="text-[10px] text-danger">
              Passwords don't match.
            </span>
          )}
          {confirmValid && confirm.length > 0 && confirm === password && (
            <span className="text-[10px] text-success">✓ Passwords match</span>
          )}
        </div>

        {err && (
          <div
            role="alert"
            className="rounded-md border border-danger/40 bg-danger/10 px-2.5 py-1.5 text-[11px] text-danger"
          >
            {err}
          </div>
        )}

        <button
          type="submit"
          disabled={!canSubmit}
          aria-busy={submitting}
          className="rounded-md bg-accent px-3 py-1.5 text-[11px] font-semibold text-bg transition hover:bg-accentMuted focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:bg-elevated disabled:text-faint"
        >
          {submitting ? "Creating account…" : "Create account"}
        </button>
      </form>
    </AuthShell>
  );
}
