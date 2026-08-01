# Release B3 evidence-based tutor routing packet

Status: B3 phase commit green at `6f9a108`; the final-audit activation guard is
locally validated and governed by the final audit's current-head matrix;
real-user outcome evidence remains unavailable

Branch: `dev/contextual-learning-roadmap`

Roadmap authority: B3 in
`.claude/audits/2026-05-06-post-phase-27/roadmap-v2.md`

## Product decision

B3 does not upgrade both target intents merely because the larger model is
available. Three independent trials per model show:

- `gpt-4.1-mini` improves progressed check-ins from 83.33% to 100%;
- Nano and Mini tie on walkthroughs at 100%, so the larger model does not earn
  its additional cost there;
- the approved engineering candidate policy therefore uses Mini only for progressed
  `checkin` requests and keeps Nano for `socratic`, `debug`, `concept`,
  `howto`, and `walkthrough`.

The policy is server-owned and versioned as `platform-tutor-b3.v1`. A client
cannot request the platform-funded Mini route directly. BYOK requests that
pass the existing contextual-model eligibility gate retain the learner's
requested model and do not inherit platform routing.

“Engineering release” means the pre-traffic routing candidate, quality gate,
cost boundary, rollback path, and full test evidence are complete. It does not
mean Mini is proven non-inferior on tutor-induced dropoff. That real-user
guardrail uses the preregistered comparable/control cohort defined in Section
10.3 of the plan; its exact analysis window, baseline, non-inferiority margin,
power calculation, owner, and stop decision must be recorded before a measured
learner cohort begins. The evaluated candidate may merge in the current
pre-traffic state, but production fails safe to Nano unless a named operator
explicitly sets `PLATFORM_CHECKIN_MINI_DISABLED=0`. That activation is
prohibited until the preregistered protocol and a bounded cohort/routing
control are recorded. Missing, invalid, or `1` keeps Nano, so organic traffic
cannot silently expand Mini exposure. A confirmed regression sets the switch
to `1`, returning progressed platform check-ins to Nano without disabling
other tutor intents or changing BYOK routing.

## Admission, pricing, and failure contract

- Authenticated and anonymous routes resolve the signed tutor stage first,
  classify the effective intent on the server, and then reserve, price, call,
  and finalize against one effective model.
- Platform-funded Mini is eligible only for progressed check-ins. Direct Mini
  requests are rejected rather than silently widening cost or model access.
- The model registry records intent-specific evaluation eligibility. The
  baseline verifier rejects drift between the evaluated candidate routing,
  model set, dataset, evaluator, prompt/output policy, and registry version;
  it separately proves the production-safe Nano default and activation rule.
- Pricing table v2 contains Nano and Mini rates. Reservation estimates and
  finalized ledger usage both use the routed model; anonymous lifetime cost and
  platform caps remain authoritative.
- Malformed provider JSON is passed through the same deterministic output
  policy rather than exposed or turned into an unaccounted failure. Usage is
  still recorded from the provider response.
- If routing or policy validation fails, the request fails closed; it does not
  fall back to a more expensive or unevaluated platform model.
- `PLATFORM_CHECKIN_MINI_DISABLED` is the independent B3 activation/rollback
  switch. Production requires exact `0` to activate the evaluated candidate;
  missing, invalid, or `1` leaves the default Nano route, BYOK selection,
  admission, pricing, and all non-check-in intents intact. The VM refresh path
  reads it from Key Vault secret `PLATFORM-CHECKIN-MINI-DISABLED`.

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

Final-audit approved complete artifact (gitignored local evidence):
`backend/eval/runs/2026-07-31T23-13-41-000Z-v2.json`

Independent final-audit release-gate replay artifact:
`backend/eval/runs/2026-07-31T23-17-00-893Z-v2.json`

Both complete 60/60 cases with zero provider errors, zero deterministic
failures, 100% helpfulness/correctness in every intent, 100% posture in every
intent, and every absolute must-pass case green. The committed baseline pins
the exact dataset and quality-contract fingerprints from the approved run, and
the independent replay passes against that baseline. The final approved
quality-contract fingerprint is
`3fe0e6c05a414547d570773834eb2ecdd940efd4f2524da518c537ccd1320058`.

## Remote release evidence

All PR checks for `6f9a108` are green across Linux, macOS, Windows, six
Chromium shards, Firefox, WebKit, the zero-retry critical lane, security,
content, release-manifest, dependency, and preview-deployment gates. Chromium
shard 2 initially recorded one click-timing flake in an existing magic-link
test; that test passed on its built-in retry, every other shard-2 case passed,
and the one permitted job-only rerun then passed cleanly. The original failure
remains visible in the Actions history.

The deployed static preview returns 200 and the contextual-guide journey passes
at 1440x900 and 390x844: repeated current evidence selects the authored
question, highlights one current editor line, keeps both actions at least 44px,
creates no horizontal overflow, and makes zero automatic AI calls. The preview
frontend sends the newer B4 attribution shape to the older production backend,
which rejects `anon_first_run` with one `invalid_event_body` telemetry 400.
That expected branch/backend version drift is not represented as a successful
backend-preview proof; the same-commit full-stack CI telemetry contract is the
authoritative integration evidence until branch-scoped backend previews exist.

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
- [x] Evaluated candidate routing matches the gate decision and its server-owned
  route boundary is covered across authenticated, anonymous, BYOK, denial,
  reservation, pricing, and finalization paths.
- [x] The independent activation/rollback switch fails production safely to
  Nano, requires explicit operator activation, and leaves BYOK and non-check-in
  routing unchanged.
- [x] Complete 60-case candidate-routing approval run passes 60/60.
- [x] Independent release-gate replay passes 60/60 against the refreshed
  baseline.
- [x] Baseline verifier matches the evaluated candidate policy and quality
  contract after the replay, and independently proves the production-safe Nano
  default plus exact-`0` activation rule.
- [x] Final full backend suite passes: 93 test files and 1,167 tests, with only
  21 environment-gated integration skips; typecheck, the high-severity
  dependency audit, and the baseline verifier pass.
- [x] The 18-lens persona audit is recorded in
  `docs/B3_MODEL_ROUTING_PERSONA_AUDIT.md` with no local P0/P1 finding open.
- [x] Full PR CI and deployed-preview checks pass for the B3 phase commit; the
  final-audit guard is subject to the final audit's current-head matrix.
- [x] Deployed browser verification passes at desktop and phone widths.
- [x] Every actionable PR review thread is resolved; the thread-aware audit
  found no reviews or review threads.
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
