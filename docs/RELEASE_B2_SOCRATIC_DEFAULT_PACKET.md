# Release B2 Socratic-default packet

Status: local implementation and release evidence complete; remote PR gates pending

Branch: `dev/contextual-learning-roadmap`

Roadmap authority: locked B2 in
`.claude/audits/2026-05-06-post-phase-27/roadmap-v2.md`

## Product contract

B2 changes the learner-initiated tutor from answer-shaped help to a staged
teaching interaction:

1. The first successful turn for a task contains exactly one open clarifying
   question and no diagnosis, explanation, hint, approach, or answer.
2. After the learner replies, the next successful turn may provide a bounded
   approach.
3. No turn may provide a complete copy-pasteable answer.

The contract applies to authenticated and anonymous requests, guided lesson and
practice help, editor help, scripted first-run rescue, and model-generated
responses. Broadening turn one or ever allowing complete-answer unlock requires
founder reapproval.

## Authority and progression contract

- The server, not browser history, selects `clarify` or `approach`.
- A successful response returns an opaque HMAC proof with version, key version,
  stage, actor hash, canonical task hash, and 24-hour expiry.
- Authenticated actors bind to user identity; anonymous actors bind to the
  server-derived IP hash.
- Guided task identity uses canonical course, lesson, and exercise identity.
  Editor task identity uses language, active file, and sorted project paths so
  ordinary edits continue the same conversation.
- Missing, forged, malformed, expired, cross-user, cross-task, or unavailable-
  key proofs fail closed to `clarify`.
- The frontend stores proofs per chat context and sends them only with that
  context. A proof is committed only after a successful current operation;
  failed, aborted, or stale streams cannot advance the learner.
- Proofs are pedagogic progression only. They grant no authorization, quota,
  hidden-test access, or protected learner context.

## Output and experience contract

- First-turn model schema allows one `checkQuestions` item and null everywhere
  else; the server output policy reconstructs the safe shape even if the model
  does not comply.
- Leading or answer-bearing questions, code punctuation, pasteable calls,
  multiline text, and oversized questions are replaced with a contextual safe
  fallback.
- Complete-answer enforcement covers every learner-visible prose channel:
  summary, diagnosis, explanation, example, walkthrough, checks, hints, next
  steps, pitfalls, comprehension check, and citation reason.
- The independent evaluation backstop traverses that same rendered surface and
  fails new pasteable calls, assignments, code fences, or arrow functions.
- Scripted turns ask first and then offer stronger structure without the exact
  final line; they are never sent back as model-authored conversation history.
- The response UI presents one “Try first” badge, one “Your turn” card, and a
  plain invitation to answer below. The question is text, not a button that
  could accidentally send itself back to the tutor.

## Cost, failure, and rollback

- B2 adds no automatic model invocation and no extra request per learner action.
- A failed request does not mint or persist progression. Invalid state degrades
  to the safer question-only response.
- Existing authenticated/anonymous admission, caps, provider timeouts,
  cancellation, idempotency, and kill switches remain unchanged.
- Application rollback is a normal frontend/backend revert and redeploy. B2 has
  no database migration or stored-state cleanup. Previously issued proofs
  become inert when the accepting code or key version is absent.
- If tutor quality degrades, remove contextual eligibility in the model
  registry or use existing AI controls; editing, Run, Check, and authored lesson
  content remain usable.

## Model-quality evidence

Approved artifact (gitignored local evidence):
`backend/eval/runs/2026-07-31T10-45-47-820Z-v2.json`

| Gate | Observed |
| --- | ---: |
| Cases | 60/60 complete |
| Provider/judge errors | 0 |
| Deterministic safety failures | 0 |
| Socratic first-turn posture | 10/10 |
| Helpful/correct by intent | 100% for all six intents |
| Posture overall | 98.33% |
| Lowest per-intent posture | 90% how-to |

The one posture disagreement is reviewed in
`docs/B2_SOCRATIC_DEFAULT_PERSONA_AUDIT.md`. It is a non-mandatory turn-two
how-to response that explained an exclusive range boundary but gave no loop,
callable expression, code line, or complete answer. The exact observed
values—not an inflated score—are approved in `backend/eval/baseline-v2.json`.
The baseline verifier and the gate evaluated against the complete artifact both
pass.

## Required release evidence

- [x] Server-signed actor/task-bound progression and hostile-token tests pass.
- [x] Authenticated and anonymous route tests prove question-first behavior and
  proof propagation without trusting browser history.
- [x] Prompt, intent, provider, policy, scripted-turn, store, client, stale-
  operation, and rendered-response tests pass.
- [x] Full backend suite passes: 1,046 tests, with only environment-gated
  integration skips.
- [x] Full frontend suite passes: 437 tests.
- [x] Backend/frontend typechecks and production builds pass.
- [x] Content lint (0 errors, two pre-existing warnings), golden solutions,
  production asset budgets, dependency audit, release contracts, and SWA
  function tests pass.
- [x] Hostile runner security suite passes 33/33.
- [x] Full retry-disabled Chromium corpus passes across six isolated shards:
  331 passed and only intentional skips.
- [x] Focused WebKit authenticated and anonymous B2 journeys pass.
- [x] Rendered desktop and 390 px audit has no overflow, console/page errors,
  focus theft, or serious/critical axe violation and honors reduced motion.
- [x] Complete 60-case live model gate and approved-baseline verification pass.
- [x] The 18-lens persona audit is recorded in
  `docs/B2_SOCRATIC_DEFAULT_PERSONA_AUDIT.md` with no local P0/P1 finding open.
- [x] Harness session is complete with zero pending incidents.
- [ ] Phase commit is pushed; required PR checks and deployed preview are green.
- [ ] Every actionable PR review thread is resolved.

## Claims deliberately not made

- B2 correctness does not prove learning, retention, transfer, or lower dropoff.
- Question-first assistance is not claimed as novel or defensible.
- The tutor is not proactive in B2 and does not infer that the learner wants a
  model call without explicit action.
- The full contextual tutor offer remains gated by 0D, 1B, B2, security/cost
  approval, and the roadmap's real-user evidence.
- Cinematic duration remains paused.
