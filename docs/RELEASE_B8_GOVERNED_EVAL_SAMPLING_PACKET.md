# Release B8 governed eval sampling packet

Status: engineering release gates complete for implementation commit `edd8b0a`

Branch: `dev/contextual-learning-roadmap`

Roadmap authority: B8 in
`.claude/audits/2026-05-06-post-phase-27/roadmap-v2.md`

## Product decision

B8 adds an explicit, off-by-default way for signed-out learners to help improve
the tutor. When a learner opts in, a deterministic 5% of successful,
CodeTutor-funded anonymous tutor turns become short-lived quality-review
candidates. The tutor answer is delivered before the best-effort database
write, so collection cannot extend learner-visible response latency.

This is not a transcript store and it is not model training. The database has
no columns for source files, selections, stdin, stdout/stderr, raw history,
paths, IP addresses, or BYOK content. A conservative redactor removes code,
secrets, contact details, paths, literals, numbers, proper names, and every
unknown word before insertion. Only bounded redacted question/response text
and coarse quality metadata are retained.

## Consent, deletion, export, and retention

- Consent is absent by default and is shown beside the anonymous tutor input.
- Enabling creates a browser-held 256-bit deletion capability. Only its
  domain-separated SHA-256 hash is stored.
- Turning the control off stops new sampling before deletion is attempted.
  A failed deletion remains visibly retryable and never silently re-enables
  collection.
- The deletion route remains available when the anonymous lesson kill switch
  is off and returns no existence or row-count oracle.
- If the learner signs up, retained rows are linked by the hashed capability
  so they appear in the account export and cascade on account deletion.
- Database constraints enforce an exact maximum of 30 days. An hourly bounded
  `SKIP LOCKED` job deletes expired rows and their reviews/queue entries.
- An independent `ai_eval_sampling_enabled` switch stops new collection and
  fails closed if operational configuration is unavailable.

## Sampling and data boundary

Admission requires all of the following:

1. anonymous lesson route;
2. platform-funded request;
3. current explicit consent version;
4. deterministic 5% request bucket;
5. sampling kill switch enabled; and
6. successful completed tutor response.

Authenticated and BYOK tutor routes do not accept or process this consent.
Failed, aborted, unconsented, stale-consent, and out-of-bucket requests are not
stored. Repeated post-redaction patterns deduplicate to one retained candidate.

Allowed fields are limited to model, language, course/lesson, routed intent,
Socratic stage, redacted learner/tutor text, section names, coarse file/source
size/history/run metadata, redaction counters, policy versions, timestamps,
and a post-redaction pattern fingerprint.

## Independent review and golden-set separation

- B8 tables are backend-only: RLS is enabled and `PUBLIC`, `anon`, and
  `authenticated` privileges are explicitly revoked.
- Admin access uses the existing authenticated admin middleware. Every list,
  review, and queue-resolution action writes an audit event without raw text.
- A sample can receive at most two independent reviews. A transaction-scoped
  advisory lock makes that cap safe under concurrent submissions, and a
  reviewer is not offered the same pending sample twice.
- Privacy rejection deletes the candidate immediately; the audit event remains.
- A weekly bounded job closes two-reviewer consensus and queues only
  two-reviewer disagreement. Pending synthesis work is ordered ahead of
  historical resolutions.
- Sampled text never enters the repository golden holdout. A reviewer must
  independently author a synthetic case from the abstract pattern, record two
  reviewer aliases and an authoring attestation, and then resolve the queue.
- CI verifies explicit provenance for every trusted eval case, rejects traffic
  fields and unknown origins, requires unique source-pattern fingerprints for
  synthetic cases, and rejects duplicate learner content.

The engineering workflow is proven with synthetic fixtures. No real anonymous
traffic has been collected or promoted, and two real authorized reviewers are
still an operational prerequisite for a production disagreement candidate.

## Local verification evidence

- Real Postgres B8 integration suite passes 11/11 tests covering bounded projection, idempotency,
  post-redaction dedupe, Data API denial, export/account cascade, anonymous
  deletion, independent assignment, concurrent reviewer cap, disagreement,
  consensus, privacy rejection, exact retention, expiry, and both cron jobs.
- Focused backend/database/governance routes and invariants pass.
- Complete backend suite passes 92 files and 1,160 tests with the repository
  environment loaded; 3 files and 21 existing environment-gated tests skip by
  their existing contracts.
- Complete frontend suite passes 55 files and 443 tests.
- Backend and frontend production builds pass; discovery emits 3 course pages,
  38 lesson pages, and 38 OG images.
- Approved eval baseline, 60-case holdout-governance verifier, and 44-case
  suspect-symbol calibration pass.
- Content lint has zero errors (two pre-existing empty-concept warnings), all
  golden solutions pass, E2E TypeScript passes, and production asset budgets
  pass.
- Chromium passes 3/3 B8 browser cases with retries disabled. WebKit passes
  1/1 390px phone case with retries disabled. The audit covers default
  off, request-time consent, deletion and retry failure, keyboard focus,
  44px controls, reduced motion, no overflow, axe, disclosure copy, and the
  public privacy destination.
- Supabase migration parity and dry-run are clean; linked schema lint reports
  no errors. The live advisor's one B8 missing-foreign-key index finding was
  fixed. Remaining B8 advisor items are informational and expected before
  traffic: backend-only RLS has intentionally no Data API policy, and the new
  reviewer/synthesis indexes have not yet been used.

Implementation commit `edd8b0a` passed the complete same-commit remote matrix:
29 checks passed, including all six Chromium shards, Firefox, WebKit, the
no-retry critical lane, E2E shadow evidence, security scenarios, Windows/macOS/
Ubuntu build and test jobs, preview deployment, secret scanning, content,
assets, release contracts, and golden solutions. The preview-close job was the
single expected skip for an open pull request. The thread-aware PR audit found
zero review threads and zero submitted reviews.

## Rollback

1. Set `ai_eval_sampling_enabled=false` to stop new samples without disabling
   tutor answers or deletion.
2. Revert the application/workflow commit to remove the learner and admin UI,
   route capture, and governance gate.
3. Keep the forward-applied tables and cron cleanup in place until all retained
   rows expire or are deleted. Do not roll back by dropping privacy data in an
   application deploy.
4. If the schema must later be removed, use a reviewed forward migration only
   after confirming the table is empty and the retention/delete obligations
   are complete.

## Required release evidence

- [x] Explicit, versioned, off-by-default consent exists only on the anonymous
  platform-funded surface.
- [x] A deterministic 5% bucket and successful-completion gate are tested.
- [x] Raw source, files, paths, terminal data, history, IPs, identifiers,
  contact details, literals, and secrets are excluded or redacted pre-insert.
- [x] BYOK and authenticated traffic are outside the sampling path.
- [x] Browser deletion, retry, handoff/export, account cascade, and exact
  30-day expiry are executable and tested.
- [x] Backend-only privileges, admin guard inheritance, audit events, bounded
  jobs, dedupe, concurrency-safe two-reviewer cap, consensus, disagreement,
  and immediate privacy rejection are implemented.
- [x] Traffic candidates remain separate from the golden holdout and CI
  enforces explicit non-traffic provenance.
- [x] Full local regression, build, database, AI-governance, browser,
  accessibility, responsive, content, and asset-budget gates pass.
- [x] The structured 18-lens persona audit has no local P0/P1 finding open.
- [x] Phase commit is pushed and the PR description is updated.
- [x] Full remote CI, preview, browser, security, and shadow-evidence checks
  pass on the phase commit.
- [x] Every actionable PR review thread is fixed and resolved (zero threads
  present at the implementation-commit audit).
- [x] Harness doctor passes and the B8 session is finished.

## Claims deliberately not made

- B8 does not prove improved tutor quality, learning, retention, demand, or
  reviewer usefulness without real traffic and later outcome evidence.
- Conservative redaction reduces privacy risk; it is not claimed to be a
  mathematically perfect detector for every possible secret or identity.
- A redacted traffic candidate is not a golden case. It can only inspire a new
  independently authored synthetic case after disagreement review.
- The admin surface has backend route/build/test evidence but no live browser
  session was available with an admin role during the local visual pass.
- B8 adds no automatic tutor interruption, proactive help, or extra model call.
- Cinematic duration remains paused and unchanged.
