# Release B5 continuation-card packet

Status: local engineering and persona gates complete; phase commit, remote CI,
deployed-preview verification, and PR review audit pending

Branch: `dev/contextual-learning-roadmap`

Roadmap authority: B5 in
`.claude/audits/2026-05-06-post-phase-27/roadmap-v2.md`

## Product decision

B5 replaces the anonymous lesson's link-out signup wall with a continuation
card that stays over the lesson and uses the same visual language as the
completion celebration. Account creation is no longer a cold navigation:

- Google, GitHub, and email account creation are available inside the card;
- the email form, validation, loading, provider errors, confirmation, resend,
  address correction, and dismissal all remain in one surface;
- the learner does not leave `/try/lesson/...` while confirmation is pending;
- no auth request occurs before explicit submission;
- the standalone `/signup` route reuses the canonical form rather than keeping
  a second validation/auth implementation.

The ordinary modal role is `dialog`, not `alertdialog`. The panel reuses the
celebration's `max-w-2xl`, rounded, success-bordered, translucent panel chrome
instead of presenting an urgent or destructive HR-form aesthetic.

## Honest continuation contract

The card keeps reason-specific copy and actions:

| Trigger | Promise |
| --- | --- |
| Save | Account creation starts automatic saving for future authenticated work; it does not claim the current incomplete lesson was persisted. |
| Next lesson | The completed code, extracted name, and lesson-one completion are written to the existing versioned session handoff stash. |
| Share save-progress | The completed lesson is stashed before the card opens; the explicit conversion transition dismisses the underlying celebration. |
| Tutor quota exhausted | Account creation unlocks the authenticated quota and future saving without promising current incomplete-code handoff. |
| Trial paused | Account creation remains available, but copy does not promise that incomplete anonymous code crosses the boundary. |

When a usable name exists in the current editor or handoff stash, it prefills
the bounded first-name field. The learner may edit it before submission.

## Interaction and recovery contract

- The modal traps focus, inerts the background, restores a logical trigger,
  honors Escape/backdrop dismissal, and composes with the completion/share
  stack.
- Ordinary share dismissal and share-API recovery return to the celebration;
  only explicit save-progress conversion restages onto the lesson before B5.
- Desktop initial focus lands on the first OAuth action. Email fields have
  programmatic labels, required semantics, browser autocomplete hints, inline
  validation, a password policy, show/hide control, and live provider errors.
- The confirmation state echoes the submitted address and provides resend,
  different-email, and back-to-lesson actions.
- The card scrolls inside `calc(100dvh - 2rem)` with overscroll containment.
  At 390 × 844 it has 356px client width, zero horizontal overflow, and a
  810px viewport over 982px scroll content.
- Submit, dismiss, OAuth, password reveal, Terms, Privacy, resend, and recovery
  controls meet the 44px target. Reduced motion uses the shared modal policy.
- Disabled continuation actions remove the gradient and retain readable muted
  styling.

## Architecture and data boundary

- `PasswordSignupForm` is the canonical password-signup implementation for
  both `/signup` and B5.
- `authStore.signUpWithPassword` remains the single Supabase call site and
  sends only bounded `first_name` metadata plus the existing allowlisted
  `/auth/callback` redirect.
- B5 adds no database migration, backend route, authorization rule, secret,
  AI request, or persistent browser shadow store.
- Completed anonymous work uses the existing versioned, per-tab
  `sessionStorage` handoff. Incomplete save/exhaustion/trial-paused paths do not
  fabricate completion to force persistence.
- Immediate-session projects continue to emit the existing anonymous signup
  event once and navigate to `/start`; confirmation-enabled projects remain in
  the card.

## Local verification evidence

- Frontend: 54 test files and 439 tests pass; typecheck and production build
  pass.
- Static experience contract: 4/4 checks pass, including inline B5 form,
  ordinary dialog semantics, celebration panel tokens, scroll containment,
  and no `/signup` CTA regression.
- E2E TypeScript compilation passes.
- Focused B5 Chromium journey: 18/18 retry-disabled tests pass.
- Broader Chromium regression run: 53/53 retry-disabled tests pass after the
  run caught and verified fixes for share-recovery focus and direct-signup-copy
  regressions.
- WebKit critical desktop/phone journeys pass 2/2 retry-disabled tests.
- A native headless browser visual audit captured desktop form, desktop
  confirmation, and phone top/bottom states with zero page errors, zero
  horizontal overflow, 44px policy/action targets, and the lesson URL retained
  after mocked confirmation-enabled signup.
- The local Firefox executable repeatedly fails before page creation with a
  headless SWGL framebuffer startup timeout under parallel, single-worker, and
  direct-launch probes, including after forced reinstall. The harness records
  the environment incident; unchanged Linux Firefox CI remains required.

## Rollback

Rollback is a normal frontend revert. There is no schema or data rollback. The
old standalone signup route continues to exist, so an emergency revert restores
the prior link-out wall without migrating user records. Supabase users created
through B5 are ordinary accounts and remain valid across rollback.

## Required release evidence

- [x] Celebration-styled inline form replaces the wall's `/signup` link.
- [x] Copy promises only persistence each trigger can actually provide.
- [x] Completed next/share paths preserve current work through the existing
  one-shot handoff.
- [x] Loading, disabled, validation, provider-error, confirmation, resend,
  correction, dismissal, and immediate-session branches are implemented.
- [x] Keyboard, focus, stacked-modal, inertness, reduced-motion, phone scroll,
  no-overflow, and 44px contracts have executable coverage.
- [x] Direct `/signup` behavior and request metadata remain covered.
- [x] Full frontend suite, production build, E2E typecheck, focused Chromium,
  WebKit, and visual checks pass locally.
- [x] The 18-lens persona audit is recorded with no local P0/P1 open.
- [ ] Phase commit is pushed and the PR description is updated.
- [ ] Full remote CI, Linux Firefox, and deployed preview are green.
- [ ] Deployed desktop/phone browser verification passes.
- [ ] Every actionable PR review thread is resolved.
- [x] Harness doctor passes and the B5 session is finished.

## Claims deliberately not made

- B5 does not prove a signup, confirmation, lesson-2 reach, retention, or
  revenue improvement.
- A mocked confirmation response does not prove production email delivery.
- B5 does not change account authorization, quotas, pricing, model routing, or
  tutor behavior.
- B5 does not persist incomplete anonymous work by falsely marking a lesson
  complete.
- B5 does not reopen cinematic duration.
