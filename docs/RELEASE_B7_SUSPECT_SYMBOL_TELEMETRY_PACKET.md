# Release B7 suspect-symbol telemetry packet

Status: B7 phase commit green at `8cf02ed`; detector `b7.2` is a locally
validated final-audit correction governed by the final audit's current-head
matrix; production outcome evidence remains unavailable

Branch: `dev/contextual-learning-roadmap`

Roadmap authority: B7 in
`.claude/audits/2026-05-06-post-phase-27/roadmap-v2.md`

## Product decision

B7 is an observe-only quality sensor, not a fact checker. After a tutor response
finishes, detector version `b7.2` scans code-formatted spans for call-shaped
Python and JavaScript symbols. It flags a symbol only when it is not:

- a known language-runtime or standard-library symbol;
- present in the learner's current files; or
- concretely declared by the tutor in the same code span.

The learner's question is not symbol authority. Merely asking about an invented
API therefore cannot make the tutor's fabricated suggestion look valid.
Snake-case and camel-case names receive no blanket exemption.

The detector intentionally ignores a single code-formatted call when the same
sentence explicitly rejects that call, so a correct explanation such as
“arrays do not have `printAll()`” is not counted as a tutor fabrication. A
separately endorsed or repeated call remains suspicious.

The detector intentionally trusts known standard-library method symbols even
when a tutor names them without a receiver, such as `append()` or `sort()`.
That is the roadmap's lightweight known-symbol contract, not proof that every
suggested call is valid in its precise runtime context.

## Observe-only and privacy contract

- A hit never blocks, edits, delays, retries, or replaces the tutor response.
- A detector exception fails open and cannot break stream teardown.
- There is no additional provider request, model token, learner-visible state,
  database write, or new service.
- The existing `tutor_suspect_api` counter is incremented once per flagged
  response and remains available in the existing admin summary.
- The structured warning contains detector version, route, language, total
  symbol count, and at most ten suspect identifiers.
- Raw learner code, file paths, learner question, tutor prose, prompt content,
  and credentials are not written by this event.
- The event remains operational telemetry. It is not a B8 conversation sample,
  training record, or evidence that the named symbol is certainly invalid.

## Route coverage

The same completion hook runs after accounting on every shipped tutor path:

| Tutor path | Route label | Contract |
| --- | --- | --- |
| Authenticated non-streaming | `ask` | Finished raw response is scanned after finalization. |
| Authenticated streaming | `ask_stream` | Completed accumulated response is scanned without touching emitted chunks. |
| Anonymous streaming | `anon_ask_stream` | Completed response is scanned under the same detector and bounded event shape. |

Route tests assert the exact finished response, current files, question,
language, and route label passed to the detector. Admission, pricing, model
routing, and ledger behavior are unchanged.

## Calibration evidence

The tracked `suspect-api-calibration-v1.json` corpus contains 44 human-labeled
cases with fixed balance:

- 22 Python and 22 JavaScript cases;
- 22 fabricated-symbol and 22 clean cases;
- snake-case, camel-case, question-only trust, unknown receiver, unknown
  method/constructor, invented import, fabricated dependency, runtime APIs,
  learner-defined APIs, tutor-defined functions/classes/variables/methods, and
  prose-only mentions;
- matched positive/negative examples for calls that are endorsed versus
  explicitly rejected in both languages.

The release gate requires at least 95% symbol precision, symbol recall, exact
case accuracy, and clean-case accuracy. The final detector scores 100% on all
four measures. Mutation tests prove the gate rejects both an always-empty
detector and an indiscriminate always-flag detector. Ubuntu CI runs this gate
after the backend suite and approved-baseline verifier.

Calibration proves behavior on the labeled corpus only. It does not make a
regex-and-allowlist detector a complete parser, package resolver, or semantic
runtime verifier.

## Quality-contract evidence

Detector, corpus, and calibration-evaluator changes are part of the signed AI
quality-contract fingerprint. The final-audit approval points to the complete
candidate-evaluation artifact:

`backend/eval/runs/2026-07-31T23-13-41-000Z-v2.json`

That candidate-routing gate passes all 60/60 cases with zero provider errors,
zero deterministic failures, 100% helpfulness/correctness in every intent,
100% posture in every intent, and every absolute must-pass case green. The
approved fingerprint is
`3fe0e6c05a414547d570773834eb2ecdd940efd4f2524da518c537ccd1320058`.
The independent release-gate replay
`backend/eval/runs/2026-07-31T23-17-00-893Z-v2.json` also passes 60/60
against that tracked baseline.

An earlier complete run correctly rejected an over-tight call-shape rule that
treated standard method names such as `append()` and `sort()` as fabricated.
The same run exposed a separate Socratic first-turn question that asked only
where to place an answer. The final change:

- restored the roadmap's known-stdlib-symbol rule;
- retained recognition of JavaScript methods declared in the tutor's snippet;
- stopped explicitly rejected calls from becoming false-positive telemetry
  while preserving flags for separately endorsed calls;
- made the Socratic output firewall require expectation, observation, attempt,
  uncertainty, or equivalent learner evidence;
- passed three focused live repetitions of the previously unstable absolute
  case before the complete clean gate.

The failed artifact and harness incident remain in local evidence; they are not
represented as release success.

## Local verification evidence

- Suspect-symbol calibration: 44/44 exact, 100% precision, recall, exact-case,
  and clean-case rates.
- Focused detector/calibration suite: 20/20 tests pass.
- Complete backend suite: 93 files and 1,167 tests pass; 21 environment-gated
  integration tests remain skipped by their existing contract.
- Backend typecheck and production build pass.
- Approved-baseline verification matches the evaluated candidate policy and
  quality fingerprint, while separately proving production's safe-off Nano
  default and exact-`0` activation rule.
- Complete live-model candidate-routing gate passes 60/60.

## Rollback

Rollback is a normal backend and workflow revert. There is no schema, data, or
client-state rollback. Removing the completion hook stops new events; existing
aggregate process metrics expire with the process under the current metrics
architecture. Tutor responses and usage ledgers remain ordinary records because
B7 never mutates either.

## Required release evidence

- [x] Detector is calibrated and accurately named suspect-symbol telemetry.
- [x] Learner question text is not trusted as API authority.
- [x] Known runtime symbols, learner-file symbols, and same-span declarations
  are covered in both languages.
- [x] Authenticated sync, authenticated stream, and anonymous stream paths are
  wired and route-tested.
- [x] Event shape is bounded, versioned, fail-open, and excludes raw learner
  code/question/path data.
- [x] Calibration and mutation gates run locally and in CI configuration.
- [x] Full backend suite, typecheck, build, baseline verifier, and complete live
  model gate pass locally.
- [x] The 18-lens persona audit has no local P0/P1 finding open.
- [x] Phase commit is pushed and the PR description is updated.
- [x] Full remote CI and the unchanged browser matrix are green for the B7
  phase commit: 29 checks pass, including all six Chromium shards, Firefox,
  WebKit, the critical lane, E2E shadow evidence, security, and preview
  deployment; only the expected preview-close job is skipped while the PR
  remains open. Detector `b7.2` is subject to the final audit's current-head
  matrix.
- [x] Every actionable PR review thread is resolved; the thread-aware audit
  found zero reviews and zero review threads.
- [x] Harness doctor passes and the B7 session is finished.

## Claims deliberately not made

- B7 does not prove that every unflagged API is valid or every flagged symbol
  is fabricated.
- B7 does not prevent a learner from seeing a fabricated API; it measures the
  event for later quality work.
- Corpus scores do not establish production prevalence, retention, learning,
  demand, or competitive advantage.
- No user-visible UI or browser interaction changed, so B7 has no standalone
  visual-experience claim. The normal cross-browser matrix remains required as
  a regression gate.
- B7 does not implement or authorize B8 conversation sampling.
- Cinematic duration remains paused and unchanged.
