# Release B1 memory read-side packet

Status: implementation complete; draft PR remains the long-lived roadmap vehicle

Branch: `dev/contextual-learning-roadmap`

Roadmap authority: locked B1 in
`.claude/audits/2026-05-06-post-phase-27/roadmap-v2.md`

## Product contract

B1 turns Phase A's write-only concept exposure into a bounded read model and a
small retrieval experience. It does not claim that completion speed, hints,
practice, or exposure prove mastery. The learner-visible “what you've earned”
graph remains Phase C; B1 supplies the honest evidence underneath it.

The learner experiences at most one course-authored question before a lesson
when one or more previously encountered concepts have had no meaningful
contact or retrieval for five full days. Unseen and just-taught material is
never treated as due. There is no AI call. The course owns the prompt, choices, correct answer,
explanation, version, and concept tags. A backend failure provides explicit
retry and “Continue to lesson”; Run, Check, and the editor remain usable.

## Evidence contract

| Signal | Source | Highest state it can produce alone |
| --- | --- | --- |
| Lesson taught/used ledger row | Server completion hook | `encountered` |
| Practice completion | Client-observed, canonical exercise/concepts | `practiced` |
| Correct retrieval after feedback | Server-checked | `practiced` |
| Correct retrieval on first attempt | Server-checked | `remembered` |
| Independent first-attempt retrieval on dates at least five days apart | Server-checked | `retained` |

Practice stores exercise identity, attempt count, authored plus tutor hint
dose, elapsed time, and a model-assisted flag. These fields explain the dose of
support; they never elevate practice to independent recall.

## Trust, privacy, and operational bounds

- The browser nominates only canonical course/lesson/exercise identity,
  request UUID, bounded counters, elapsed time, assistance flag, and selected
  choice. It cannot provide concept tags, correct answers, evidence source, or
  evidence type.
- Correct answers live only in the backend's baked
  `content/memory-warmups/` catalog. The frontend public course tree contains
  no answer bank, and the prompt endpoint deliberately omits `correctIndex`
  and explanation.
- Every new table has an `auth.users` cascade, authenticated own-user SELECT
  RLS, least-privilege grants, and supporting user-first indexes. Browser
  clients cannot insert or update memory evidence; backend-owned transactions
  bind `user_id` explicitly. Real database tests prove both boundaries. The
  legacy ledger gets a forward-only own-user SELECT policy; anonymous IP rows
  remain unreadable.
- One active episode is allowed per learner/course/lesson/warm-up version.
  Answers cap at 100; practice deduplicates by learner/activity/concept/day;
  request UUIDs make network retries no-ops.
- Correct-choice positions are balanced across each public course bank and
  linted against majority-position or long-run patterns, so the deterministic
  experience does not teach an answer-location shortcut.
- Course concept reads cap at 200 tags; content warm-ups cap at eight per
  lesson and twelve concept tags per item. No raw code, output, prompts,
  conversations, email, IP address, or model response enters the memory tables.
- Self-service data export includes concept exposure, evidence, episodes, and
  answers. Account deletion cascades them.

## Migration and rollback

Development migrations:

- `20260731061600_add_concept_memory_read_side.sql`
- `20260731062925_add_concept_ledger_read_policy.sql`
- `20260731070930_restrict_memory_evidence_writes.sql`

All are additive or privilege-tightening and backward compatible with the previously deployed
frontend/backend. Application rollback therefore means reverting the B1
application commit and redeploying the prior artifacts; the tables may remain
dormant. Do not drop evidence tables during an incident. A destructive schema
rollback requires a separate reviewed retention/export decision.

If warm-up reads or writes degrade, the client exposes retry and a fail-open
continuation. The feature performs no model/provider call and has no AI cost
switch. Database availability remains covered by the existing readiness and
Supabase monitoring surfaces.

## Required release evidence

- [x] Content schemas and 36 authored public-lesson warm-ups pass content lint.
- [x] Backend/frontend typechecks and focused production builds pass locally.
- [x] Real development-Postgres tests cover identity isolation, owner-only RLS
  with no application filter, direct authenticated write denial, privileged
  backend writes, idempotency, concurrency, classification, spacing, practice
  evidence, routes, and export shape.
- [x] Full backend and frontend unit suites pass.
- [x] Golden solutions and all repository static/release gates pass.
- [x] Retry-disabled Chromium desktop and 390px journeys pass, including
  wrong-then-correct, first-attempt, failure recovery, focus, axe, reduced
  motion, overflow, and zero automatic AI calls.
- [x] Focused Firefox/WebKit evidence passes where the repository gate requires
  it.
- [x] The 18-lens persona audit is recorded in
  `docs/B1_MEMORY_READ_SIDE_PERSONA_AUDIT.md`; every local P0/P1 finding is
  fixed, and the remaining product claims are explicitly deferred.
- [x] Harness session is complete with zero pending incidents.
- [x] Phase commit is pushed; all required PR checks and deployed preview are
  green; every actionable review thread is resolved.

## Claims deliberately not made

- B1 correctness does not prove D7 retention improvement.
- A recognition question does not prove transfer or no-AI competence.
- `retained` is an internal evidence state, not a credential.
- The full concept graph is not yet a learner-facing product surface.
- Phase B exit remains dependent on the locked real-user experiment and its
  pre-registered 30% relative D7 improvement threshold.
