# B2 Socratic-default persona audit

Date: 2026-07-31

Branch: `dev/contextual-learning-roadmap`

Scope: B2 only — the server-enforced first-question tutor contract and its
authenticated, anonymous, scripted, and model-generated learner surfaces.

## Verdict

**Approve B2 for engineering release once CI, preview verification, and PR
review are green.** No local P0 or P1 persona finding remains open. Turn one is
one clarifying question, turn two may provide an approach, and no turn may
provide a complete copy-pasteable answer.

This is a structured expert review through the repository's 18 persona
profiles. It is not evidence from 18 real learners and does not prove improved
retention, independent problem solving, demand, or differentiation.

## Evidence reviewed

- The signed server progression proof, user/task binding, expiry, key rotation,
  hostile payload handling, and fail-closed behavior.
- Authenticated and anonymous routes, guided lesson/practice identity, editor
  identity, model prompts, output enforcement, scripted rescue turns, and the
  learner-visible response cards.
- Desktop and 390 px rendering, focus retention, reduced motion, overflow,
  console errors, accessibility, retry/error behavior, and cross-browser
  WebKit journeys.
- The complete retry-disabled Chromium corpus, security suite, unit/integration
  suites, typechecks, production builds, content/solution gates, dependency and
  release checks, and the full 60-case live tutor evaluation.

## Findings fixed during the audit

| Priority | Finding | Resolution |
| --- | --- | --- |
| P0 | Browser history could not be trusted to decide when an approach was unlocked. | A server-signed, expiring proof now binds the actor and canonical task; absent, malformed, expired, cross-user, cross-task, or wrong-key proofs fall back to the one-question stage. |
| P0 | Preventing complete answers only in action fields left other rendered prose able to leak paste-ready code. | Runtime enforcement now covers summaries, explanations, examples, walkthrough bodies, checks, pitfalls, and citation reasons; the independent release evaluator checks the same learner-visible surface. |
| P1 | A syntactically valid JSON primitive such as `null` could reach token-field access before validation. | The parser now validates the unknown payload as a complete object before any field is read; hostile primitives, arrays, and partial objects have explicit tests. |
| P1 | A first-turn question could be technically interrogative but still lead with the answer or fix. | The policy rejects answer-bearing verbs, code punctuation, multiline/oversized text, and unsafe calls; deterministic context-aware fallbacks keep the question useful. |
| P1 | The scripted first-run rescue supplied the exact line the learner was meant to write. | The first rescue asks one question; the next offers structure without a complete line. Scripted turns are excluded from model conversation history. |
| P1 | The first-question card repeated the same label and used success styling before the learner had acted. | One outer “Try first” badge now frames a calm “Your turn” card with explicit reply microcopy and no self-submitting question button. |

## Persona lens conclusions

| Lens | Conclusion | Release implication |
| --- | --- | --- |
| Maya — new learner on a phone | The tutor asks one plain question, leaves focus in the reply box, does not auto-submit its own question, and fits at 390 px without overflow or a new cinematic interruption. | Approve. Keep the one-action hierarchy and paused cinematic-duration decision. |
| Alex — experienced learner | The question is grounded in the current request or result and the second turn can move to a concrete approach instead of remaining evasive. | Approve. Do not broaden turn one to explanations without founder reapproval. |
| Pedagogy | The contract creates an actual learner turn before scaffolding and never converts repeated struggle into answer delivery. | Approve the mechanism; learning efficacy remains unproven. |
| Product owner | The implementation fulfills the locked B2 promise across every current tutor entry path without inventing a new learner-memory platform. | Approve B2 as a bounded roadmap gate. |
| Staff PM | The smallest coherent behavior is shipped and measurable: one question, then approach, never a complete answer. | Approve; keep B3 and proactive contextual offers independently gated. |
| Staff UX | “Try first” owns attention, “Your turn” states the action, focus stays in the composer, and the card avoids false success styling or stacked confirmation. | Approve the rendered hierarchy. |
| Fresh eyes | The copy is short, avoids internal terms such as proof/stage/token, and tells the learner exactly where to answer. | Approve. |
| Hollywood director | Removing the scripted exact answer repairs the product's teacher character; the restrained response transition is enough. | Approve without reopening cinematic timing. |
| AI/LLM quality | Server stage controls the prompt and output firewall. The 60-case live artifact has zero errors, zero deterministic failures, 100% first-turn Socratic posture, and 100% helpfulness/correctness in every intent. | Approve the reviewed baseline. One conservative non-mandatory judge disagreement is recorded, not hidden. |
| Staff security | The client cannot mint or widen progression. Proofs are HMAC-signed, actor/task-bound, expiring, and fail closed; protected-value scrubbing and output enforcement remain server-side. | Approve. The proof is pedagogic state, not authorization for hidden data. |
| Staff QA | Forged/expired/cross-context proofs, failed streams, stale operations, auth/anon parity, mobile/focus/accessibility, full regression, and security boundaries have executable coverage. | Approve locally; GitHub Linux Firefox and the remaining remote checks still gate release. |
| Staff SRE | The proof is stateless and bounded, introduces no storage dependency, adds no automatic model call, and degrades to the safer question-only state. | Approve; existing provider/cost kill switches remain authoritative. |
| Staff SWE | Canonical task construction and proof verification live on the server; the frontend stores only opaque per-chat state and commits it only for the current successful operation. | Approve the narrow design; do not generalize it into an event platform. |
| Finance | B2 does not add a call: a learner action still produces at most the existing single request, and a failed request does not advance progression. | Approve with no new platform-funded budget. |
| Business leader | Better teaching behavior improves product coherence but is not itself a moat. | Approve capability language only. |
| Competitive intelligence | Socratic/context-aware assistance is category parity unless real outcomes show otherwise. | Do not claim differentiation from engineering evidence. |
| Contrarian | A question-first tutor can frustrate answer-seeking users; allowing a useful approach on turn two is the necessary counterweight. | Keep the turn-two usefulness gate and monitor real behavior later. |
| Growth marketing | B2 strengthens the trial and learning experience but has no proven acquisition or retention effect. | Make no growth claim until real traffic exists. |

## Live-evaluation review

The approved 60-case run completed every case with no provider error and no
deterministic safety failure. All ten Socratic cases passed posture and
helpfulness/correctness. Every intent achieved 100% helpfulness/correctness.
Posture was 98.33% overall and 90% in how-to because one non-mandatory case was
judged conservatively: it explained that a Python range stop is exclusive and
named the boundary needed to include ten, but supplied no loop, callable
expression, code line, or complete solution. That result satisfies the locked
“turn two may give an approach” contract and the preregistered ≥95% overall/
≥90% per-intent floors. The exact observed rate is committed as the new
regression baseline rather than rounded up or discarded.

## Explicit non-blockers and deferred proof

- Local Firefox cannot create a page because the Playwright Firefox renderer
  stalls during launch; the repository harness already classifies this macOS
  pre-page limitation. The same B2 journeys pass in Chromium and WebKit, and
  GitHub-hosted Linux Firefox remains the release gate.
- The two existing intermediate-capstone content warnings are unrelated and
  remain warnings, not hidden failures.
- Progression is conversation-scoped and stateless; a reload begins a new tutor
  conversation and therefore safely returns to the question-only stage.
- No automatic or proactive tutor offer is introduced by B2.
- No retention, transfer, no-AI competence, demand, or competitive claim is
  earned by tests or persona review.
- CI, deployed-preview verification, and PR-thread resolution remain required
  after the phase commit is pushed.
