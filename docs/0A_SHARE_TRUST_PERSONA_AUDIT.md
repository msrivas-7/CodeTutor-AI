# Release 0A share-trust persona audit

Date: 2026-07-31

Branch: `dev/contextual-learning-roadmap`

Scope: crawler/human separation, service authentication, cache and failure
behavior, truthful share outcomes, operator controls, and external unfurl
evidence.

## Verdict

**Approve the local 0A implementation for remote release gates.** The original
two P0 defects are closed in code and real-database integration evidence:
crawler reads use a non-counting route and cannot consume public reader
budgets. No local P0/P1 persona finding remains open.

External Slack, Discord, LinkedIn, and iMessage captures remain a named release
gate after the same code and credential are available on a production URL.
This audit does not treat simulated metadata or a PR preview connected to the
older production backend as equivalent to those destination proofs.

This is a structured review through the repository's 18 persona profiles. It
is not evidence from 18 real users or an external penetration test.

## Findings resolved

| Priority | Finding | Resolution |
| --- | --- | --- |
| P0 | Crawler unfurls called the public reader route and incremented `view_count`. | A dedicated internal route returns a strict preview DTO and never calls `bumpShareView`; real Postgres proof holds crawler count at zero and one cold human visit at exactly one. |
| P0 | SWA crawler traffic consumed shared public lookup/hit capacity. | The internal route has a separate per-key budget and the adapter has no public-route fallback. |
| P0 | A generic internal secret could become an enumeration bypass. | Purpose-specific HMAC binds method, path, timestamp, nonce, and key ID; strict projection, freshness, replay rejection, rotation overlap, and fail-closed behavior are executable. |
| P1 | A new endpoint alone would still stampede the backend. | The adapter coalesces requests, bounds its LRU, uses two sub-second reads at most, and opens a short circuit under sustained failure. |
| P1 | Rotation or backend degradation could break unfurls or force counting fallback. | Current/previous keys overlap; every non-404 failure renders safe generic metadata and never calls the public API. |
| P1 | Share creation, copying, native completion, cancellation, and closing were conflated. | `copied`, `share_completed`, `cancelled`, and `dismissed` are separate bounded telemetry outcomes; no token or code is accepted. |
| P1 | The existing public share kill switch had too large a blast radius. | `share_preview_disabled` drains only crawler metadata and is visible in operator controls; SWA has a second adapter-local switch. |

## Persona conclusions

| Lens | Conclusion | Release implication |
| --- | --- | --- |
| Maya | A friend should see a polished card, while Maya's “reader” count should represent people rather than bots. Failures degrade quietly instead of showing a technical error. | Approve; verify phone sharing and iMessage visually. |
| Alex | Accurate counts and predictable link behavior are basic product credibility. The implementation is invisible and does not slow the editor. | Approve; retain fast human reader behavior. |
| Pedagogy | Share trust does not teach directly, but a credible artifact reinforces competence without changing lesson scaffolding. | Approve as prerequisite trust work, not a learning-outcome claim. |
| Product owner | “Share what I built” becomes a truthful product promise rather than a crawler-inflated vanity surface. | Approve; generic degradation must remain on-brand. |
| Staff PM | The falsifiable exit is exact: crawler zero, cold human one, isolated capacity, safe failure/rotation. | Approve the bounded slice; do not add a general auth platform. |
| Staff UX | No new learner step is added. Outcomes now distinguish copy, successful native share, native cancellation, and dialog dismissal. | Approve after keyboard, phone, and share-sheet browser checks. |
| Fresh eyes | “Readers” now means readers, and a social bot cannot make the next person see a throttled page. | Approve; keep technical degradation invisible. |
| Hollywood director | The social card remains the trailer for the learner's win; generic fallback preserves the tone rather than cutting to an error page. | Approve; real destination crops are still required. |
| AI/LLM quality | No model behavior or prompt surface changes. | No AI gate is required for 0A. |
| Staff security | HMAC purpose binding, constant-time comparison, 30-second freshness, replay cache, two-key rotation, strict DTO, anti-enumeration, and secret hygiene meet the stated threat model. | Approve the single-replica contract; shared nonce storage is mandatory before horizontal scale. |
| Staff QA | Missing/malformed/stale/bad/replayed/old/current auth, revoked/missing tokens, budget pressure, cache expiry, coalescing, timeout, 401/429/5xx, invalid DTO, and no-fallback paths have deterministic coverage. | Approve after full suites and remote gates. |
| Staff SRE | Separate budget, 800 ms timeouts, bounded retry/cache, circuit breaker, metrics, dual kill switches, and rotation runbook keep blast radius small. | Approve after burst, kill-switch, and rotation drills. |
| Staff SWE | Two narrow modules avoid modifying public reader semantics or creating a service-auth framework. A shared cross-runtime vector prevents signer/verifier drift. | Approve; keep the contract single-purpose. |
| Finance | Preview reads add no AI cost and bounded database load; caching reduces repeat crawler traffic. | Approve; monitor unique-token bursts rather than assuming cache eliminates abuse. |
| Business leader | Trustworthy share artifacts support distribution, but mechanics alone are not a moat. | Ship as infrastructure for the product loop, not as a category claim. |
| Competitive intelligence | Good unfurls are table stakes across modern learning products. Accurate human engagement can become useful only when paired with a differentiated learning experience. | Approve; do not over-market the fix. |
| Contrarian | There are no real users yet, so this could look like premature infrastructure. The rebuttal is that the existing implementation actively corrupted counts and coupled capacity; the fix is narrow and required before any distribution experiment is interpretable. | Keep scope at the one endpoint and four outcomes. |
| Growth marketing | The OG card is the acquisition surface. Correct counts, isolated uptime, and explicit completed-vs-cancelled outcomes make later K-factor measurements interpretable. | Real Slack, Discord, LinkedIn, and iMessage captures remain blocking evidence. |

## Required remaining evidence

The full local frontend/backend/SWA/security/E2E gates, measured burst and
cache/coalescing proof, and current/previous rotation plus kill-switch drills
are complete. Remaining release evidence is:

- PR CI, deployed preview, and thread-aware review audit;
- timestamped real-destination captures with fresh production tokens for
  Slack, Discord, LinkedIn, and iMessage, including click-through and cache
  timing notes.

## Claims deliberately not made

- The change does not prove a viral loop, conversion improvement, or demand.
- A successful metadata parser test is not a real social-destination unfurl.
- The in-process replay cache is not safe for multiple active backend replicas.
- Generic metadata during degradation does not prove the underlying artifact
  exists; it intentionally avoids leaking that distinction.
- Cinematic duration remains paused.
