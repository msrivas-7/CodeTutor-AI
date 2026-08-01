import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Modal } from "../../../components/Modal";
import { PasswordSignupForm } from "../../../auth/PasswordSignupForm";
import { ResendEmailButton } from "../../../auth/ResendEmailButton";
import { useAuthStore } from "../../../auth/authStore";
import { api } from "../../../api/client";
import { readAnonStash } from "../../anon/anonStash";

// B5 — in-product continuation card for anonymous lesson 1.
//
// Shown when the anon visitor clicks Save, "Next lesson", or any
// other surface that requires persistence. The wall does NOT fire on
// Run or on the first few tutor questions — those are the value
// they came to experience. The wall fires at the WIN moment, after
// they've seen their code work.
//
// Account creation stays inside the celebration-styled panel: OAuth, email
// fields, errors, confirmation, resend, and recovery all happen without
// navigating away from the lesson. The shared PasswordSignupForm keeps this
// path aligned with the standalone signup page.

// Phase 27-v2.2 Fix 1 — `share` reason added. Anon Maya hits the share
// card on the celebration; instead of opening the auth-required
// ShareDialog (which would 401-cascade and never produce a working
// share artifact), we pivot to a wall whose CTA promises the share
// happens AFTER signup. Same conversion lever as save / next-lesson,
// different framing because Maya's emotional intent here is "text
// this to my group chat," not "save my work."
export type SignupWallReason =
  | "save"
  | "exhausted"
  | "next-lesson"
  | "share"
  // Phase 27-v2.2 audit fix E1 (staff-ux): operator flipped the anon
  // kill switch off. Without this reason the route returns 503
  // ANON_LESSON_DISABLED and useTutorAsk surfaces a raw "Request
  // failed" with no path forward. Pivot the wall as "trial paused —
  // sign up to keep going" so an actively-engaged user during an
  // incident isn't bounced into nothing.
  | "trial-paused";

interface SignupWallDialogProps {
  open: boolean;
  reason: SignupWallReason;
  onDismiss: () => void;
  initialFirstName?: string;
}

const COPY_BY_REASON: Record<
  SignupWallReason,
  { title: string; body: string; submit: string; dismiss: string }
> = {
  save: {
    title: "Sign up to save?",
    body:
      "Create your account here. Once it is confirmed, your future code and progress will save automatically.",
    submit: "Create account & start saving",
    dismiss: "Not yet",
  },
  // Phase 27-v2 Day 5a: next-lesson reason now honestly promises the
  // carry-over Day 3c writes (sessionStorage stash) and Day 4 redeems
  // (POST /api/anon-handoff from StartPage on first authed mount).
  // Maya signing up from the celebration CTA lands directly on lesson
  // 2 with her code, name, and lesson-1 completion already applied —
  // no /welcome cinematic replay, no lesson-1 redo, no WorkspaceCoach
  // (until Day 6, then suppressed too). The body names what comes
  // with her so the wall reads as continuation of the win moment,
  // not a transactional "create an account" ask.
  // Phase 27-v2.1 medium-lock copy (creative director pass): tighten
  // the headline to "Lesson 2 is queued up." — the question-mark version
  // ("Keep going?") reads as a quiz the celebration just finished
  // dispelling. Body keeps the carry-over promise concrete (Maya needs
  // to hear "your name comes with you" — that's what makes the wall
  // a continuation of the moment instead of an interruption of it).
  "next-lesson": {
    title: "Lesson 2 is queued up.",
    body:
      "Save your spot. Your code, your name, and the lesson you just finished come with you.",
    submit: "Create account & continue",
    dismiss: "Maybe later",
  },
  exhausted: {
    title: "You're getting it.",
    // Phase 27-v2.2 audit fix F1: same free-tier-framing concern as
    // save.cta — "free account" + "daily quota" plant free-forever
    // expectations. Reframe the upgrade as unlocking the full quota
    // (which IS what signup does — anon=8/day, authed=30/day) without
    // committing to a price ceiling.
    body:
      "You've used your free tutor questions for today. Create an account to unlock the full daily quota — your work saves from then on.",
    submit: "Create account & keep going",
    dismiss: "Not yet",
  },
  // Phase 27-v2.2 Fix 1 — anon share lever. Maya's emotional intent at
  // this moment is "text this to my group chat" — the wall promises
  // the share happens AFTER signup, with her code+name carried over
  // to the post-signup share dialog. Body is shorter than next-lesson
  // because the celebration already showed her what she made; the
  // wall is the conversion ask, not the pitch.
  share: {
    title: "Your share link is ready.",
    // Phase 27-v2.2 audit fix F2 (business-leader): tighten the body to
    // name the social object Maya is actually about to perform — "your
    // friend gets a link" / "your name on it" speaks to peer-pressure
    // energy at the celebration moment. Generic "share image" was an
    // implementation noun, not Maya's mental model.
    body:
      "Anyone with the link can see your first program. Create an account to keep this progress and save what you build next.",
    submit: "Create account & save progress",
    dismiss: "Maybe later",
  },
  // Phase 27-v2.2 audit fix E1: trial paused (operator-flipped kill
  // switch). Reads as "small ops blip; sign up so you don't lose your
  // place" — preserves the conversion lever the kill switch would
  // otherwise destroy. Body promises continuity, not punishment.
  "trial-paused": {
    title: "We're catching our breath.",
    body:
      "The trial is paused for a moment. Create an account now so future lessons and progress save automatically.",
    submit: "Create account",
    dismiss: "Maybe later",
  },
};

export function SignupWallDialog({
  open,
  reason,
  onDismiss,
  initialFirstName,
}: SignupWallDialogProps) {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const resendSignupConfirmation = useAuthStore(
    (state) => state.resendSignupConfirmation,
  );
  const [sentEmail, setSentEmail] = useState<string | null>(null);
  const signupEventFiredRef = useRef(false);
  const copy = COPY_BY_REASON[reason];

  useEffect(() => {
    if (!sentEmail || !user) return;
    if (!signupEventFiredRef.current && readAnonStash() !== null) {
      signupEventFiredRef.current = true;
      api.postFunnelEvent("anon_signup_completed");
    }
    navigate("/start", { replace: true });
  }, [navigate, sentEmail, user]);

  if (!open) return null;

  return (
    <Modal
      onClose={onDismiss}
      role="dialog"
      labelledBy="signup-wall-title"
      describedBy="signup-wall-body"
      position="center"
      zIndex={60}
      panelClassName="relative mx-4 max-h-[calc(100dvh-2rem)] w-full max-w-2xl overflow-y-auto overscroll-contain rounded-2xl border border-success/30 bg-panel/95 p-5 shadow-2xl backdrop-blur sm:p-8 lg:p-10"
    >
      {sentEmail ? (
        <div
          role="status"
          aria-live="polite"
          className="flex flex-col items-center py-2 text-center"
        >
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-success/50 bg-success/10 text-success shadow-glow">
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="3" y="5" width="18" height="14" rx="2" />
              <path d="m3 7 9 6 9-6" />
            </svg>
          </div>
          <p className="mb-2 text-sm font-semibold uppercase tracking-[0.18em] text-success">
            Your work is waiting
          </p>
          <h2
            id="signup-wall-title"
            className="font-display text-3xl font-semibold leading-tight text-ink sm:text-4xl"
          >
            Check your email
          </h2>
          <p
            id="signup-wall-body"
            className="mt-3 max-w-lg text-base leading-relaxed text-muted"
          >
            We sent a confirmation link to <span className="text-ink">{sentEmail}</span>.
            Confirm it in this browser and your lesson will continue from here.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-faint">
            The link expires in an hour. Check spam if it does not arrive.
          </p>
          <div className="mt-4">
            <ResendEmailButton
              onResend={() => resendSignupConfirmation(sentEmail)}
              label="confirmation email"
            />
          </div>
          <div className="mt-6 grid w-full gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={onDismiss}
              className="min-h-11 rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted transition hover:bg-elevated hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Back to lesson
            </button>
            <button
              type="button"
              onClick={() => setSentEmail(null)}
              className="min-h-11 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Use a different email
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="mb-5 flex items-start gap-3">
            <div className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-success/50 bg-success/10 text-success shadow-glow">
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="m5 12 4 4L19 6" />
              </svg>
            </div>
            <div>
              <p className="mb-1 text-sm font-semibold uppercase tracking-[0.16em] text-success">
                Keep this win
              </p>
              <h2
                id="signup-wall-title"
                className="font-display text-3xl font-semibold leading-tight text-ink sm:text-4xl"
              >
                {copy.title}
              </h2>
              <p
                id="signup-wall-body"
                className="mt-2 max-w-xl text-base leading-relaxed text-muted"
              >
                {copy.body}
              </p>
            </div>
          </div>

          <PasswordSignupForm
            idPrefix="signup-wall"
            initialFirstName={initialFirstName}
            submitLabel={copy.submit}
            emailDividerLabel="or continue with email"
            layout="continuation"
            onSubmitted={setSentEmail}
            secondaryAction={{ label: copy.dismiss, onClick: onDismiss }}
          />

          <p className="mt-1 text-center text-sm text-muted">
            Already have an account?{" "}
            <Link
              to="/login"
              className="inline-flex min-h-11 items-center font-medium text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Sign in and continue
            </Link>
          </p>
        </>
      )}
    </Modal>
  );
}
