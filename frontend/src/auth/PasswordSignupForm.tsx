import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { OAuthButtons } from "./OAuthButtons";
import { PasswordField } from "./PasswordField";
import { isValidEmail } from "./emailValidation";
import { isPasswordAcceptable } from "./passwordPolicy";
import { useAuthStore } from "./authStore";

interface PasswordSignupFormProps {
  idPrefix: string;
  initialFirstName?: string;
  submitLabel?: string;
  emailDividerLabel?: string;
  layout?: "stacked" | "continuation";
  onSubmitted: (email: string) => void;
  returnTo?: string;
  secondaryAction?: {
    label: string;
    onClick: () => void;
  };
}

/**
 * The canonical account-creation form shared by the standalone auth page and
 * the B5 continuation card. Keeping one implementation prevents the in-product
 * conversion surface from drifting on validation, metadata, legal copy, or
 * Supabase behavior while still allowing the card to use a wider layout.
 */
export function PasswordSignupForm({
  idPrefix,
  initialFirstName = "",
  submitLabel = "Create account",
  emailDividerLabel = "or sign up with email",
  layout = "stacked",
  onSubmitted,
  secondaryAction,
  returnTo = "/start",
}: PasswordSignupFormProps) {
  const signUpWithPassword = useAuthStore((state) => state.signUpWithPassword);
  const clearError = useAuthStore((state) => state.clearError);
  const [firstName, setFirstName] = useState(initialFirstName.slice(0, 50));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const firstNameValid =
    firstName.trim().length > 0 && firstName.trim().length <= 50;
  const emailValid = email === "" || isValidEmail(email);
  const confirmValid = confirm === "" || confirm === password;
  const passwordValid = isPasswordAcceptable(password);
  const canSubmit =
    firstNameValid &&
    isValidEmail(email) &&
    passwordValid &&
    password === confirm &&
    !submitting;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    setError(null);
    clearError();
    setSubmitting(true);
    try {
      const normalizedEmail = email.trim();
      await signUpWithPassword(normalizedEmail, password, {
        firstName: firstName.trim(),
      }, returnTo);
      onSubmitted(normalizedEmail);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const fieldGridClass =
    layout === "continuation"
      ? "grid gap-3 sm:grid-cols-2"
      : "flex flex-col gap-3";
  const actionClass = secondaryAction
    ? "grid gap-2 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]"
    : "flex flex-col";

  return (
    <div>
      <OAuthButtons disabled={submitting} returnTo={returnTo} />

      <div className="my-4 flex items-center gap-2 text-sm text-faint">
        <div className="h-px flex-1 bg-border" />
        <span>{emailDividerLabel}</span>
        <div className="h-px flex-1 bg-border" />
      </div>

      <form
        onSubmit={handleSubmit}
        onChange={() => {
          if (error) setError(null);
          clearError();
        }}
        className="flex flex-col gap-3"
        noValidate
        aria-label="Create your account"
      >
        <div className={fieldGridClass}>
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor={`${idPrefix}-first-name`}
              className="text-sm font-medium text-muted"
            >
              First name
            </label>
            <input
              id={`${idPrefix}-first-name`}
              type="text"
              value={firstName}
              onChange={(event) => setFirstName(event.target.value)}
              placeholder="Ada"
              autoComplete="given-name"
              autoCapitalize="words"
              maxLength={50}
              required
              aria-invalid={firstName.length > 0 && !firstNameValid}
              disabled={submitting}
              className="min-h-11 rounded-md border border-border bg-elevated px-3 py-2 text-base text-ink transition placeholder:text-faint focus:border-accent/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-danger/60 sm:text-sm"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor={`${idPrefix}-email`}
              className="text-sm font-medium text-muted"
            >
              Email
            </label>
            <input
              id={`${idPrefix}-email`}
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              required
              aria-invalid={!emailValid}
              aria-describedby={!emailValid ? `${idPrefix}-email-error` : undefined}
              disabled={submitting}
              className="min-h-11 rounded-md border border-border bg-elevated px-3 py-2 text-base text-ink transition placeholder:text-faint focus:border-accent/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-danger/60 sm:text-sm"
            />
            {!emailValid && (
              <span id={`${idPrefix}-email-error`} className="text-sm text-danger">
                Enter a valid email address.
              </span>
            )}
          </div>
        </div>

        <PasswordField
          id={`${idPrefix}-password`}
          label="Password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          disabled={submitting}
          showPolicy
          required
          describedById={`${idPrefix}-password-policy`}
        />

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor={`${idPrefix}-confirm`}
            className="text-sm font-medium text-muted"
          >
            Confirm password
          </label>
          <input
            id={`${idPrefix}-confirm`}
            type="password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            autoComplete="new-password"
            required
            aria-invalid={!confirmValid}
            aria-describedby={!confirmValid ? `${idPrefix}-confirm-error` : undefined}
            disabled={submitting}
            className="min-h-11 rounded-md border border-border bg-elevated px-3 py-2 text-base text-ink transition focus:border-accent/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-danger/60 sm:text-sm"
          />
          {!confirmValid && (
            <span id={`${idPrefix}-confirm-error`} className="text-sm text-danger">
              Passwords do not match.
            </span>
          )}
          {confirmValid && confirm.length > 0 && confirm === password && (
            <span className="text-sm text-success">Passwords match</span>
          )}
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
          >
            {error}
          </div>
        )}

        <div className={actionClass}>
          {secondaryAction && (
            <button
              type="button"
              onClick={secondaryAction.onClick}
              disabled={submitting}
              className="min-h-11 rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted transition hover:bg-elevated hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
            >
              {secondaryAction.label}
            </button>
          )}
          <button
            type="submit"
            disabled={!canSubmit}
            aria-busy={submitting}
            className={`min-h-11 rounded-lg px-4 py-2 text-sm font-semibold text-bg transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:bg-none disabled:bg-elevated disabled:text-faint ${
              layout === "continuation"
                ? "bg-gradient-to-r from-success via-accent to-violet shadow-sm hover:brightness-105"
                : "bg-accent hover:bg-accentMuted"
            }`}
          >
            {submitting ? "Creating your account…" : submitLabel}
          </button>
        </div>
      </form>

      <div className="mt-3 text-center text-sm leading-relaxed text-faint">
        <p>By creating an account, you agree to the</p>
        <p className="flex flex-wrap items-center justify-center gap-x-1.5">
          <Link
            to="/terms"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center px-1 text-muted underline decoration-border underline-offset-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Terms
          </Link>
          <span className="inline-flex min-h-11 items-center">
            and acknowledge the
          </span>
          <span className="inline-flex min-h-11 items-center">
            <Link
              to="/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center px-1 text-muted underline decoration-border underline-offset-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Privacy notice
            </Link>
            <span aria-hidden="true">.</span>
          </span>
        </p>
      </div>
    </div>
  );
}
