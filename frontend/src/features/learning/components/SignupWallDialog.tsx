import { useEffect } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";

// Phase 27 §3a — sign-up wall for anonymous lesson 1.
//
// Shown when the anon visitor clicks Save, "Next lesson", or any
// other surface that requires persistence. The wall does NOT fire on
// Run or on the first few tutor questions — those are the value
// they came to experience. The wall fires at the WIN moment, after
// they've seen their code work.
//
// Two variants of the dialog body keyed by the trigger:
//   - "save"     They tried to save. Frame: "Save your code? Takes
//                 10 seconds." Maya's pattern.
//   - "exhausted" They burned through their 8 anon AI questions.
//                 Frame: "You're getting it — keep going? Sign up for
//                 the rest." (29 q/day after signup, vs 8 anon.)
//
// No Tailwind animation tokens here; the modal owns its own framer
// timeline so the dismiss-then-reopen path doesn't double-animate.

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
}

const COPY_BY_REASON: Record<SignupWallReason, { title: string; body: string; cta: string }> = {
  // Phase 27 §3a (post-QC): copy is forward-looking to match what the
  // implementation can actually deliver. The anon page does NOT yet
  // stash code into sessionStorage and rehydrate after signup, so a
  // backward-looking "we'll keep your work" promise would land Maya
  // on /start with her code wiped — a betrayal moment. The current
  // copy promises only what's true post-signup: lessons going
  // forward will save automatically. Code stashing across the
  // signup boundary is a follow-up.
  save: {
    title: "Sign up to save?",
    body:
      "Takes 10 seconds. From the moment you sign up, your code and progress save automatically — so you never lose a line of work again.",
    // Phase 27-v2.2 audit fix F1 (business-leader): "Sign up for free"
    // claims free-forever framing and forecloses the future paid tier
    // — every paid-tier introduction would renegotiate an implied
    // promise. "Start free" leaves room for an upgrade ladder
    // without breaking the implicit contract.
    cta: "Sign up — start free",
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
      "Save your spot — takes 10 seconds. Your code, your name, and the lesson you just finished come with you.",
    cta: "Start lesson 2",
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
    cta: "Sign up — start free",
  },
  // Phase 27-v2.2 Fix 1 — anon share lever. Maya's emotional intent at
  // this moment is "text this to my group chat" — the wall promises
  // the share happens AFTER signup, with her code+name carried over
  // to the post-signup share dialog. Body is shorter than next-lesson
  // because the celebration already showed her what she made; the
  // wall is the conversion ask, not the pitch.
  share: {
    title: "Sign up to share your first program",
    // Phase 27-v2.2 audit fix F2 (business-leader): tighten the body to
    // name the social object Maya is actually about to perform — "your
    // friend gets a link" / "your name on it" speaks to peer-pressure
    // energy at the celebration moment. Generic "share image" was an
    // implementation noun, not Maya's mental model.
    body:
      "Your friend gets a link to your first program — your name on it. Sign up takes 10 seconds.",
    cta: "Sign up & share",
  },
  // Phase 27-v2.2 audit fix E1: trial paused (operator-flipped kill
  // switch). Reads as "small ops blip; sign up so you don't lose your
  // place" — preserves the conversion lever the kill switch would
  // otherwise destroy. Body promises continuity, not punishment.
  "trial-paused": {
    title: "We're catching our breath.",
    body:
      "The trial is paused for a moment. Sign up to keep going — your code and your name come with you.",
    cta: "Sign up to continue",
  },
};

export function SignupWallDialog({ open, reason, onDismiss }: SignupWallDialogProps) {
  // Esc closes — same affordance as every other modal in the product.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onDismiss]);

  const copy = COPY_BY_REASON[reason];

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="signup-wall-title"
          aria-describedby="signup-wall-body"
          className="fixed inset-0 z-[60] flex items-center justify-center bg-bg/70 px-6 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          onClick={(e) => {
            if (e.target === e.currentTarget) onDismiss();
          }}
        >
          <motion.div
            className="relative w-full max-w-md rounded-2xl border border-accent/30 bg-panel/95 p-7 shadow-2xl"
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="signup-wall-title"
              className="mb-2 font-display text-[22px] font-semibold leading-tight text-ink"
            >
              {copy.title}
            </h2>
            <p
              id="signup-wall-body"
              className="mb-6 text-[14px] leading-relaxed text-muted"
            >
              {copy.body}
            </p>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={onDismiss}
                className="rounded-lg border border-border px-4 py-2 text-[13px] font-medium text-muted transition hover:bg-elevated hover:text-ink"
              >
                {/* Phase 27-v2.1 medium-lock copy: "Maybe later" reads as
                    completion-deferred, not refusal. "Not yet" suggests
                    she hasn't met some requirement; "Maybe later" honors
                    her agency. Reason-specific so the save/exhausted
                    paths keep their punchier "Not yet" framing.
                    Phase 27-v2.2 Fix 1: "share" also gets "Maybe later"
                    — same continuation framing as next-lesson (Maya
                    just earned the artifact; deferring is completion-
                    deferred, not refusal). */}
                {reason === "next-lesson" || reason === "share" || reason === "trial-paused"
                  ? "Maybe later"
                  : "Not yet"}
              </button>
              <Link
                to="/signup"
                className="inline-flex items-center justify-center rounded-lg bg-gradient-to-r from-accent to-violet px-5 py-2 text-[13px] font-bold text-bg shadow-sm transition hover:opacity-90"
              >
                {copy.cta} →
              </Link>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
