# Release 1C contextual tutor decision record

Status: **LOCALLY VERIFIED UNDER FOUNDER EXCEPTION; PR AND DEPLOYMENT PENDING**

Decision date: 2026-08-30

Branch: `dev/contextual-tutor-1c`

## Decision

The founder explicitly directed the team to implement Release 1C without
waiting for real-learner experiment evidence. That dated exception waives the
powered Release 1B learner experiment and five-session rollout prerequisites
for this engineering slice. It does not weaken the security, cost, AI-quality,
accessibility, deterministic-test, live-browser, CI, review, rollback, or
production-verification requirements.

The implementation may merge and deploy only when its complete automated model
gate, deterministic suites, adversarial browser journey, PR checks, and review
threads are green. The independent two-human calibration described in Section
9.2 has not been performed; therefore this release makes no claim that model
judging is a calibrated substitute for human evaluation and no learner-outcome,
retention, or market-impact claim.

## Gate status

| Requirement | Status | Evidence or remaining proof |
| --- | --- | --- |
| Founder exception for learner evidence | **Recorded** | 2026-08-30 direction: implement 1C and do not wait for real-user evidence. |
| Locked B2 teaching contract | **Retained** | Contextual turns still pass the complete-answer firewall and provide one bounded question/hint. |
| Server authority and stale evidence | **Verified locally** | The server reconstructs and validates the authored move, lesson, revision, evidence code/path/line, and scaffold level. Stale or forged offers are rejected by the full backend suite. |
| Explicit consent and bounded admission | **Verified locally** | No AI request occurs before `Help me spot it`; one accepted evidence episode can schedule at most one request. A real-browser double-click produced one turn and one quota decrement. |
| Deterministic recovery | **Verified locally** | Loading, unavailable, kill-switch, stale-generation, and changed-code paths remain useful. The actual browser discarded a stale answer and restored the quota without placing stale content in the transcript. |
| Contextual AI quality | **Passed** | Six contextual golden/adversarial cases cover normal help, source injection, stderr injection, answer pressure, stale history, and line accuracy. Artifact `2026-08-31T01-44-39-965Z-v2.json` passed 72/72 with every intent at 100%, zero deterministic failures, and contract `54d6d1a685df3ab1…`. |
| Cost | **Within provisional guardrail** | Focused live evidence measured about $0.0077 per accepted call and roughly 280 net-new input tokens; the client and server cap the episode at one call. |
| Kill switch | **Implemented** | `contextual_tutor_enabled` is independently operator-controlled and defaults safely when unavailable. |
| Actual browser UX | **Passed locally** | Desktop and 390×500 light/dark/reduced-motion evidence proves explicit consent, one-call double-click protection, current receipt/citation, useful bounded help, retained focus, dismissal persistence, stale recovery, and simultaneous cue/target visibility. Finding audit `05f1c23e-b616-4e7b-b3fa-9c00e1e1e208`; phase audit `84ad08b1-9eff-44cb-90c4-c4b97cee4215`. |
| Human judge calibration | **Not performed; explicitly not claimed** | Two independent human reviewers have not labeled the required stratified set. This is recorded as a non-claim rather than fabricated evidence. |

## Non-negotiable release contract

1. A repeated, lesson-authored error cue is deterministic and costs nothing.
2. Only the learner's explicit click sends current code/run evidence to Tutor.
3. Double-clicks, repeated renders, and stale state cannot create a second call.
4. The server, not the browser or source text, owns the move, evidence, and
   scaffold authority.
5. The reply acknowledges the exact latest run, cites its canonical file/line,
   asks the authored question, gives one bounded clue, and never supplies the
   complete answer.
6. Editing or navigating during generation discards stale answer content and
   shows a deterministic retry status outside the transcript.
7. The independent kill switch restores the deterministic guide without an AI
   offer.

## Claims deliberately not made

- This exception is not evidence of learner recovery or retention lift.
- Persona review and model judges are not real users or two-human calibration.
- Passing focused cases cannot replace the complete unfiltered model gate.
- Deployment cannot be called complete until the exact deployed SHA and live
  production journey are verified.
