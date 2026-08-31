# Contextual learning roadmap — final engineering audit

> **Historical cutoff notice (updated 2026-08-31):** This document records the
> 2026-07-31 gate state. Its Release 1C hold was later superseded by the dated
> founder exception and the verified delivery recorded in
> [`RELEASE_1C_ENTRY_GATE.md`](RELEASE_1C_ENTRY_GATE.md). Do not use the 1C row
> below as the current release status.

Status: every currently eligible engineering lane is complete; deliberately
gated learner, traffic, post-merge observation, and future-phase work remains
held rather than being claimed without evidence

Date: 2026-07-31

Branch: `dev/contextual-learning-roadmap`

Pull request: [#13 — Contextual learning and delivery roadmap](https://github.com/msrivas-7/CodeTutor-AI/pull/13)

Evidence cutoff for phase product code: `6f9988a` (B8 closeout). This final
audit also includes an independent B3 rollback switch, the B7 explicit-
correction detector fix, and a patch-level development-tool lock refresh. The
current PR head and its check matrix remain the authoritative merge gate.

## Verdict

The bounded contextual-learning and delivery-velocity engineering workstream is
complete. Releases already on `main`, every eligible branch lane, the deployed
preview, database contracts, AI gates, responsive/accessibility contracts, and
the full retained browser suite have current evidence.

Five categories are intentionally not represented as completed product or
operational outcomes:

1. At this audit's cutoff, Release 1C could not start until its locked learner
   experiment, two-human eval calibration, named ownership, and approvals
   existed. The later founder exception and delivery record supersede this
   historical hold without claiming human calibration or learner outcomes.
2. B6 cannot ship until seven-day-average DAU reaches 100. No dated metric
   artifact proving that trigger exists, so the gate remains closed; if it does
   not fire, the locked roadmap carries B6 into Phase C unchanged.
3. The 0P live rollback/forward-promotion drill and the 1D 30-day/50-run shadow
   observation start after merge; no browser tests have been demoted or selected
   away.
4. 0A real-destination unfurls and B4 production indexing/traffic require
   production and third-party evidence, not preview inference.
5. Phase A phone/cold-retrieval/share/stranger evidence, B1 D7 retention, B3
   tutor-dropoff, paid conversion, and Phase C competence require real users.

Those are successful enforcement of the roadmap, not missing code in this PR.
Cinematic duration remains paused exactly as requested.

## Requirement-by-requirement closeout

| Lane | Engineering verdict | Authoritative evidence and boundary |
| --- | --- | --- |
| **0P — promotion safety** | Implementation complete on `main`; live drill held | `c786e23` promotes tested artifacts through the release manifest and rollback contract. Its automated gate is sufficient for controlled 1B moderated research because that research uses preview and does not promote production. The first controlled production rollback and forward-promotion drill requires live run URLs after merge before the operational production gate is fully exercised. |
| **0B — test isolation** | Complete on `main` | `250c526` isolates run-scoped identities and teardown. The six-shard topology was revalidated with 600/600 retry-disabled overlap runs; the full suite remains blocking. |
| **0A — share trust** | Engineering complete | `7141853` through `c884db8` isolates authenticated, non-counting crawler previews, purpose-scoped controls, bounded failure behavior, and separate share outcomes. Production destination-unfurl evidence remains an explicit external check rather than an inferred claim. |
| **0C — product contracts** | Complete | `0b6a199` plus its browser/focus fixes align claims, CTAs, destinations, persona propagation, beginner language, and no-answer rescue. Current integrated tests and preview remain green. |
| **0D — AI trust** | Complete | `7d4b4fb` plus provenance/test fixes provides atomic admission, server-owned trusted context, evaluated-model enforcement, output safety, and authoritative eval gates. Required migrations are applied to the linked development Supabase project; production migration remains part of promotion. |
| **1A — context correctness** | Complete | `b03dc13` rejects stale Run, Check, tutor, selection, completion, and stdin results by revision and operation identity without adding an AI request. |
| **1B — deterministic guide** | Engineering/internal-dogfood complete | `cf9f0a7` supplies the default-off, authored repeated-error guide with one attention owner and no automatic AI call. Browser, phone-keyboard, accessibility, and reduced-motion evidence pass. The five-session learner gate remains held, so external rollout is not claimed. |
| **1C — contextual tutor offer** | Correctly not started at this audit's cutoff; superseded | `e811e20` captured the 2026-07-31 hold. The current status and later founder exception are recorded in `RELEASE_1C_ENTRY_GATE.md`. |
| **1D — CI shadow pilot** | Additive implementation complete | `ded15ae` through `0398a4e` adds risk metadata, the advisory critical lane, frozen catch corpus, retained full browser coverage, and measured six-shard execution. The post-merge observation window has not begun and no demotion decision has been made. |
| **B1 — memory read-side** | Complete | `c81c514` through `2a0f6b9` adds server-scored retrieval evidence, own-user RLS, backend-only writes, export/deletion, authored warm-ups, and failure recovery. It does not claim real-user D7 improvement or expose the Phase C mastery graph. |
| **B2 — Socratic default** | Complete | `9994ae4` through `74c99b6` enforces one clarifying question first, bounded later help, and no complete answer across scripted/model and auth/anonymous paths; the 60-case gate, preview, persona, and remote checks pass. |
| **B3 — evidence-based model routing** | Engineering candidate complete; activation and user outcome held | `6f9a108` through `2b459a0` proves progressed check-ins benefit from Mini while walkthroughs do not. The final pass adds a production-safe activation/rollback guard and passes a fresh 60-case approval plus independent 60-case gate. Production remains on Nano unless a named operator records the dropoff protocol and bounded cohort/routing control, then explicitly sets the switch to `0`; missing, invalid, or `1` keeps/returns Nano, so organic traffic cannot auto-scale exposure. |
| **B4 — distribution** | Engineering complete | `d418895` through `a79dcd4` produces crawlable category/course/lesson pages, unique metadata and OG assets, public-only indexing, and bounded attribution. The final B4 fix passed 28 remote checks plus one expected skip; production indexing and traffic outcomes remain post-merge evidence. |
| **B5 — continuation card** | Complete | `d2b3c62` through `174f32c` restages signup inline with truthful handoff, full auth recovery, modal/focus cleanup, and responsive accessibility. |
| **B6 — paid relationship** | Correctly dormant | No dated metric artifact proves the locked DAU trigger fired, so the gate cannot open. No payment surface, cap change, or premature monetization code is shipped; the bucket carries forward unchanged if the trigger remains unmet. |
| **B7 — syntax telemetry** | Complete | `8cf02ed` through `d191043` provides calibrated, observe-only suspect-symbol telemetry. Final detector `b7.2` avoids false positives when the tutor explicitly rejects an invented call while retaining separately endorsed-call detection. It neither mutates responses nor adds a model call and passes the balanced 44-case corpus plus integrated AI gates. |
| **B8 — governed eval sampling** | Complete | `edd8b0a` through `6f9988a` provides explicit default-off consent, deterministic 5% sampling, pre-insert redaction, deletion/expiry/export, audited review, concurrency bounds, and protected holdout provenance. Both commits passed the full 29-check remote matrix with only the expected preview-close skip. |
| **Phase C** | Outside this PR | The master roadmap reserves the no-AI capstone, public competence evidence, and first institutional pilot for Phase C. This bounded Phase B workstream does not silently pull them forward. |

## Current integrated validation

The final product-code head was revalidated as one system, not inferred from
phase-specific checks:

- backend: the final local candidate passed 93 files and 1,167 tests with 21
  environment-gated tests intentionally skipped; backend typecheck and
  production build passed;
- frontend: 55 files and 443 tests passed; typecheck and production build
  passed;
- database: 11 B8 real-Postgres privacy/lifecycle/concurrency cases passed;
  linked development migrations are applied and schema lint is clean;
- AI quality: a fresh 60-case approval and independent 60-case release gate,
  approved-candidate baseline verification, independent production-safe Nano
  default and exact-`0` activation verification, eval-governance verification,
  protected provenance for all 60 trusted cases, and 44-case suspect-symbol
  calibration passed;
- content and packaging: content lint has zero errors, golden solutions pass,
  and the build emits 3 public course pages, 38 lesson pages, and 38 OG images;
- asset budgets: all JavaScript gzip is 413,315 bytes, the largest JavaScript
  chunk is 67,043 bytes, CSS is 13,112 bytes, and HTML is 1,191 bytes;
- repository controls: harness lifecycle tests, SWA tests, E2E typecheck, diff
  checks, release contracts, and strict harness doctor pass;
- browser: retry-disabled Chromium and WebKit phase evidence passes, while the
  retained full PR matrix continues to run Chromium across ten empirically
  selected shards plus Firefox and WebKit core journeys;
- personas: each applicable phase-specific 18-lens audit has no open P0/P1
  finding; these are expert reviews, not real-user evidence.

## Deployed-preview recheck

The current Azure Static Web Apps PR preview was rechecked on 2026-07-31 at
desktop and 390×844 without submitting data:

- `/learn-to-code/` exposes the category claim, 3 public courses, 13 internal
  links, unique metadata, canonical URL, and a 44px lesson CTA;
- `/lessons/python-fundamentals/hello-world` exposes unique metadata,
  `LearningResource`/breadcrumb structured data, its lesson OG image, authored
  walkthrough, adjacent navigation, and two 44px anonymous CTAs;
- `/try/lesson/python-fundamentals/hello-world` mounts the editor, lesson,
  output, Run, Check, tutor, and off-by-default sampling disclosure with 44px
  controls;
- `/privacy#ai` plainly describes provider use, explicit anonymous sampling,
  redaction, 30-day expiry, export/deletion, and holdout separation;
- all four surfaces had zero observed console errors and no horizontal
  overflow at 390px.

## Dependency and security posture

The final pass refreshed patch-level Vitest, PostCSS, and Babel dependencies in
the lockfile and reran frontend tests, typecheck, build, asset budgets, and the
production dependency gate.

The production gate reports zero unreviewed high/critical findings. It retains
one exact-version exception through 2026-08-31 for
[GHSA-QWWW-VCR4-C8H2](https://github.com/advisories/GHSA-qwww-vcr4-c8h2):
CodeTutor is a client-only BrowserRouter SPA and does not use the affected
React Server Components action surface. Any package-version change or expiry
reopens the decision. Remaining broad-audit findings are development-tool or
non-production-path findings and do not bypass the production gate.

## PR and review evidence

- one branch and one long-lived PR contain the roadmap work;
- each completed phase has a distinct implementation/closeout history and was
  returned to green before the next phase was treated as closed;
- product head `6f9988a` has 29 successful remote checks and only the expected
  open-PR preview-close job skipped;
- the thread-aware GitHub audit found zero review threads and zero submitted
  reviews at the evidence cutoff;
- the audit/documentation head must repeat the complete remote matrix before
  merge. A green earlier commit is not used to excuse a red current head.

## Merge decision

The PR is engineering-ready only when its current head—not merely the audited
product commit—has the complete required matrix green, the deployed preview is
healthy, and the review-thread audit is empty. Once those conditions hold, the
PR should leave draft status and become ready for human review. Branch
protection still requires an approving human review before merge; zero submitted
reviews or zero open threads is not approval. The held 1C/B6/1D/real-user/Phase
C gates are follow-on evidence obligations, not unfinished eligible
implementation in this PR.
