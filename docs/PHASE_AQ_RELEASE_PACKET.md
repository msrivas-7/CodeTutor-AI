# Phase A-Q release packet

> **Current decision:** Automated implementation and repository verification are complete. Keep pull request #10 as a draft until the external-evidence items in the release-gate table are recorded.
>
> **Scope rule:** All Phase A-Q product changes remain in one branch and one pull request. Cinematic duration is unchanged.

## Baseline and delivery unit

- Phase A-Q baseline: `dd4bfe45998c114ef808f10ef7f3059b6d1dbe3a` on `main`.
- Delivery branch: `dev/phase-aq-quality-pass`.
- Pull request: [#10 — Phase A-Q: product experience quality gate](https://github.com/msrivas-7/CodeTutor-AI/pull/10).
- Review range: `dd4bfe4..dev/phase-aq-quality-pass`.
- Database migrations: none in Phase A-Q.
- Existing operational controls remain in place, including the anonymous-lesson and share create/render/public kill switches.
- Backend deployment keeps the existing health-checked rollback path in `.github/workflows/deploy.yml`.

## What changed

- Repaired the marketing → anonymous lesson → output → retrieval → completion → share → signup/handoff journey.
- Consolidated dialog semantics, focus entry/trapping/restoration, top-layer stacking, background inertness, and route-transition cleanup in the shared modal primitive.
- Removed stacked first-run coaching and narration-gated learner actions.
- Corrected Markdown rendering, retrieval-pending feedback, attempt/mastery credibility, public share metadata, trust destinations, and immediate share-page comprehension.
- Enforced responsive hierarchy, touch targets, light/reduced-motion behavior, zoom resilience, and public-entry performance budgets.
- Added Chromium visual coverage and focused Firefox/WebKit critical-journey coverage.
- Added a scheduled production synthetic with an actionable issue owner.
- Added a resource-scoped CORS/CSRF origin policy so deployed SWA pull-request previews can exercise the real anonymous journey without trusting other Azure Static Web Apps tenants.

## Release-gate evidence

| Gate | Current status | Evidence / remaining proof |
|---|---|---|
| G0 — Handoff integrity | **Pass — repository** | Named baseline above; clean branch ancestry; no migrations; existing flags and rollback path identified. The Phase A roadmap/audit packet remains under the intentionally ignored `.claude` workspace. |
| G1 — Promise integrity | **Pass** | `firstJourneyContract.test.ts`, `experienceStyleContract.test.ts`, Markdown parser tests, golden-solution verification, and manual desktop/phone browser audit. |
| G2 — Responsive integrity | **Automated pass; physical-device proof pending** | `phase-aq-visual-quality.spec.ts` covers 360×800, 390×844, phone landscape, tablet portrait/landscape, 1024×768, 1440×900, 200% zoom, and software-keyboard height. Physical iOS and Android runs still need recording. |
| G3 — Accessibility | **Automated/manual browser pass; physical mobile pending** | Axe has zero serious/critical findings on the critical surfaces; keyboard/focus, reduced motion, light theme, zoom, and touch-target tests pass. Physical mobile assistive/keyboard checks remain part of G2. |
| G4 — Interaction consistency | **Pass** | Shared `Modal` contract plus settings, completion/share stacking, Escape, focus trap, focus restoration, route-transition inert cleanup, and dialog regressions. |
| G5 — Journey continuity | **Automated/local browser pass; deployed-preview promotion check pending** | Full Chromium E2E and focused WebKit/Firefox gates cover public discovery through signup; anon handoff tests cover lesson-2 continuation and failure recovery. The final deployed-preview audit found that the production backend's single canonical CORS origin blocked the preview's automatic first run. The branch now contains a resource-scoped CORS/CSRF policy, but the live journey can only be reconfirmed after the backend promotion from `main`. |
| G6 — Distribution artifact | **Live crawler-transport pass; real-destination visual proof pending** | The SWA crawler function, server lookup, canonical metadata, privacy defaults, image rendering, mobile share page, and revoke/not-found tests pass. A synthetic completion was created against the deployed service on 2026-07-30 and the PR preview returned `200` plus the correct public canonical/OG URL, personalized title/description, `summary_large_image`, and rendered OG image to generic, Slack, Discord, LinkedIn, and iMessage-style crawler user agents. Record visual unfurls inside the real destination apps before exit. |
| G7 — Human comprehension | **Pending external sessions** | Run five unfamiliar phone-first sessions and three laptop-continuation sessions using the pre-registered observation sheet. No production cohort is required, but these cannot be replaced by automated tests. |
| G8 — Performance | **Pass — pre-traffic lab** | Repeated Lighthouse lab runs passed for `/` and `/why-not-chatgpt`; deterministic production asset budgets pass with Monaco/editor excluded from the public entry. Field p75 remains a post-traffic measurement. |
| G9 — Regression protection | **Pass** | Frontend unit, backend unit/integration, SWA API, content, golden-solution, visual, accessibility, full Chromium E2E, and focused Firefox/WebKit gates are present. |
| G10 — Operations | **Configured; first production run pending** | `.github/workflows/production-synthetic.yml` checks marketing, trial, health, and first output every six hours and opens one owned incident issue on failure. Confirm its first scheduled/manual production run after the workflow reaches `main`. |

## Latest local verification

- Frontend: 38 files, 370 tests passed.
- Frontend production build: passed.
- Backend: 913 tests passed, 16 intentional skips.
- SWA share function: 8 tests passed, including public-host preservation and Host-header-poisoning defenses.
- Production asset budgets: passed (396,209 bytes total shipped JS gzip; 66,000-byte largest JS chunk; 12,461-byte CSS; 1,192-byte HTML; no Monaco/editor preload).
- Full Chromium E2E: 304 passed, 12 intentional skips, zero retries, 18.1 minutes.
- WebKit critical journey: desktop and phone passed locally with zero retries.
- Firefox: the pinned macOS browser process could not establish its Playwright control channel on this host; this is not counted as a local pass. The Linux CI job is the required authoritative Firefox result.
- Manual in-app browser audit: 1440×900 and 390×844 passed with no horizontal overflow or fresh console warnings/errors.
- Final deployed-preview browser audit: landing and cinematic lesson entry rendered correctly at 1440×900, then the automatic anonymous run surfaced `Request failed: Failed to fetch`. A matching preflight probe proved the deployed backend returned `Access-Control-Allow-Origin: https://codetutor.msrivas.com` to the PR-preview origin. The branch fix allows only the canonical frontend and this CodeTutor SWA resource's exact primary/numbered-preview hostname shape; foreign SWA tenants, alternate regions, HTTP, paths, and nonstandard ports remain rejected.

## Live share-unfurl probe

- Environment: pull-request SWA preview backed by the deployed CodeTutor API.
- Synthetic data only: a clearly labeled `Quality Audit` anonymous lesson completion with harmless Python output.
- Crawler profiles: generic HTML, Slack, Discord, LinkedIn, and iMessage-style fetchers.
- Every profile returned `200`, `text/html`, the same public SWA preview canonical and `og:url`, the personalized lesson title/description, `twitter:card=summary_large_image`, and the rendered public OG image.
- The first probe caught an internal `azurewebsites.net` canonical URL caused by the SWA-to-Functions proxy boundary. Commit `05637ac` fixed the resolver to use validated public proxy metadata; the post-deploy probe passed for all profiles.
- This proves the server transport and metadata contract. It does not substitute for visually confirming the rendered card inside each named destination app.

## Visual evidence

Committed screenshot baselines live beside `e2e/specs/phase-aq-visual-quality.spec.ts` for:

- 360×800 phone
- 390×844 phone
- 390×844 light/reduced-motion phone
- phone landscape
- tablet portrait
- 1024×768 tablet landscape
- 1440×900 desktop

## Known exit items and owners

| Item | Owner | Exit evidence |
|---|---|---|
| Physical iPhone and small-Android journey | Founder/operator | Phone and landscape recordings; keyboard/safe-area/rotation/state notes. |
| Five phone-first unfamiliar-participant sessions | Founder/operator | Completed observation sheets and summarized repeated-confusion findings. |
| Three laptop-continuation sessions | Founder/operator | Completed observation sheets and summarized current-task/next-action findings. |
| Real share unfurls | Founder/operator | Captures from every named destination using a production token. |
| First production synthetic run | Repository operator | Successful workflow run URL after merge/deployment. |

## Rollout and rollback

1. Keep #10 draft while external evidence is collected.
2. Resolve any P0/P1 observation in this same branch and repeat the affected browser/device session.
3. Make the PR ready only when applicable G0–G10 rows are green or an explicit founder exception is recorded.
4. Merge once, allowing the existing frontend and backend deployment workflows to promote the coherent change set.
5. Confirm frontend deployment, backend health, the critical-journey synthetic, share crawler output, and error telemetry.
6. If promotion fails, use the existing SWA deployment controls and backend health-checked rollback path; use the anonymous/share kill switches for a targeted incident response.

## Recommendation

**Hold the merge for the named external-evidence items above.** The implementation and automated quality floor are ready; physical-device behavior, unfamiliar-user comprehension, real distribution unfurls, and the first production synthetic run must be recorded honestly rather than inferred from emulation.
