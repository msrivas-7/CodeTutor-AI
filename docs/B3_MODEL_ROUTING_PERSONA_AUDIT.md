# B3 evidence-based tutor routing persona audit

Date: 2026-07-31

Branch: `dev/contextual-learning-roadmap`

Scope: B3 only — model comparison, server-owned production routing, pricing and
admission consistency, output recovery, and the learner-facing quality of the
approved mixed Nano/Mini policy.

## Verdict

**Approve B3 for engineering release once CI, deployed-preview browser checks,
and PR review are green.** No local P0 or P1 persona finding remains open. The
larger model is used only where repeated evidence showed a material improvement:
progressed check-ins. Walkthroughs remain on Nano because Mini did not improve
them.

This is a structured expert review through the repository's 18 persona
profiles. It is not evidence from 18 real learners and does not prove improved
retention, competence, demand, or tutor-induced dropoff.

## Findings fixed during the audit

| Priority | Finding | Resolution |
| --- | --- | --- |
| P0 | A client-selected platform model could have widened cost and quality policy independently of the evaluated intent. | The server resolves signed progression and intent, rejects direct platform Mini requests, and uses one effective model for reservation, pricing, provider execution, and finalization. |
| P0 | A mixed-model baseline could pass without proving that every case used the approved model for its intent. | The release gate checks each case's actual tutor model against the baseline's intent mapping and verifies the exact used model set. |
| P1 | A single comparison run was too sensitive to model and judge variance. | The B3 gate requires three complete trials per model with identical provenance and aggregates 60 samples per candidate. |
| P1 | A comparison artifact could name the expected model at run level while carrying a different per-answer model or incomplete control cost evidence. | The gate now verifies every result's actual model and requires token/cost evidence for both control and candidate runs. |
| P1 | The roadmap proposed Mini for both walkthrough and check-in, but the evidence supported only check-in. | The decision is intent-specific: retain Nano for walkthrough; upgrade check-in to Mini. |
| P1 | Malformed structured output could either fail the request or return generic, unhelpful fallback prose. | Provider recovery now passes through the deterministic output policy with exact usage accounting; the fabricated Python list-sort case has a grounded safe correction even without usable model prose. |
| P1 | Safety filtering or partial model output could leave a walkthrough empty, omit the visible result, or attach an output explanation to an assignment. | The policy now builds a bounded visible-code fallback, guarantees terminal-operation coverage, describes nested output expressions precisely, and gives explicit print/log semantics priority during grounding. |
| P1 | A generic first-turn unknown-API question and vague input/output how-to step were technically safe but not sufficiently useful. | Deterministic fallbacks now ask for observed error plus intended behavior and ground the first input/output step in the current file. |
| P1 | Cost approval could rely on token price alone while ignoring pass rate and usage mix. | The gate enforces cost per passing response and projected mixed daily cost, and records 100/500/1,000/10,000-DAU projections. |

## Persona lens conclusions

| Lens | Conclusion | Release implication |
| --- | --- | --- |
| Maya — new learner on a phone | Check-ins are the moment when a beginner most needs a confident, concrete review; routing only that moment to Mini improves reliability without changing the UI or adding delay elsewhere. | Approve. Keep responses short and do not add automatic calls. |
| Alex — experienced learner | Walkthroughs stay on the faster model that scored better, while progressed reviews become more reliable and specific. The product does not treat “bigger model” as synonymous with “better.” | Approve the evidence-based split. |
| Pedagogy | The change improves feedback after learner action while preserving the B2 try-first sequence and complete-answer firewall. | Approve mechanism; learning and independence remain unproven. |
| Product owner | Selective routing makes “built to teach” truer without turning model prestige into product theater. | Approve; communicate behavior, not model names, to learners. |
| Staff PM | The falsifiable question was answered per intent. Check-in cleared the improvement gate; walkthrough did not. | Ship only the supported slice and retain the comparison gate for future changes. |
| Staff UX | No new control, modal, loading step, focus move, or phone layout is introduced. The experience changes only through more reliable tutor content. | Approve after deployed desktop/phone smoke. |
| Fresh eyes | Learners should never need to understand Nano, Mini, routing, or BYOK economics. The visible response remains ordinary tutor guidance. | Keep all routing terminology out of learner copy. |
| Hollywood director | The stronger model appears at the reflection beat, not as a new spectacle; the existing learning rhythm remains intact. | Approve without reopening cinematic duration. |
| AI/LLM quality | Three-trial evidence shows +16.67 percentage points for check-in and no walkthrough benefit. The complete mixed approval run and independent gated replay are both 60/60 with exact provenance and deterministic backstops. | Approve `upgrade-checkin`; reject blanket Mini routing. |
| Staff security | Server-owned routing prevents client cost escalation; BYOK remains distinct; malformed output is policy-filtered; protected prompts and injected comments remain contained. | Approve. Continue treating all model output and browser context as untrusted. |
| Staff QA | Variance, missing cases, wrong model per intent, stale fingerprints, malformed JSON, auth/anon parity, denial paths, pricing, and accounting have executable coverage. | Approve locally; remote CI and deployed smoke remain release gates. |
| Staff SRE | Routing is stateless, versioned, bounded by existing kill switches, and fails closed. No database migration or new always-on service is introduced. | Approve; rollback is a normal backend revert/deploy. |
| Staff SWE | One small routing module and explicit baseline schema keep the decision reviewable. Model selection is not spread across clients or duplicated between accounting stages. | Approve the narrow abstraction. |
| Finance | Mixed cost is $0.018525 per AI-active learner-day, below the $0.05 provisional guardrail, but the 10,000-DAU projection is material and requires monetization/cap review before scale. | Approve current routing under caps; do not extrapolate “cheap” into unlimited usage. |
| Business leader | Better tutor reliability strengthens product coherence but is not a moat until outcomes and trust compound. | Make no defensibility claim from eval scores alone. |
| Competitive intelligence | Selective model routing is invisible plumbing that competitors can copy; the value is the governed teaching behavior and evidence discipline. | Position on learner experience, not model access. |
| Contrarian | The larger model costs roughly 3.6 times more per passing response, and ChatGPT remains a strong substitute. The upgrade is justified only because the check-in delta is large and narrowly bounded. | Keep the intent gate and reject broad “premium model” expansion without new evidence. |
| Growth marketing | B3 may improve downstream trust but creates no acquisition channel or proven conversion effect. | Do not market synthetic quality scores as user outcomes. |

## Explicit non-blockers and deferred proof

- Tutor-induced dropoff cannot be evaluated without real traffic; B3's runtime
  mechanism can ship, but the Phase B outcome claim remains pending.
- Monthly cost projections assume the measured evaluation usage mix and are not
  revenue, retention, or concurrency forecasts.
- The model judge is an imperfect signal. Deterministic safety rules, repeated
  trials, absolute cases, provenance checks, and runtime policy remain separate
  gates rather than treating judge preference as truth.
- The judge is pinned to `gpt-4.1` and is instructed to treat learner context
  and tutor responses as untrusted evidence; it cannot override deterministic
  policy or production routing.
- High/critical and low dependency advisories are cleared. The two remaining
  moderate advisories are inherited from Dockerode 4's UUID dependency and
  require a separately tested Dockerode 5 major upgrade; they are not presented
  as fixed by B3.
- CI, deployed-preview verification, browser smoke, and PR-thread resolution
  remain required after the phase commit is pushed.
