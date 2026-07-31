# B5 continuation-card persona audit

Date: 2026-07-31

Branch: `dev/contextual-learning-roadmap`

Scope: B5 only — restaging the anonymous signup wall as an in-product
continuation card with celebration chrome, inline account creation, honest
reason-specific copy, confirmation recovery, and desktop/phone accessibility.

## Verdict

**Approve B5 for engineering release.** The phase commit, remote CI,
deployed-preview browser checks, and thread-aware PR review audit are green. No
P0 or P1 persona finding remains open.

The card now continues the learner's current scene instead of cutting to a
generic signup page. It preserves an explicit dismissal path, makes no auth
request before submission, keeps account creation and email-confirmation
recovery inside the lesson, and does not add an AI call, database migration, or
new production service.

This is a structured expert review through the repository's 18 persona
profiles. It is not evidence from 18 real users and does not prove a conversion,
retention, learning, or revenue improvement.

## Findings fixed during the audit

| Priority | Finding | Resolution |
| --- | --- | --- |
| P1 | The old wall sent a learner from the emotional win to a generic `/signup` page. | OAuth, email fields, validation, errors, confirmation, resend, and recovery now remain in the celebration-styled card over the lesson. |
| P1 | Early labels such as “Create account & save” promised preservation on paths where only future authenticated work can save. | Save/trial-paused copy now promises only future automatic saving; completed next/share paths write the existing one-shot handoff stash before making current-progress claims. |
| P1 | Explicit conversion from the share dialog left the completion celebration mounted underneath, so “Back to lesson” returned to another modal and kept the workspace inert. | Only the explicit save-progress transition dismisses completion before opening B5; ordinary share dismissal and share-error recovery still return to the celebration with focus restored. |
| P1 | The confirmation state could have become a dead end after email delivery failure or a mistyped address. | The same card echoes the address, offers a rate-limited resend, allows a different email, and preserves a back-to-lesson action. |
| P1 | The long form could exceed a phone viewport and legal/recovery actions were smaller than the product's touch target. | The panel scrolls within `100dvh`, has no horizontal overflow at 390px, and all actions—including Terms, Privacy, and resend—have 44px targets. |
| P1 | Disabled gradient styling left a bright button with low-contrast muted text. | Disabled continuation actions remove the gradient and render as a clearly inactive elevated control. |
| P1 | A completed learner's name was available in live code or the handoff stash but not reused by the card. | The wrapper snapshots the current project at wall-open time and prefills the bounded first-name field when a real name can be extracted. |
| P2 | Sharing one form implementation initially changed the standalone signup divider copy. | The canonical form accepts context-specific divider copy: direct signup retains “or sign up with email”; B5 uses “or continue with email.” |
| P2 | Immediate geometry assertions sampled controls during the modal's `scale(0.96)` entrance and reported 42.24px for a settled 44px target. | Browser assertions now poll the unchanged geometry until the entrance settles; the harness records the reusable rule without weakening the target. |

## Persona lens conclusions

| Lens | Conclusion | Release implication |
| --- | --- | --- |
| Maya — first-time phone learner | The form appears only after value, stays attached to the win, fits a 390px phone, and can be dismissed. The learner is not forced through a cold account page. | Approve. Keep the explicit “Not yet/Maybe later” path and do not move signup before the first win. |
| Alex — direct-signup learner | The standalone route keeps its familiar copy and now shares the same validation/auth behavior as B5. The softer continuation treatment does not leak into Alex's post-signup curriculum. | Approve the shared implementation; keep direct signup compact and professional. |
| Pedagogy | B5 does not reveal answers, add tutor dependency, or interrupt the learning loop before action. It preserves the completed artifact on eligible paths. | Approve mechanism. Do not claim a learning gain from conversion UX. |
| Product owner | Replacing a clinical route change with an honest continuation makes the product promise feel coherent: the experience remains the product even at account creation. | Approve; preserve truthful save semantics as a brand contract. |
| Staff PM | The change is narrow and reversible. Existing funnel events can measure wall-open to signup completion and lesson-2 reach without new telemetry scope. | Ship the engineering slice; real conversion and downstream retention remain pending. |
| Staff UX | Inline fields, ordinary `dialog` semantics, focus containment/restoration, 44px controls, responsive scrolling, disabled/loading/error/success/recovery states, and no horizontal overflow cover the critical interaction states. | Approve after preview checks at desktop and phone widths. |
| Fresh eyes | Copy speaks in learner outcomes—save, continue, keep going—rather than auth/session jargon. The email address is echoed and recovery is visible. | Approve; support copy should keep explaining confirmation in plain language. |
| Hollywood director | The win no longer hard-cuts to an HR-form page. The card reuses the celebration's panel language and turns confirmation into the next beat rather than a tonal reset. | Approve. Cinematic duration remains untouched. |
| AI/LLM quality | B5 introduces no model call, prompt change, routing change, or generated copy. | No AI-quality gate beyond proving zero automatic AI requests on the wall path. |
| Staff security | Account creation still uses the canonical Supabase client, server/provider auth policy, allowlisted callback route, bounded first-name metadata, and existing resend controls. No credential or authorization policy moved into the browser. | Approve. Continue treating auth errors and anonymous state as untrusted. |
| Staff QA | The audit exercised every wall reason, no-request-before-submit, request metadata, confirmation/resend, direct-signup parity, modal chaining, focus/inert cleanup, reduced motion, phone scrolling, Chromium, WebKit, and failure recovery. | Approve locally; normal Firefox CI remains mandatory because the local macOS Firefox runtime could not launch. |
| Staff SRE | No database migration, queue, worker, cron, or always-on service was added. Rollback is a frontend revert; provider email/rate-limit behavior is unchanged. | Approve with ordinary auth and preview monitoring. |
| Staff SWE | One shared password-signup form removes duplicated validation and Supabase behavior. The only new cross-component seam is an explicit completion dismissor for conversion restaging. | Approve; do not grow the callback into a general modal bus. |
| Finance | The card adds no AI token spend. Confirmation and resend use the existing email path and occur only after explicit learner action. | No new unit-economics blocker; do not infer willingness to pay. |
| Business leader | Polished conversion supports the category promise but is not a moat by itself. The value is continuity and trust, not a novel form. | Approve as product coherence, not strategic defensibility. |
| Competitive intelligence | Inline post-value signup is table stakes among polished learning products. CodeTutor's differentiator remains the teaching loop and preserved learner artifact. | Do not market the card as differentiation; use it to stop leaking value at conversion. |
| Contrarian | This optimizes a funnel before real traffic proves the funnel matters. The rebuttal is that B5 is bounded, reversible, removes an obvious tonal defect, and consolidates duplicated auth code. | Ship without outcome claims; revisit only with real funnel evidence. |
| Growth marketing | The card may reduce wall-to-signup abandonment and retains the share/completion moment, but no acquisition or K-factor delta is proven. | Measure existing funnel events; do not invent a conversion uplift. |

## Explicit non-blockers and deferred proof

- Real wall-open-to-confirmed-signup, lesson-2 reach, D7 retention, and share
  conversion deltas require qualifying traffic and remain unproven.
- Email deliverability and provider throttling are external operational facts;
  the product now supplies resend and correction paths but cannot claim inbox
  delivery from a mocked browser response.
- Local Chromium and WebKit checks pass. The current macOS Playwright Firefox
  runtime repeatedly times out before page creation with Mozilla's headless
  software-compositor signature, including after reinstall and direct launch
  probes. This is recorded as an environment incident, not waived product
  coverage; Linux Firefox CI remains a release gate.
- The pushed B5 commit passed all 29 active remote checks; the one skipped job
  is the expected preview-close path for an open PR. The deployed desktop and
  390x844 phone audit passed with no console warnings/errors, no horizontal
  overflow, correct focus/inert cleanup, and 44px policy/action targets.
- Cinematic duration remains paused and unchanged.
