# Release 0A — share trust packet

Status: engineering release gates complete at `7141853`; real-destination
proof remains a post-production-deployment gate

Branch: `dev/contextual-learning-roadmap`

Roadmap authority: Release 0A in
`docs/CONTEXTUAL_LEARNING_AND_DELIVERY_VELOCITY_PLAN.md`

## Product change

Social crawlers now use a dedicated non-counting metadata route. Their traffic
cannot inflate the reader count, consume public reader rate capacity, or keep
an orphaned image alive. One real human visit still increments the count once.

The crawler adapter returns full metadata when healthy and safe on-brand
generic metadata during configuration, timeout, rate-limit, or backend
failure. It never falls back to the counting public endpoint.

Share behavior now records four honest outcomes:

- `copied`: clipboard write succeeded;
- `share_completed`: the native share sheet resolved;
- `cancelled`: the learner closed the native share sheet (`AbortError`);
- `dismissed`: the CodeTutor share dialog was closed.

## Trust and operations contract

- ADR: `docs/ADR_0A_SHARE_PREVIEW_AUTH.md`.
- Staff Security and Staff SRE persona approval is recorded in the ADR and the
  18-lens audit.
- HMAC-SHA256 binds method, canonical path, timestamp, nonce, and key ID.
- The backend accepts a 30-second window, rejects replay, and supports current
  plus previous keys for rotation.
- The DTO excludes code, user/IP identity, view count, IDs, story images,
  timestamps, and storage paths.
- Service budget: 600 authenticated requests/minute/key, independent of public
  readers.
- Adapter: 800 ms upstream timeout, at most two reads with a 200 ms readiness
  gap, same-token coalescing, 500-entry LRU, short positive/negative TTLs, and
  a circuit breaker.
- Backend and SWA preview kill switches do not disable public human share
  reads.
- Metrics are bounded and never label by token, signature, key, nonce, or IP.

## Current deterministic evidence

- Cross-runtime HMAC test vector matches in backend TypeScript and SWA Node.
- Missing, malformed, badly signed, stale, replayed, current-key, and
  previous-key cases pass. Replay retention covers the exact inclusive end of
  a future-dated signature's accepted window.
- The internal route returns only the expected nine-key DTO.
- Real development Postgres: five concurrent crawler reads leave
  `view_count=0`; one subsequent cold public read reaches 200 and produces
  `view_count=1`.
- Revoked shares return 404 from the preview route.
- SWA tests prove coalescing, bounded caching, revocation-aware expiry,
  matching 30-second intermediary revalidation, negative caching, circuit
  opening, safe generic degradation, and zero public endpoint fallback.
- Share outcome schema rejects unknown outcomes, surfaces, and extra token
  fields.
- A bounded 650-request burst admits exactly 600 requests in the fixed window,
  rejects the remaining 50 with `429`, and performs exactly 600 share reads.
- The current/previous overlap accepts both keys, old-key removal rejects the
  retired key, and replayed nonces are rejected.
- A signed request through the rebuilt Node 20 backend container reaches the
  authenticated `404` contract; removing the temporary credential restores
  the route to a fail-closed `503` without changing public reads.
- The dedicated production credential was generated once on 2026-07-31 and
  presence-verified in backend Key Vault plus SWA API application settings;
  its value was never printed or persisted in the repository/worktree.
- Full local gates pass: backend 1,112 tests, frontend 438 tests, SWA 18 tests,
  security 33 scenarios, production builds, typechecks, asset budgets,
  dependency audit, content/solution validation, and eval-baseline integrity.
- Retry-disabled Chromium evidence passes seven share-outcome/recovery cases,
  the stacked-dialog focus restoration case, three 390 px/reduced-motion share
  artifact cases, and three revoked/unknown/canonical-metadata cases.
- The complete PR matrix is green at `7141853`: Linux, macOS, and Windows
  builds/tests; release, content, asset, secret, security, adapter, and shell
  gates; six Chromium shards; Firefox, WebKit, the advisory critical lane, and
  the E2E shadow-evidence collector.
- Chromium shard 3 initially stopped during Playwright browser installation
  before running product tests. Its isolated retry completed setup, executed
  the tests, and passed; no product assertion was weakened or retried.
- The deployed PR preview passes retry-disabled desktop and 390 px checks and
  returns safe generic metadata when its older production backend lacks the
  candidate internal route. This is deployment-skew evidence, not same-commit
  backend proof.
- GitGuardian is green after the deterministic HMAC vector was changed from a
  secret-shaped literal to an independently derived low-entropy byte recipe.

## Required release evidence

- [x] Backend, frontend, and SWA full suites pass after final edits.
- [x] Backend and frontend typechecks plus production build pass.
- [x] Real-database share and telemetry integration suites pass.
- [x] Burst proof demonstrates preview traffic cannot reduce public reader
  capacity and records the measured service ceiling.
- [x] Current/previous credential overlap, old-key removal, replay, and
  emergency revocation drills pass.
- [x] Backend and adapter preview kill-switch drills leave human reads live.
- [x] Local browser proves copy/completed/cancelled/dismissed outcomes,
  keyboard/focus behavior, 390 px layout, reduced motion, and error recovery.
- [ ] Fresh production tokens render correctly in Slack, Discord, LinkedIn,
  and iMessage; timestamped captures, click-through, request metadata, and
  observed cache timing are recorded.
- [x] Full PR CI and deployed-preview checks are green for the 0A commit.
- [x] Every actionable PR review thread is resolved; the PR currently has no
  review threads or submitted reviews.
- [x] Both 0A harness sessions finish with zero pending incidents and harness
  doctor passes.

## External unfurl evidence

Use a different fresh production share token for each destination. Record:

| Destination | Token evidence | Visual capture | Click-through | Cache timing |
| --- | --- | --- | --- | --- |
| Slack | pending | pending | pending | pending |
| Discord | pending | pending | pending | pending |
| LinkedIn | pending | pending | pending | pending |
| iMessage | pending | pending | pending | pending |

Third-party refresh time is reported as an observation, never a deterministic
assertion. Do not reuse a previously cached token to claim a new deployment
works.

## Rollback

1. Set backend `share_preview_disabled=true` or SWA
   `SHARE_PREVIEW_DISABLED=1`. Crawlers receive generic metadata; human public
   shares remain live.
2. If credential drift is the cause, restore the last current key as backend
   current/previous and SWA current, then run a signed probe.
3. If code is the cause, use the immutable 0P release rollback. Never point the
   adapter back at `/api/shares/:token`.

## Claims deliberately not made

- No real-user growth, conversion, or K-factor result exists yet.
- PR-preview metadata against the older production backend is not same-commit
  full-stack proof.
- Real social destination proof remains pending until the production route and
  credential are live.
- Cinematic duration remains paused.
