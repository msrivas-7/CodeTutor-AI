# B7 suspect-symbol telemetry persona audit

Date: 2026-07-31

Branch: `dev/contextual-learning-roadmap`

Scope: B7 only — calibration, runtime trust rules, route coverage, telemetry
privacy, failure behavior, CI enforcement, and the absence of learner-visible
response mutation.

## Verdict

**Approve B7 for engineering release.** No P0 or P1 persona finding remains
open. The implementation commit's 29 remote checks pass, with only the expected
preview-close skip, and the thread-aware audit found zero reviews and zero
review threads.

B7 is now accurately framed as calibrated suspect-symbol telemetry. It observes
completed tutor responses without blocking, changing, or retrying them. It adds
no model call and stores no conversation sample. The detector's 100% result is
bounded to a balanced 40-case labeled corpus and is not presented as semantic
proof about arbitrary Python or JavaScript packages.

This is a structured expert review through the repository's 18 persona
profiles. It is not evidence from 18 real learners and does not prove improved
learning, trust, retention, or tutor accuracy in production.

## Findings fixed during the audit

| Priority | Finding | Resolution |
| --- | --- | --- |
| P1 | Calling the pre-B7 regex a fact checker overstated its authority and hid known under-flagging. | Product and code language now use “suspect-symbol telemetry”; the release packet explicitly limits the claim to the labeled corpus. |
| P1 | A symbol mentioned only in the learner's question could be treated as trusted, allowing a fabricated answer to validate itself. | Questions remain route context but no longer authorize symbols; only runtime, learner-file, and same-span declarations do. |
| P1 | Blanket snake-case/camel-case exemptions allowed plausible-looking fabrications through. | Identifier style is no longer trusted; both styles are represented in calibration and unit tests. |
| P1 | An allowed method on an invented receiver, such as `formatter.print()`, could mask a fabricated API surface. | Dotted calls validate the terminal call and the root independently. |
| P1 | Trusting a helper merely because the tutor defined it could hide a fabricated dependency inside that helper. | The declared helper is allowed, but all calls inside its definition are still scanned. |
| P1 | JavaScript methods declared inside a tutor-provided class/object-shaped snippet were not recognized as concrete same-span definitions. | Same-span method declarations are now collected and covered by the labeled clean corpus. |
| P1 | An attempted call-shape refinement marked standard method names such as `append()` and `sort()` as fabricated, conflicting with the roadmap's known-stdlib-symbol contract and real tutor phrasing. | The complete live gate rejected the refinement; the final detector trusts known stdlib symbols while remaining explicit that it is not a semantic call-site validator. |
| P1 | A separate first-turn model sample asked where to place the answer rather than eliciting expectation, observation, attempt, or uncertainty. | The deterministic Socratic firewall now requires learner-evidence semantics; the failing case passes three focused live runs and the final 60-case gate. |
| P1 | A detector could drift silently because ordinary backend tests did not quantify false positives and misses. | A versioned 40-case corpus, four 95% release thresholds, two mutation tests, provenance fingerprinting, and an Ubuntu CI gate make drift executable. |
| P1 | Route wiring could cover only one request shape. | Authenticated sync, authenticated stream, and anonymous stream tests assert the exact completion-hook contract. |
| P1 | Operational detection could become a shadow source-code analytics pipeline. | The event excludes code, paths, questions, tutor prose, and prompts; it contains bounded route/language/version/count plus at most ten suspect identifiers. |

## Persona lens conclusions

| Lens | Conclusion | Release implication |
| --- | --- | --- |
| Maya — first-time phone learner | Nothing new interrupts the lesson, moves focus, consumes phone space, or delays the tutor response. The benefit is safer quality monitoring behind the experience. | Approve the invisible mechanism; do not claim Maya feels a difference until a later response-quality change is proven. |
| Alex — experienced learner | Custom APIs already present in Alex's files remain trusted, so project-specific code is not treated as fabricated merely because it is outside the stdlib. | Approve; retain learner-file symbols as a first-class trust source. |
| Pedagogy | Measurement does not reveal an answer or weaken the B2 try-first sequence. The incidental Socratic hardening now more reliably asks for learner evidence rather than answer placement. | Approve the mechanism and the deterministic first-turn correction; learning transfer remains unproven. |
| Product owner | B7 improves the truthfulness of “built to teach” quality operations without creating a visible feature or displacing B8 governance. | Approve as a narrow quality lane; never market the detector itself as product value. |
| Staff PM | Scope matches locked B7: lightweight known-symbol comparison and measure-only telemetry. Calibration, threshold, rollback, and exit evidence are explicit. | Ship after remote gates; do not expand it into a package resolver during this phase. |
| Staff UX | There is no new control, copy, loading state, alert, modal, focus behavior, motion, or responsive layout. | No standalone visual audit is meaningful; retain the unchanged browser matrix as regression evidence. |
| Fresh eyes | Learners never see “suspect API,” detector versions, corpus scores, or operator language. | Keep the mechanism invisible unless a future intervention has plain, helpful learner copy and its own UX audit. |
| Hollywood director | B7 adds no new beat, interruption, animation, or tonal shift. | Approve without reopening cinematic duration. |
| AI/LLM quality | The audit-requested rename, labeled calibration, mutation resistance, provenance coupling, and complete model gate are present. Known limitations are stated rather than averaged away. | Approve calibrated telemetry, not a fact-checking claim. |
| Staff security | Model output and learner context remain untrusted; the hook runs after completion, fails open, cannot authorize anything, and excludes raw code/question/path data from its event. | Approve. Treat suspect identifiers as bounded operational data under existing log access and retention controls. |
| Staff QA | Positive/clean and Python/JavaScript balance, mutation tests, route tests, unit cases, full backend regression, typecheck, build, complete live gate, and the green unchanged browser matrix cover both mechanism and coupling. | Approve. Keep the same remote gates mandatory for later commits. |
| Staff SRE | One in-process scan and existing counter/log add no service, queue, database table, pager, provider dependency, or deployment ordering. A detector failure cannot break tutor delivery. | Approve with dashboard-level observation only; do not page on this product-quality signal. |
| Staff SWE | The implementation stays a pure detector plus one completion hook per existing route. It reuses metrics/admin surfaces and avoids a parser, package index, or new analytics subsystem. | Approve the bounded abstraction; evolve only from labeled misses and false positives. |
| Finance | B7 makes zero additional model calls and adds negligible bounded CPU work. It does not change model routing, quotas, or funded admission. | No unit-economics blocker and no revenue claim. |
| Business leader | Better quality discipline supports trust, but a regex detector is reproducible plumbing rather than defensibility. | Approve as hygiene; any moat must come from governed learning outcomes, not this counter. |
| Competitive intelligence | Competitors can copy an allowlist detector. CodeTutor's value is the combination of teaching posture, deterministic safeguards, and disciplined evidence. | Do not position B7 as differentiation. |
| Contrarian | A 100% self-maintained corpus can create false confidence and telemetry may never matter without traffic. The safeguards are that the corpus is balanced, mutation-tested, tied to the full live gate, and the feature is cheap/reversible. | Ship without semantic-accuracy or production-impact claims; revisit only with real labeled misses. |
| Growth marketing | B7 creates no acquisition, conversion, sharing, or retention surface. | No growth claim; it must not delay the already-completed B4/B5 lanes or future governed work. |

## Explicit non-blockers and deferred proof

- Production precision, recall, prevalence, and operator usefulness need real
  labeled traffic or controlled review and remain unknown.
- Third-party packages, dynamic imports, aliases, chained return types, and
  runtime object types are outside this lightweight detector's semantic reach.
- A flagged identifier is a review lead, not a learner-facing verdict and not
  permission to block a response.
- Symbol identifiers are bounded operational data rather than raw source; B8's
  stricter sampling, retention, deletion, consent, and holdout-governance rules
  remain separate and must be satisfied before conversation sampling.
- No UI changed. Full remote Chromium, Firefox, WebKit, critical, security, and
  preview checks passed as regression gates, but their success is not
  misrepresented as a new B7 visual experience.
- Real learners are unavailable, so no outcome validation is claimed.
- Cinematic duration remains paused and unchanged.
