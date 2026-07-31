# B8 governed eval sampling persona audit

Date: 2026-07-31

Branch: `dev/contextual-learning-roadmap`

Scope: B8 only — anonymous consent, pre-insert privacy boundary, sampling,
deletion/export/retention, reviewer workflow, holdout separation, operations,
browser experience, cost, and release proof.

## Verdict

**Approve B8.** No P0 or P1 persona finding remains open. Implementation commit
`edd8b0a` passed the complete CI, preview, browser, security, and shadow-
evidence matrix: 29 checks passed with only the expected preview-close skip.
The thread-aware PR audit found zero review threads and zero submitted reviews.

B8 is accurately framed as a consented, short-lived quality-review pipeline.
It does not silently archive conversations and sampled traffic cannot enter the
golden holdout directly. The learner-facing control is quiet, off by default,
plain-language, reversible, and does not add tutor latency.

This is a structured expert review through the repository's 18 persona
profiles. It is not evidence from 18 real learners. No real traffic, learning
outcome, trust, retention, reviewer throughput, or production redaction rate is
claimed.

## Findings fixed during the audit

| Priority | Finding | Resolution |
| --- | --- | --- |
| P1 | The first light-theme disclosure link measured only 3.94:1 contrast. | The compact links now use the stronger accent-muted token; Chromium axe and the 390px rendered check pass. |
| P1 | The disclosure linked to a nonexistent `/trust` route. | It now targets `/privacy#ai`, and Chromium/WebKit verify the exact privacy copy. |
| P1 | Capturing a sample could extend the learner's completed tutor request. | The successful SSE event is sent and closed first; the safe best-effort write runs afterward. |
| P1 | Repeated redacted traffic patterns could crowd reviewer capacity. | A post-redaction unique fingerprint and conflict-safe insert keep one candidate per pattern. |
| P1 | Agreeing reviews could remain pending forever and reviewers could repeatedly receive their own sample. | The weekly job closes consensus, pending lists exclude the current reviewer, and real-DB tests cover assignment. |
| P1 | The two-reviewer cap was not concurrency-safe under parallel admin submissions. | A transaction-scoped advisory lock serializes the cap decision; a three-reviewer parallel database test proves exactly two succeed. |
| P1 | A privacy defect could survive until weekly processing. | `reject_privacy` deletes the candidate immediately in the same transaction; only the bounded audit record remains. |
| P1 | The original schema allowed five minutes beyond the advertised 30-day maximum. | A forward migration enforces an exact 30-day ceiling and a real-DB constraint test rejects even one extra second. |
| P1 | Unknown provenance origins could be treated like expert-authored cases. | The CI verifier accepts only `expert-authored` or fully attested `synthetic` origins and mutation tests cover the rejection. |
| P1 | Failed reviews lacked a usable structured reason and resolved queue history could hide pending work. | Non-passing verdicts require a bounded issue code; pending synthesis items sort first and oldest-first. |

## Persona lens conclusions

| Lens | Conclusion | Release implication |
| --- | --- | --- |
| Maya — first-time phone learner | The control is off by default, compact, readable at 390px, keyboard reachable, and does not delay the answer. Turning it off stops new sharing first and gives a truthful retry state. | Approve the experience; keep the control secondary to asking and learning. |
| Alex — experienced learner | BYOK and authenticated tutor traffic are excluded. Source files, custom APIs, paths, and raw history are not stored. | Approve; never widen collection merely because an advanced learner has richer context. |
| Pedagogy | B8 creates regression candidates without changing the Socratic sequence or exposing answers. Direct traffic copying into the holdout is forbidden. | Approve the learning-quality input; require independent synthetic authoring before any golden case. |
| Product owner | The feature supports the promise of a tutor that improves responsibly while making the learner's choice visible and reversible. | Approve as trust infrastructure, not a headline acquisition feature. |
| Staff PM | Scope matches locked B8: 5% anonymous sampling plus weekly high-disagreement intake. Exit evidence and non-claims are explicit. | Ship after remote gates; measure reviewer throughput only when traffic exists. |
| Staff UX | Plain copy explains percentage, retention, exclusions, BYOK, deletion, and privacy details without a modal. Error, loading, enabled, disclosure, focus, and phone states are coherent. | Approve. Live admin visual review remains a bounded follow-up when an admin browser session is available. |
| Fresh eyes | “Help improve the tutor” is understandable; internal terms such as holdout, fingerprint, and synthesis stay out of the learner control. | Approve the learner copy; do not expose evaluation jargon on the lesson surface. |
| Hollywood director | The control adds no animation, forced beat, celebration, or interruption and does not reopen cinematic timing. | Approve; cinematic duration stays paused. |
| AI/LLM quality | Sampling is deterministic, successful-only, deduplicated, independently reviewed, disagreement-driven, and provenance-gated. The protected set cannot absorb raw traffic. | Approve the engineering loop; quality uplift remains unproven until real candidates produce reviewed synthetic cases. |
| Staff security | Consent is versioned, capability tokens are 256-bit and hashed, raw fields have no columns, redaction is pre-insert, privileges are revoked, admin access is audited, privacy rejection is immediate, and deletion remains live during a product drain. | Approve. Treat the redactor as defense in depth, not perfect de-identification. |
| Staff QA | Unit, route, real-DB, concurrency, expiry, access, failure, browser, axe, responsive, cross-browser, build, governance, and full regression evidence cover the critical invariants and unhappy paths. | Approve; the complete same-commit remote matrix passed. |
| Staff SRE | Collection is best-effort/fail-open for tutoring and fail-closed for sampling config. Jobs are bounded and `SKIP LOCKED`; a separate switch drains writes while deletion/expiry continue. | Approve with monitoring through existing error/admin channels; do not page on missing optional samples. |
| Staff SWE | The design separates projection, persistence, review, and provenance; constraints duplicate critical application rules and applied migrations are only advanced forward. | Approve. Keep future schema/policy versions explicit rather than silently changing v1. |
| Finance | B8 adds no provider call and samples only already-funded successful responses. Storage is bounded by 5%, dedupe, compact rows, and 30-day expiry. | No unit-economics blocker; reviewer labor is unknown and must be measured after traffic. |
| Business leader | A trustworthy eval-growth loop supports defensibility only if it later improves teaching quality; the mechanism alone is reproducible. | Approve as quality infrastructure, not a moat claim. |
| Competitive intelligence | Explicit consent and holdout hygiene are credible differentiators in evidence discipline, but competitors can copy the plumbing. | Publish only actual future eval results, never implementation virtue as outcome proof. |
| Contrarian | There are no real users, the redactor cannot be proven perfect, two real reviewers may not exist yet, and a pipeline can become ceremony without quality uplift. | Ship because it is off-default, bounded, reversible, and low-cost; revisit value only with real throughput and adjudicated cases. |
| Growth marketing | The control creates no acquisition or conversion channel and extra prominence could distract from the first learning win. | Keep it visually subordinate and make no growth claim. |

## Explicit non-blockers and deferred proof

- Production sample volume, redaction rates, disagreement rates, reviewer time,
  synthesis yield, and downstream eval improvement need real traffic.
- Two authorized human reviewers are required before a production candidate
  can enter synthesis. Test identities prove mechanics, not staffing.
- The conservative allowlist redactor intentionally loses prose fidelity. No
  claim is made that useful raw conversation meaning is retained.
- The live learner browser audit covers Chromium and WebKit. The admin UI is
  protected and lacked an admin-role browser session, so its evidence is route
  tests, typecheck, production build, and structured code review rather than a
  live visual session.
- The live advisor's B8 missing-reviewer-index finding was fixed. Its remaining
  B8 notices are expected informational results: backend-only RLS intentionally
  has no Data API policy, and new indexes are unused before traffic. Existing
  project warnings unrelated to B8 remain tracked separately; linked schema
  lint reports no error.
- Real learners are unavailable, so no outcome validation is claimed.
- Cinematic duration remains paused and unchanged.
