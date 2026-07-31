# B1 memory read-side persona audit

Date: 2026-07-31

Branch: `dev/contextual-learning-roadmap`

Scope: B1 only — the deterministic, server-scored memory warm-up and the
evidence read model beneath it.

## Verdict

**Approve B1 for engineering release once CI, preview verification, and PR
review are green.** No P0 or P1 persona finding remains open in the local
implementation. This approval covers correctness, safety, accessibility, and
product coherence; it does not claim improved D7 retention, learner demand, or
competitive differentiation.

This is a structured expert review of the implementation through the 18
repository persona profiles. It is not evidence from 18 real people and is not
a substitute for the locked real-learner experiment.

## Evidence reviewed

- Product flow and copy from lesson entry through answer, feedback, retry, and
  continuation.
- Desktop and 390 px behavior, keyboard focus, reduced motion, accessibility,
  failure recovery, and automatic-AI-call assertions.
- Server scoring, answer-bank placement, database privileges/RLS, export and
  deletion behavior, idempotency, concurrency, and bounded storage.
- Full retry-disabled Chromium regression suite, focused WebKit phone journey,
  unit/integration suites, typechecks, builds, content lint, solution checks,
  static release gates, dependency audit, and development-database lint.

## Findings fixed during the audit

| Priority | Finding | Resolution |
| --- | --- | --- |
| P0 | A browser-authenticated learner could forge memory evidence if table write grants remained available. | Anonymous and authenticated writes are revoked; backend-owned transactions bind the learner explicitly. Real database tests prove browser denial and legitimate backend success. |
| P0 | Shipping answer keys in the public frontend tree would make retrieval cosmetic and leak the solution. | Warm-up banks live in backend-baked private content. The prompt response omits the correct index and explanation until an answer is scored. |
| P1 | Every authored item initially used the first choice as correct, teaching an answer-position shortcut. | Correct positions are balanced per public course and linted for majority and long-run patterns. |
| P1 | Unseen or just-taught concepts could be considered due immediately, turning teaching into a surprise test. | Due status now requires prior meaningful contact and five full days without contact or retrieval. |
| P1 | The compact header and actions could compete or overflow at phone width. | The card keeps one primary task, uses full-width phone actions and 44 px targets, moves focus deliberately, honors reduced motion, and has automated overflow/axe coverage. |
| P1 | A new cross-cutting warm-up could silently change hundreds of unrelated E2E journeys. | The shared authenticated fixture defaults the feature to a no-op; the dedicated B1 suite explicitly opts in and seeds controlled due exposure. The complete 341-case Chromium list passed without retries. |

## Persona lens conclusions

| Lens | Conclusion | Release implication |
| --- | --- | --- |
| Maya — new learner on a phone | The experience asks one plain-language question, never traps the learner, exposes retry/continue on failure, and does not silently summon AI. Mobile target size, focus, overflow, and accessible names are covered. | Approve. Do not add extra dashboard or tutor prompts to this moment. |
| Alex — experienced learner | The warm-up is short, deterministic, dismissible through continuation on failure, and avoids patronizing mastery claims. | Approve. Keep the concise copy and single-question bound. |
| Pedagogy | Exposure, supported practice, first-attempt retrieval, and spaced independent retrieval remain distinct. Feedback-assisted recall cannot become remembered or retained. | Approve the evidence model. D7 efficacy remains unproven. |
| Product owner and staff PM | B1 is a narrow learner outcome, not a general orchestration platform. It creates an honest seam for later context without prematurely surfacing a mastery graph. | Approve B1; keep B2 and Phase C independently gated. |
| Staff UX and fresh eyes | One primary attention owner, visible next action, progressive disclosure, fail-open behavior, and calm motion make the interruption legible rather than theatrical. | Approve. Cinematic-duration work remains paused. |
| Hollywood director | The transition is polished but restrained; feedback carries the emotional beat without competing animation or spectacle. | Approve the current restraint. |
| Staff security | The browser cannot choose tags, evidence type, source, or correctness; answers stay private; own-user reads and backend-only writes are enforced in the database. | Approve after the P0 privilege fix. |
| Staff QA | Retry, duplicate request, concurrent episode creation, wrong-then-correct, first-attempt, cross-user access, degraded service, and cross-feature isolation have explicit coverage. | Approve; CI and deployed preview remain mandatory gates. |
| Staff SRE | The feature has no model/provider dependency, bounded rows and payloads, idempotent writes, additive migrations, export/delete coverage, and a fail-open client path. | Approve. Monitor database/readiness surfaces after deploy. |
| Staff SWE | Canonical scoring and derivation live server-side, content is versioned, the client hook/card are narrow, and the evidence model avoids a premature generic framework. | Approve. Resist abstracting B2 before its concrete contract is known. |
| AI/LLM quality | B1 makes zero automatic AI calls, so tutor prompt/eval uncertainty cannot corrupt the retrieval result or create token cost. | Approve; AI evaluation gates apply to later contextual tutor phases. |
| Finance | Deterministic content avoids inference cost; caps, deduplication, compact evidence, and indexes bound storage/write growth. | Approve; no new paid-provider budget is introduced. |
| Business leader, competitive intelligence, and contrarian | Contextual memory is useful product coherence but is not itself a defensible moat. Engineering proof must not be narrated as demand or learning validation. | Approve the release, reject differentiation and efficacy claims. |
| Growth marketing | B1 improves the returning-learner experience but has no organic acquisition surface or validated retention lift yet. | No launch claim beyond product capability. B4 and the experiment retain their own evidence. |

## Explicit non-blockers and deferred proof

- The two existing intermediate-capstone content-lint warnings are unrelated
  to B1 and remain warnings, not hidden failures.
- No learner-visible concept graph ships in B1; that remains Phase C.
- No D7 retention, transfer, no-AI competence, demand, or differentiation
  claim is earned by local tests or persona review.
- Real-user efficacy remains governed by the locked experiment and its
  pre-registered threshold.
- CI, deployed-preview verification, and PR-thread resolution are release
  gates still to be completed after the phase commit is pushed.
