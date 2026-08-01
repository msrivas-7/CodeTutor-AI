// Phase A — A2 (device contract): warm phone→laptop handoff dialog.
//
// After a phone learner finishes lesson 1, this dialog REPLACES the
// SignupWallDialog for the next-lesson path. The wall still fires for
// save / exhausted / share — those are conversion asks. The next-lesson
// ask is fundamentally different: lesson 2 needs more screen, and the
// honest answer is "let's get you to a laptop." The wall would frame
// it as a sign-up gate; this dialog frames it as a continuity bridge.
//
// Submit flow:
//   1. User types email, hits "Send myself the link"
//   2. POST /api/anon/laptop-link → server creates invite, sends email,
//      returns the URL
//   3. UI flips to the "check your inbox" success state with a
//      secondary "Show QR code" button (renders the URL as a QR for
//      out-of-band laptop-camera scan)
//
// Failure modes:
//   - 429 (rate-limited): show a retry-after message
//   - 503 (kill switch): fall back silently to the wall flow (caller
//     decides; this dialog just surfaces the error)
//   - Email send failure but URL valid (warn=EMAIL_SEND_FAILED):
//     surface a "didn't get the email? Use QR instead" hint
//
// Accessibility is owned by the shared Modal contract: labelled dialog,
// focus entry/trap/restore, Escape, backdrop dismissal, and safe-area spacing.

import { useState } from "react";
import { api } from "../../../api/client";
import { isApiError } from "../../../api/ApiError";
import { Modal } from "../../../components/Modal";
import { QRCodePanel } from "./QRCodePanel";

export interface PhoneGraduationDialogProps {
  /** The lesson-1 code the learner just typed. Carried into the
   *  invite row so /start?invite=<token> can re-stash it before
   *  forwarding to signup. */
  code: string;
  /** Optional parsed-from-code name (extractNameFromCode result).
   *  Used by the email greeting and the post-signup praise turn. */
  name: string | null;
  /** Caller-provided dismiss callback. Fires on Esc, on the dismiss
   *  button click, AND after the user clicks the email-link in their
   *  inbox (since the dialog is a phone-only surface and the user
   *  has now moved on). */
  onDismiss: () => void;
  /** Explicit account-creation action. Dismissal never invokes this. */
  onFallbackToWall: () => void;
}

type Phase =
  | { kind: "form" }
  | { kind: "submitting" }
  | { kind: "sent"; url: string; warn: "EMAIL_SEND_FAILED" | null }
  | { kind: "error"; message: string; recoverable: boolean };

export function PhoneGraduationDialog({
  code,
  name,
  onDismiss,
  onFallbackToWall,
}: PhoneGraduationDialogProps) {
  const [email, setEmail] = useState("");
  const [showQR, setShowQR] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "form" });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setPhase({ kind: "submitting" });
    try {
      const res = await api.createAnonLaptopInvite({
        email: email.trim(),
        code,
        name,
      });
      setPhase({ kind: "sent", url: res.url, warn: res.warn ?? null });
    } catch (err) {
      // Map structured backend error codes into user-facing copy.
      // The backend route returns JSON like {error: "ANON_LAPTOP_INVITE_RATE_LIMITED"}
      // — `throwApiError` packs that as ApiError.body. Parsing the
      // body (rather than regex-matching the friendly message) keeps
      // the dialog's branching aligned with the route's stable error
      // code surface; copy changes on the message side never silently
      // re-route the dialog.
      const code = errorCodeFrom(err);
      const isRateLimit = code === "ANON_LAPTOP_INVITE_RATE_LIMITED";
      const isDisabled = code === "ANON_LAPTOP_INVITE_DISABLED";
      setPhase({
        kind: "error",
        message: isRateLimit
          ? "You've sent yourself a few links recently — try again in 24 hours, or open the lesson on your laptop directly."
          : isDisabled
            ? "This handoff is temporarily unavailable. Try the sign-up flow instead."
            : "Couldn't send the email. Try the sign-up flow instead.",
        recoverable: false,
      });
    }
  }

  function handleDismiss() {
    onDismiss();
  }

  function handleExplicitSignup() {
    onDismiss();
    onFallbackToWall();
  }

  // Pull the structured `error` code out of a thrown ApiError. The
  // route returns JSON ({error: string, scope?: string}) on 4xx/5xx;
  // throwApiError packs the raw body string onto ApiError.body. We
  // parse defensively — non-ApiError throws (network, JSON parse
  // failure on the body) fall through to null and the dialog uses
  // the generic "couldn't send the email" copy.
  function errorCodeFrom(err: unknown): string | null {
    if (!isApiError(err)) return null;
    try {
      const parsed = JSON.parse(err.body) as { error?: unknown };
      return typeof parsed.error === "string" ? parsed.error : null;
    } catch {
      return null;
    }
  }

  return (
    <Modal
      onClose={handleDismiss}
      labelledBy="phone-graduation-title"
      describedBy="phone-graduation-description"
      position="bottom"
      zIndex={60}
      panelClassName="mx-4 mb-[calc(env(safe-area-inset-bottom)+1rem)] w-full max-w-md rounded-t-2xl border border-border bg-panel p-5 shadow-2xl sm:mb-0 sm:rounded-2xl sm:p-6"
    >
        <header className="mb-3">
          <h2 id="phone-graduation-title" className="font-display text-xl font-semibold text-ink">
            {phase.kind === "sent" ? "Check your inbox" : "Lesson 2 needs more screen"}
          </h2>
          <p id="phone-graduation-description" className="mt-1 text-sm leading-relaxed text-muted">
            {phase.kind === "sent"
              ? "We sent you a magic link. Open it on your laptop to keep going from where you left off."
              : "We'll email you a link. Open it on your laptop and pick up exactly where you stopped — same code, same name, no signup yet."}
          </p>
        </header>

        {phase.kind === "form" || phase.kind === "submitting" ? (
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5 text-sm font-medium text-muted">
              Your email
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                autoFocus
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={phase.kind === "submitting"}
                className="min-h-11 rounded-md border border-border bg-bg px-3 py-2 text-base text-ink outline-none transition focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/70 disabled:opacity-50"
                placeholder="you@example.com"
              />
            </label>
            <button
              type="submit"
              disabled={phase.kind === "submitting" || !email.trim()}
              className="min-h-11 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
            >
              {phase.kind === "submitting" ? "Sending…" : "Send myself the link"}
            </button>
            <button
              type="button"
              onClick={handleDismiss}
              className="min-h-11 rounded-md px-4 py-2 text-sm font-medium text-muted transition hover:bg-elevated hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Maybe later
            </button>
            <button
              type="button"
              onClick={handleExplicitSignup}
              className="min-h-11 rounded-md px-4 py-2 text-sm font-medium text-accent transition hover:bg-accent/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Create an account instead
            </button>
          </form>
        ) : phase.kind === "sent" ? (
          <div className="flex flex-col gap-3">
            {phase.warn === "EMAIL_SEND_FAILED" && (
              <p className="rounded-md border border-warn/40 bg-warn/10 p-2 text-xs text-warn">
                Email send failed, but the link is still valid — scan the QR
                below from your laptop instead.
              </p>
            )}
            {!showQR ? (
              <button
                type="button"
                onClick={() => setShowQR(true)}
                className="min-h-11 rounded-md border border-border bg-bg px-4 py-2 text-sm font-medium text-ink transition hover:border-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Show QR code
              </button>
            ) : (
              <QRCodePanel url={phase.url} />
            )}
            <button
              type="button"
              onClick={onDismiss}
              className="min-h-11 rounded-md px-4 py-2 text-sm font-medium text-muted transition hover:bg-elevated hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Done
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="rounded-md border border-warn/40 bg-warn/10 p-3 text-sm text-warn">
              {phase.message}
            </p>
            <button
              type="button"
              onClick={handleExplicitSignup}
              className="min-h-11 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Sign up to keep going
            </button>
          </div>
        )}
    </Modal>
  );
}
