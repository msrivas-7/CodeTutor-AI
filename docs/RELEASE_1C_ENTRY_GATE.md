# Release 1C contextual tutor decision record

Status: **MERGED, DEPLOYED, AND PRODUCTION-VERIFIED UNDER FOUNDER EXCEPTION**

Decision date: 2026-08-30

Delivery: [PR #41](https://github.com/msrivas-7/CodeTutor-AI/pull/41),
[recovery follow-up #42](https://github.com/msrivas-7/CodeTutor-AI/pull/42)

## Decision

The founder explicitly directed the team to implement Release 1C without
waiting for real-learner experiment evidence. That dated exception waives the
powered Release 1B learner experiment and five-session rollout prerequisites
for this engineering slice. It does not weaken the security, cost, AI-quality,
accessibility, deterministic-test, live-browser, CI, review, rollback, or
production-verification requirements.

The implementation merged and deployed only after its complete automated model
gate, deterministic suites, adversarial browser journey, PR checks, and review
threads were green. The independent two-human calibration described in Section
9.2 has not been performed; therefore this release makes no claim that model
judging is a calibrated substitute for human evaluation and no learner-outcome,
retention, or market-impact claim.

## Gate status

| Requirement | Status | Evidence or remaining proof |
| --- | --- | --- |
| Founder exception for learner evidence | **Recorded** | The dated 2026-08-30 founder direction is recorded in this decision's `Decision` section and was limited to the Release 1B learner experiment and five-session prerequisites. |
| Locked B2 teaching contract | **Retained** | Contextual turns still pass the complete-answer firewall and provide one bounded question/hint. |
| Server authority and stale evidence | **Verified** | The server reconstructs and validates the authored move, lesson, revision, evidence code/path/line, and scaffold level. Python is parsed before execution, and only the server-owned compile diagnostic qualifies; stale offers and forged runtime stderr are rejected by the full backend suite. |
| Explicit consent and bounded admission | **Verified** | No AI request occurs before `Help me spot it`; one accepted evidence episode can schedule at most one request. The replay identity uses only server-verified actor, canonical lesson, and normalized server error; client epoch/revision cannot reset it. A real-browser double-click produced one turn and one quota decrement, while real Postgres rejected simultaneous disjoint receipt subsets and allowed fresh help only after the database-owned 15-minute window expired. |
| Deterministic recovery | **Verified** | Loading, unavailable, kill-switch, stale-generation, and changed-code paths remain useful. The actual browser discarded a stale answer and restored the quota without placing stale content in the transcript. PR #42 additionally verified safe consumed-episode recovery and distinct-error re-arming. |
| Contextual AI quality | **Passed** | Six contextual golden/adversarial cases cover normal help, source injection, stderr injection, answer pressure, stale history, and line accuracy. Local artifact `backend/eval/runs/2026-08-31T04-51-10-727Z-v2.json` passed 72/72 with every intent at 100%, zero deterministic failures, and contract `c0866e3b97a0a7e8…`. |
| Cost | **Within provisional guardrail** | Focused live evidence measured about $0.0077 per accepted call and roughly 280 net-new input tokens; the client and server cap the episode at one call. |
| Kill switch | **Implemented** | `contextual_tutor_enabled` is independently operator-controlled and defaults safely when unavailable. |
| Actual browser UX | **Passed locally and in production** | Local desktop and 390×500 light/dark/reduced-motion evidence proves explicit consent, one-call double-click protection, current receipt/citation, useful bounded help, retained focus, dismissal persistence, stale recovery, and simultaneous cue/target visibility. Finding audit `8a292b5d-dcb6-4678-9e24-11c330d0d987`; phase audit `41617175-7bc9-4905-982c-df5cf735438e`. The deployed anonymous journey then passed the changed-error offer, grounded response, replay refusal, private recovery, and distinct-error re-arm at desktop and 390×844. |
| PR, review, and CI | **Passed** | PRs #41 and #42 merged with every check green and zero unresolved actionable review threads. |
| Deployment and production | **Passed** | Exact releases [`33363783481`](https://github.com/msrivas-7/CodeTutor-AI/actions/runs/33363783481) and [`33370195367`](https://github.com/msrivas-7/CodeTutor-AI/actions/runs/33370195367) succeeded. Exact-SHA production synthetics [`33365791874`](https://github.com/msrivas-7/CodeTutor-AI/actions/runs/33365791874) and [`33370947310`](https://github.com/msrivas-7/CodeTutor-AI/actions/runs/33370947310) passed. |
| Observed exposure | **Enabled on verification date** | A fresh anonymous production trial on 2026-08-31 displayed `Help me spot it` after two changed genuine parser failures and returned one structured, line-grounded hint after explicit consent. This dated observation is not a promise that the operator kill switch or rollout scope will never change. |
| Human judge calibration | **Not performed; explicitly not claimed** | Two independent human reviewers have not labeled the required stratified set. This is recorded as a non-claim rather than fabricated evidence. |

## Non-negotiable release contract

1. A repeated, lesson-authored error cue is deterministic and costs nothing.
2. Only the learner's explicit click sends current code/run evidence to Tutor.
3. Double-clicks, repeated renders, stale state, and overlapping signed evidence
   chains cannot create a second admitted call.
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
- Production verification proves engineering delivery, not learner recovery,
  retention, or market impact.
