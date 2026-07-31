# Release 1C contextual tutor entry-gate audit

Status: **NOT ELIGIBLE TO START** — required learner and human-calibration
evidence is missing

Date: 2026-07-31

Branch: `dev/contextual-learning-roadmap`

Roadmap authority: Release 1C and Sections 9.2, 9.3, and 10.3 of
`docs/CONTEXTUAL_LEARNING_AND_DELIVERY_VELOCITY_PLAN.md`

## Decision

Do not implement, enable, or describe Release 1C as complete. The repository
proves that its AI boundary is substantially safer and better evaluated than
the starting point, but the locked 1C entry gate is conjunctive: every named
gate must pass. Two required forms of evidence do not exist yet, and the named
human ownership/approval record is also absent.

This decision does not block independent Phase B work. B5 may continue as its
own UX lane, the existing B7 mechanism may be audited against its locked
contract, and B8 may proceed only through its privacy/governance prerequisites.

## Requirement-by-requirement evidence

| Entry requirement | Verdict | Authoritative evidence |
| --- | --- | --- |
| Release 1B preregistered experiment passes the primary recovery rule and every applicable Section 10.3 guardrail | **Not met** | Release 1B has engineering and internal-dogfood proof only. There is no approved episode schema, powered sample-size record, experiment cohort, analysis artifact, or result proving an absolute recovery uplift of at least 8 percentage points with a 95% confidence-interval lower bound above zero. Dismissal, escalation, completion, and stale-intervention guardrails are likewise unevaluated on learners. Correctness tests and persona reviews cannot satisfy this gate. |
| Locked B2 first-turn contract | **Met for engineering release** | `docs/RELEASE_B2_SOCRATIC_DEFAULT_PACKET.md` records the server-owned question-first progression, complete-answer firewall, full 60-case gate, local suites, browser coverage, CI, preview, persona, harness, and review evidence. |
| Eval v2 automated gate | **Met for engineering release** | The complete 60-case dataset, zero-hidden-error gate, deterministic validators, per-intent floors, provenance fingerprints, and reviewed baseline are implemented and green. B3 also records an independent complete replay against the evaluated candidate routing policy while production remains safely on Nano until controlled activation. |
| Eval v2 human calibration | **Not met** | Section 9.2 requires two human reviewers to independently label at least 50 stratified cases, reach Cohen's kappa of at least 0.75 against the automated judge, adjudicate disagreements, and promote those disagreements into regression cases. No tracked calibration artifact or referenced private evidence location exists. Persona simulation and model judging are not human labels. |
| Server authority | **Met for the current tutor boundary** | Release 0D reconstructs lesson/mastery context on the server, separates trusted from untrusted fields, classifies effective intent on the server, and blocks browser-authored pedagogic authority. |
| Idempotency and bounded admission | **Met for the current tutor boundary** | Release 0D uses transactional reservation/finalization and conservative unknown-outcome accounting; B2 uses actor/task-bound signed progression and advances only after a current successful operation. Concurrent admission and failure-path tests are present. |
| Cost gate | **Mechanism met; 1C approval absent** | B3 records measured per-model cost, cost per passing response, mixed-policy daily cost, and 100/500/1,000/10,000-DAU projections below the provisional mixed-model guardrail. Release 1C has no approved contextual prompt/cost report because it is not eligible to begin. |
| Security gate | **Mechanism met; named 1C approval absent** | Release 0D and B2 cover trusted-context projection, prompt-authority attacks, cross-user isolation, output filtering, evaluated-model eligibility, quota reservation, kill switches, and hostile-token paths. The execution map still requires a named human DRI, approver, and evidence location before the 1C lane starts; no such record was found. |

## Persona audit verdict

The repository's 18 role profiles converge on the same release decision:

- Maya, Fresh Eyes, Staff UX, and Pedagogy require evidence that the
  deterministic cue helps a learner recover without becoming an interruption
  or answer-seeking shortcut.
- Staff Security, Staff SRE, Finance, and AI/LLM Quality require explicit
  consent, one-call idempotency, stale-answer rejection, bounded cost, and
  approved human evaluation before a learner-visible model offer.
- Staff PM, Product Owner, Business Leader, Competitive Intelligence, Growth,
  and the Contrarian reject synthetic quality as proof of retention,
  differentiation, or demand.
- Staff QA and Staff SWE treat the existing automated gates as necessary
  mechanism proof, not a substitute for the locked product experiment.

Therefore the persona audit does not authorize an exception. It reinforces the
roadmap gate.

## Evidence required to unlock 1C

1. Name the human DRI, approver, data owner, and durable evidence locations.
2. Obtain Product Owner, Staff Security, and data-owner approval for the
   minimal versioned episode-outcome schema, including retention, deletion,
   access, volume/cost bounds, and sample payloads.
3. Preregister the 1B experiment: randomization unit, exclusions, control,
   exposure version, analysis window, owner, stop decision, measured baseline,
   and 80%-powered sample size for the primary metric and every guardrail.
4. Run the experiment and pass the primary recovery rule plus every applicable
   guardrail without a confirmed stale/wrong intervention.
5. Complete the two-human, at-least-50-case eval calibration, achieve kappa of
   at least 0.75, adjudicate disagreements, and add regression cases.
6. Record explicit security and cost approval for the proposed 1C boundary.

Only after all six items have authoritative evidence may implementation start.
At that point the release must still prove click-as-consent, zero calls before
the click, at most one billed call after acceptance, current-evidence and
scaffold propagation, stale-stream discard, deterministic offline/quota/BYOK/
kill-switch recovery, the locked B2 first turn, no complete answer, and an
approved prompt/cost report.

## Claims deliberately not made

- Green CI or a live-model eval does not prove independent learner recovery.
- The five-session qualitative protocol cannot unlock 1C.
- Persona audits are expert design reviews, not real users or human eval
  calibration.
- Existing 0D/B2/B3 mechanisms do not constitute the missing 1C product,
  security, cost, or data approvals.
- Cinematic duration remains paused.
