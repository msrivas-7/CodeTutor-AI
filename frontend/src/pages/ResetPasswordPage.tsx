import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AuthShell } from "../auth/AuthShell";
import { PasswordField } from "../auth/PasswordField";
import { ResendEmailButton } from "../auth/ResendEmailButton";
import { isValidEmail } from "../auth/emailValidation";
import { isPasswordAcceptable } from "../auth/passwordPolicy";
import { useAuthStore } from "../auth/authStore";
import { supabase } from "../auth/supabaseClient";

// Dual-mode page:
//
//   1. `request` — default. User enters their email; we call
//      `resetPasswordForEmail` which sends a recovery link.
//   2. `update` — user arrives via the link. Supabase exchanges the recovery
//      token in the URL for a session and fires `onAuthStateChange` with
//      event `PASSWORD_RECOVERY`. We listen for that event and flip to the
//      password-entry form.
//
// Keeping both in one page (instead of two routes) mirrors the link flow:
// Supabase sends the user to `/reset-password?...` regardless, and the
// component decides what UI to show based on the auth event.
export default function ResetPasswordPage() {
  const nav = useNavigate();
  const sendPasswordReset = useAuthStore((s) => s.sendPasswordReset);
  const updatePassword = useAuthStore((s) => s.updatePassword);
  const clearError = useAuthStore((s) => s.clearError);

  const [mode, setMode] = useState<"request" | "sent" | "update" | "done">("request");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    // Supabase fires PASSWORD_RECOVERY when the user lands via the reset
    // link. We only flip into `update` mode on that signal — never trust the
    // URL alone.
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setMode("update");
      }
    });
    return () => {
      data.subscription.unsubscribe();
    };
  }, []);

  const emailValid = email === "" || isValidEmail(email);
  const confirmValid = confirm === "" || confirm === password;
  const passwordOk = isPasswordAcceptable(password);

  const handleRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    clearError();
    setSubmitting(true);
    try {
      await sendPasswordReset(email.trim());
      setMode("sent");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    clearError();
    setSubmitting(true);
    try {
      await updatePassword(password);
      setMode("done");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  if (mode === "sent") {
    return (
      <AuthShell
        title="Check your email"
        subtitle={`We sent a password-reset link to ${email}. Click it to choose a new password.`}
        footer={
          <Link to="/login" className="text-accent hover:underline">
            Back to sign in
          </Link>
        }
      >
        <p className="text-center text-[11px] text-muted">
          The link expires in an hour.
        </p>
        <div className="mt-3 flex justify-center">
          <ResendEmailButton
            onResend={() => sendPasswordReset(email.trim())}
            label="reset link"
          />
        </div>
      </AuthShell>
    );
  }

  if (mode === "done") {
    return (
      <AuthShell
        title="Password updated"
        subtitle="You're signed in with your new password."
        footer={
          <button
            type="button"
            onClick={() => nav("/start", { replace: true })}
            className="text-accent hover:underline"
          >
            Continue to the app
          </button>
        }
      >
        <p className="text-center text-[11px] text-muted">
          For security, other devices signed in with the old password will
          need to sign in again.
        </p>
      </AuthShell>
    );
  }

  if (mode === "update") {
    const canSubmit = passwordOk && password === confirm && !submitting;
    return (
      <AuthShell
        title="Choose a new password"
        subtitle="Pick something strong you'll remember."
      >
        <form onSubmit={handleUpdate} className="flex flex-col gap-3" noValidate>
          <PasswordField
            id="password"
            label="New password"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            disabled={submitting}
            showPolicy
            describedById="reset-password-policy"
          />

          <div className="flex flex-col gap-1.5">
            <label htmlFor="confirm" className="text-[11px] font-medium text-muted">
              Confirm new password
            </label>
            <input
              id="confirm"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              aria-invalid={!confirmValid}
              disabled={submitting}
              className="min-h-11 rounded-lg border border-border bg-elevated px-3 py-2 text-sm text-ink transition focus:border-accent/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-danger/60"
            />
            {!confirmValid && (
              <span className="text-[10px] text-danger">
                Passwords don't match.
              </span>
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
            className="min-h-11 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accentMuted focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:bg-elevated disabled:text-faint"
          >
            {submitting ? "Updating password…" : "Update password"}
          </button>
        </form>
      </AuthShell>
    );
  }

  // mode === "request"
  const canSubmit = isValidEmail(email) && !submitting;
  return (
    <AuthShell
      title="Reset your password"
      subtitle="We'll email you a link to set a new password."
      footer={
        <Link to="/login" className="text-accent hover:underline">
          Back to sign in
        </Link>
      }
    >
      <form onSubmit={handleRequest} className="flex flex-col gap-3" noValidate>
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
            className="min-h-11 rounded-lg border border-border bg-elevated px-3 py-2 text-sm text-ink transition placeholder:text-faint focus:border-accent/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-danger/60"
          />
          {!emailValid && (
            <span className="text-[10px] text-danger">
              Enter a valid email address.
            </span>
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
          className="min-h-11 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accentMuted focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:bg-elevated disabled:text-faint"
        >
          {submitting ? "Sending link…" : "Send reset link"}
        </button>
      </form>
    </AuthShell>
  );
}
