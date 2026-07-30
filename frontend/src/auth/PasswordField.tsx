import { useEffect, useRef, useState } from "react";
import { PASSWORD_CHECKS, passwordStrength } from "./passwordPolicy";

interface Props {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
  placeholder?: string;
  disabled?: boolean;
  // When true, renders the live strength meter + requirements checklist
  // underneath the input. Used on Signup + ResetPassword; omitted on Login.
  showPolicy?: boolean;
  // Extra aria-describedby wiring for the strength region so screen readers
  // announce updates as the user types.
  describedById?: string;
}

const STRENGTH_COLOR: Record<string, string> = {
  weak: "bg-danger",
  fair: "bg-warn",
  good: "bg-accent",
  strong: "bg-success",
};

const STRENGTH_LABEL: Record<string, string> = {
  weak: "Weak",
  fair: "Fair",
  good: "Good",
  strong: "Strong",
};

export function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete = "current-password",
  placeholder,
  disabled,
  showPolicy = false,
  describedById,
}: Props) {
  const [reveal, setReveal] = useState(false);
  const strength = passwordStrength(value);

  // Debounced accessibility summary. Announcing on every keystroke makes
  // screen readers spam five checklist items per character — the user
  // can't hear anything useful. We batch to a single "Password strength:
  // fair. 3 of 5 requirements met." announcement ~500ms after the last
  // keystroke.
  const [announce, setAnnounce] = useState("");
  const lastSummaryRef = useRef<string>("");
  useEffect(() => {
    if (!showPolicy) return;
    if (strength.level === "empty") {
      if (lastSummaryRef.current !== "") {
        lastSummaryRef.current = "";
        setAnnounce("");
      }
      return;
    }
    const summary = `Password strength ${strength.level}. ${strength.passed} of ${strength.total} requirements met.`;
    if (summary === lastSummaryRef.current) return;
    const t = window.setTimeout(() => {
      lastSummaryRef.current = summary;
      setAnnounce(summary);
    }, 500);
    return () => window.clearTimeout(t);
  }, [strength.level, strength.passed, strength.total, showPolicy]);

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-muted">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          id={id}
          type={reveal ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          disabled={disabled}
          aria-describedby={describedById}
          className="min-h-11 min-w-0 flex-1 rounded-md border border-border bg-elevated px-3 py-2 text-base text-ink transition placeholder:text-faint focus:border-accent/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm"
        />
        <button
          type="button"
          onClick={() => setReveal((v) => !v)}
          className="flex min-h-11 min-w-11 items-center justify-center rounded-md border border-border bg-elevated p-2 text-muted transition hover:border-accent/60 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          title={reveal ? "Hide password" : "Show password"}
          aria-label={reveal ? "Hide password" : "Show password"}
          aria-pressed={reveal}
        >
          {reveal ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
              <line x1="1" y1="1" x2="23" y2="23" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          )}
        </button>
      </div>

      {showPolicy && (
        <div id={describedById} className="flex flex-col gap-2">
          {/*
            Visual meter + checklist carries no aria-live — the wrapper
            would re-announce the entire block on every keystroke. The
            debounced status region below is the canonical announcement
            surface for screen readers.
          */}
          <div
            className="flex items-center gap-2"
            aria-hidden="true"
          >
            <div className="flex h-1.5 flex-1 overflow-hidden rounded-full bg-elevated">
              <div
                className={`h-full transition-all duration-200 ${
                  strength.level === "empty" ? "bg-transparent" : STRENGTH_COLOR[strength.level]
                }`}
                style={{ width: `${(strength.passed / strength.total) * 100}%` }}
              />
            </div>
            <span className="w-12 text-right text-meta font-semibold text-muted">
              {strength.level === "empty" ? "" : STRENGTH_LABEL[strength.level]}
            </span>
          </div>
          <ul className="grid grid-cols-1 gap-0.5 sm:grid-cols-2">
            {PASSWORD_CHECKS.map((check) => {
              const ok = check.test(value);
              return (
                <li
                  key={check.label}
                  className={`flex items-center gap-1.5 text-sm transition ${
                    ok ? "text-success" : "text-faint"
                  }`}
                >
                  <span aria-hidden="true">{ok ? "✓" : "○"}</span>
                  <span aria-hidden="true">{check.label}</span>
                  <span className="sr-only">
                    {check.label}: {ok ? "requirement met" : "requirement not met"}
                  </span>
                </li>
              );
            })}
          </ul>
          <div
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className="sr-only"
          >
            {announce}
          </div>
        </div>
      )}
    </div>
  );
}
