import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { isAuthError } from "@supabase/supabase-js";
import { AuthShell } from "../auth/AuthShell";
import { OAuthButtons } from "../auth/OAuthButtons";
import { PasswordField } from "../auth/PasswordField";
import { ResendEmailButton } from "../auth/ResendEmailButton";
import { isValidEmail } from "../auth/emailValidation";
import { useAuthStore } from "../auth/authStore";

type Mode = "password" | "magic-link" | "magic-link-sent" | "unverified-email";

export default function LoginPage() {
  const nav = useNavigate();
  const location = useLocation();
  const user = useAuthStore((s) => s.user);
  const loading = useAuthStore((s) => s.loading);
  const signInWithPassword = useAuthStore((s) => s.signInWithPassword);
  const signInWithMagicLink = useAuthStore((s) => s.signInWithMagicLink);
  const resendSignupConfirmation = useAuthStore((s) => s.resendSignupConfirmation);
  const clearError = useAuthStore((s) => s.clearError);


  const [mode, setMode] = useState<Mode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // If the user is already authenticated (eg. came here by typing the URL)
  // bounce straight through. Preserve `from` if present for symmetry with
  // RequireAuth's redirect state.
  if (!loading && user) {
    const to =
      (location.state as { from?: { pathname: string } } | null)?.from?.pathname ?? "/";
    return <Navigate to={to} replace />;
  }

  const emailValid = email === "" || isValidEmail(email);
  const canSubmitPassword = isValidEmail(email) && password.length > 0 && !submitting;
  const canSubmitMagic = isValidEmail(email) && !submitting;

  const handlePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    clearError();
    setSubmitting(true);
    try {
      await signInWithPassword(email.trim(), password);
      const to =
        (location.state as { from?: { pathname: string } } | null)?.from?.pathname ?? "/";
      nav(to, { replace: true });
    } catch (e) {
      // GoTrue returns `email_not_confirmed` when a user who signed up via
      // email/password tries to sign in before clicking the verification
      // link. The raw message ("Email not confirmed") in a red alert leaves
      // them stuck — no resend path, no guidance. Route into the dedicated
      // unverified-email panel, which mirrors the signup "check your inbox"
      // screen and reuses the same resend helper.
      if (isAuthError(e) && e.code === "email_not_confirmed") {
        setMode("unverified-email");
        return;
      }
      setErr((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    clearError();
    setSubmitting(true);
    try {
      await signInWithMagicLink(email.trim());
      setMode("magic-link-sent");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  if (mode === "unverified-email") {
    return (
      <AuthShell
        title="Confirm your email"
        subtitle={`Your account exists, but ${email} hasn't been verified yet. Check your inbox for the confirmation link — we can resend it if it's missing.`}
        footer={
          <button
            type="button"
            onClick={() => {
              setMode("password");
              setErr(null);
            }}
            className="text-accent hover:underline"
          >
            Back to sign in
          </button>
        }
      >
        <p className="text-center text-[11px] text-muted">
          The link expires in an hour. Spam folder is worth a check too.
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

  if (mode === "magic-link-sent") {
    return (
      <AuthShell
        title="Check your email"
        subtitle={`We sent a sign-in link to ${email}. Click it to finish signing in.`}
        footer={
          <button
            type="button"
            onClick={() => {
              setMode("magic-link");
              setErr(null);
            }}
            className="text-accent hover:underline"
          >
            Use a different email
          </button>
        }
      >
        <p className="text-center text-[11px] text-muted">
          The link expires in an hour. You can close this tab once you've
          clicked it.
        </p>
        <div className="mt-3 flex justify-center">
          <ResendEmailButton
            onResend={() => signInWithMagicLink(email.trim())}
            label="sign-in link"
          />
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Sign in"
      subtitle="Welcome back. Keep your progress across devices."
      footer={
        <>
          Don't have an account?{" "}
          <Link to="/signup" className="text-accent hover:underline">
            Create one
          </Link>
        </>
      }
    >
      {/* Phase 20-P1: OAuth is the happy path now that verified email is
          off the free SMTP tier — show providers above the email form with a
          divider, so first-time visitors don't scan past the 2-click option. */}
      <OAuthButtons disabled={submitting} />

      <div className="my-4 flex items-center gap-2 text-[10px] text-faint">
        <div className="h-px flex-1 bg-border" />
        <span>or sign in with email</span>
        <div className="h-px flex-1 bg-border" />
      </div>

      <form
        onSubmit={mode === "password" ? handlePassword : handleMagicLink}
        className="flex flex-col gap-3"
        noValidate
      >
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

        {mode === "password" && (
          <PasswordField
            id="password"
            label="Password"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
            disabled={submitting}
          />
        )}

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
          disabled={mode === "password" ? !canSubmitPassword : !canSubmitMagic}
          aria-busy={submitting}
          className="rounded-md bg-accent px-3 py-1.5 text-[11px] font-semibold text-bg transition hover:bg-accentMuted focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:bg-elevated disabled:text-faint"
        >
          {submitting
            ? mode === "password"
              ? "Signing in…"
              : "Sending link…"
            : mode === "password"
              ? "Sign in"
              : "Send magic link"}
        </button>

        <div className="flex items-center justify-between text-[10px]">
          <button
            type="button"
            onClick={() => {
              setMode(mode === "password" ? "magic-link" : "password");
              setErr(null);
            }}
            className="text-accent hover:underline"
          >
            {mode === "password"
              ? "Prefer not to use a password?"
              : "Use a password instead"}
          </button>
          {mode === "password" && (
            <Link to="/reset-password" className="text-muted hover:text-ink">
              Forgot password?
            </Link>
          )}
        </div>
      </form>
    </AuthShell>
  );
}
