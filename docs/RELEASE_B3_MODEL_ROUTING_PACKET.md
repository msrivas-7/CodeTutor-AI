# Release B3 evidence-based tutor routing packet

Status: local implementation and quality gates complete; CI, deployed preview,
browser verification, and PR review clearance pending

Branch: `dev/contextual-learning-roadmap`

Roadmap authority: B3 in
`.claude/audits/2026-05-06-post-phase-27/roadmap-v2.md`

## Product decision

B3 does not upgrade both target intents merely because the larger model is
available. Three independent trials per model show:

- `gpt-4.1-mini` improves progressed check-ins from 83.33% to 100%;
- Nano and Mini tie on walkthroughs at 100%, so the larger model does not earn
  its additional cost there;
- the approved production policy therefore uses Mini only for progressed
  `checkin` requests and keeps Nano for `socratic`, `debug`, `concept`,
  `howto`, and `walkthrough`.

The policy is server-owned and versioned as `platform-tutor-b3.v1`. A client
cannot request the platform-funded Mini route directly. BYOK requests that
pass the existing contextual-model eligibility gate retain the learner's
requested model and do not inherit platform routing.

## Admission, pricing, and failure contract

- Authenticated and anonymous routes resolve the signed tutor stage first,
  classify the effective intent on the server, and then reserve, price, call,
  and finalize against one effective model.
- Platform-funded Mini is eligible only for progressed check-ins. Direct Mini
  requests are rejected rather than silently widening cost or model access.
- The model registry records intent-specific evaluation eligibility. The
  baseline verifier rejects drift between production routing, evaluated model
  set, dataset, evaluator, prompt/output policy, and registry version.
- Pricing table v2 contains Nano and Mini rates. Reservation estimates and
  finalized ledger usage both use the routed model; anonymous lifetime cost and
  platform caps remain authoritative.
- Malformed provider JSON is passed through the same deterministic output
  policy rather than exposed or turned into an unaccounted failure. Usage is
  still recorded from the provider response.
- If routing or policy validation fails, the request fails closed; it does not
  fall back to a more expensive or unevaluated platform model.

## Quality and economics evidence

Tracked comparison report: `backend/eval/b3-model-comparison.json`

| Measure | Nano | Mini |
| --- | ---: | ---: |
| Samples | 60 | 60 |
| Overall pass rate | 91.67% | 100% |
| Walkthrough pass rate | 100% | 100% |
| Check-in pass rate | 83.33% | 100% |
| p95 latency | 6,803 ms | 7,683 ms |
| Cost per passing response | $0.000452 | $0.001632 |

The resulting mixed policy projects $0.018525 per AI-active learner-day, below
the provisional $0.05 mixed-model guardrail. At the same measured usage it
projects approximately $55.57/month at 100 AI-active daily learners, $277.87 at
500, $555.74 at 1,000, and $5,557.38 at 10,000. These are engineering projections, not a
pricing or demand forecast.

The per-intent gate requires a candidate pass rate of at least 95%, at least a
5-percentage-point improvement, and a one-sided Fisher exact p-value no greater
than 0.05, in addition to zero deterministic candidate failures. Walkthrough
ties therefore remain on Nano rather than paying more for no measured gain.
The report separately signs the response-quality contract and the statistical
decision-gate implementation, so either kind of drift invalidates the relevant
evidence without forcing unrelated reruns.

Final comparison artifacts (gitignored local evidence):

- Nano: `2026-07-31T16-45-30-465Z-v2.json`,
  `2026-07-31T16-46-55-481Z-v2.json`, and
  `2026-07-31T16-48-13-846Z-v2.json`.
- Mini: `2026-07-31T16-49-59-698Z-v2.json`,
  `2026-07-31T16-52-03-918Z-v2.json`, and
  `2026-07-31T16-54-13-414Z-v2.json`.

Approved complete artifact (gitignored local evidence):
`backend/eval/runs/2026-07-31T16-58-11-789Z-v2.json`

Release-gate replay artifact:
`backend/eval/runs/2026-07-31T17-02-15-053Z-v2.json`

Both complete 60/60 cases with zero provider errors, zero deterministic
failures, 100% helpfulness/correctness in every intent, 100% posture in every
intent, and every absolute must-pass case green. The committed baseline pins
the exact dataset and quality-contract fingerprints from the approved run, and
the independent replay passes against that baseline.

## Additional tutor hardening completed during B3

- Walkthroughs are split and grounded to the correct visible source line;
  continuation starts at the learner's requested line.
- If model walkthrough steps are unusable or omit the visible terminal
  operation, a bounded source-grounded fallback completes the explanation.
  Output expressions such as `print(len(items))` are described precisely, and
  explicit print/log steps cannot be misgrounded to a prior assignment.
- Instruction-like comments are ignored instead of treated as tutor commands.
- Check-ins have deterministic grounding for common input/output reasoning and
  missing-output mistakes.
- First-turn unknown-API help asks for the observed error and intended behavior,
  and Python input/output how-to requests receive one grounded try-first step.
- Prompt-extraction refusals explicitly protect system instructions and hidden
  values while returning to visible code.
- Fabricated Python list methods are corrected against the exact source line;
  the sort-method case remains useful even if provider JSON is malformed.

## Required release evidence

- [x] Three clean repeated Nano and Mini trials use the final dataset,
  evaluator, judge, prompt, output policy, and provenance fingerprint.
- [x] The automated B3 gate independently enforces repeat count, provenance,
  per-result model identity, complete cost evidence for both models, quality
  improvement, Fisher significance, candidate floor, p95 latency, cost per
  pass, and mixed daily cost.
- [x] Production routing matches the gate decision and is covered across
  authenticated, anonymous, BYOK, denial, reservation, pricing, and finalization
  paths.
- [x] Complete 60-case production-routing approval run passes 60/60.
- [x] Independent release-gate replay passes 60/60 against the refreshed
  baseline.
- [x] Baseline verifier matches the final production policy and quality
  contract after the replay.
- [x] Final full backend suite passes: 84 test files and 1,092 tests, with only
  21 environment-gated integration skips; typecheck, the high-severity
  dependency audit, and the baseline verifier pass.
- [x] The 18-lens persona audit is recorded in
  `docs/B3_MODEL_ROUTING_PERSONA_AUDIT.md` with no local P0/P1 finding open.
- [ ] Full PR CI and deployed-preview checks pass for the B3 commit.
- [ ] Deployed browser verification passes at desktop and phone widths.
- [ ] Every actionable PR review thread is resolved.
- [x] Harness session is complete with zero pending incidents; harness doctor
  passes.

The pinned `gpt-4.1` judge treats learner context and tutor responses as
untrusted evidence. `npm audit --audit-level=high` is clear. The remaining two
moderate advisories come from Dockerode 4's UUID dependency and require a
separate Dockerode 5 major-upgrade decision; they are not hidden as B3 release
success.

## Claims deliberately not made

- Synthetic and expert-judged evaluations do not prove retention, transfer,
  lower tutor-induced dropoff, demand, or competitive advantage.
- The walkthrough route was not upgraded; the evidence did not justify it.
- B3 does not add automatic tutor calls or proactive learner interruption.
- BYOK model quality remains dependent on the learner-selected provider model.
- Real-user B3 outcome evidence remains unavailable until traffic exists.
- Cinematic duration remains paused.
