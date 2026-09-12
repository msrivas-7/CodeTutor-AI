# Public theme continuity

**September 8: design approved; CI test maintenance/capacity verification in progress.**
[PR #51](https://github.com/msrivas-7/CodeTutor-AI/pull/51), branch
`dev/public-theme-continuity`, implementation `ee325f3`, based on homepage release
`690c767`. Not merged or production-deployed.

**31 of 31 findings are locally verified; owner approved the phone experience.** “Local”
never means merged or production-verified. This checklist is the status source;
[the design plan](PUBLIC_BRAND_CONTINUITY_DESIGN.md) records decisions and
[the design system](DESIGN_SYSTEM.md) owns shared tokens/components.

## Approved scope

Continue the homepage's near-black, living code-glyph world across centered auth,
legal/support, comparison, generated discovery, shares, loading and public errors.
One renderer; open composition around protected text; solid forms/code/controls;
aligned navigation. No detached auth sculpture, static replacement theme, broad
opaque slabs, new pause button or mobile motion disable. OS Reduce Motion gets
a static composition; graphics failure must not block tasks.

Mehul approved phone login/signup for extension, the homepage demo materials,
a four-to-five-second share reveal cap, and the phone spacing refinement. Further
material design changes require approval. Auth/access rules, legal meaning,
authored lessons, metadata and signed-in workspaces stay intact. The anonymous
editor remains a workspace, without marketing decoration.

## Current verification

- **UX-225 locally closed:** two CI runs missed the completion dialog's first
  Escape. A regression reproduced the unhandled DOM-commit-boundary event before
  passive effects installed keyboard ownership. The shared modal now establishes
  keyboard, focus and background blocking before paint; focused regression and
  actual-browser completion/recovery checks pass. Fresh final-head review and CI
  remain required. The historical 96-case result below predates this repair.
- **UX-226 locally closed:** direct login, signup, recovery, callback, public
  share and anonymous-lesson entries now paint through the lightweight public
  route tree. The full route tree retains those routes for workspace-originated
  navigation. Real-browser blocking of the full App module still produced a
  working login; pre-app paint, protected redirect, share recovery, anonymous
  handoff, 404, desktop, 390px and reduced-motion checks pass. The complete
  58-case Chromium/WebKit public-theme matrix passes without retries.
- **UX-227/228 locally closed:** final-head review found that a quick homepage
  transition could retain the five-second deferred-auth timer, and that the
  public bootstrap did not mirror React Router's case/trailing-slash matching.
  Auth-dependent navigation now cancels the delay immediately, while a shared
  normalized pathname classifies both exact and prefixed public routes. Actual
  browser homepage → login/trial and direct `/Signup/` checks pass; the focused
  25-case bootstrap contract and frontend typecheck pass.
- **PR gate:** Codex completed `477be0a` with no major issues; CI passed.
  E2E exposed two outdated contracts: the retired seven-DOM-glyph field and a
  share test treating the loading heading as payload readiness. Test-only updates
  inspect the live canvas/still fallback and exact lesson heading; the one-second
  reduced-motion deadline is unchanged. No product code changed in this follow-up.
  Complete affected files pass all 20 maintained Chromium cases; the final two
  changed contracts additionally pass all four Chromium/WebKit cases, zero
  retries, and E2E typecheck passes. Seven additional macOS WebKit workspace
  snapshots have no maintained baseline and are not claimed as passing or added.
  The suite reached 478 tests, crossing the measured 467-test capacity boundary.
  The required run `34686107941` reproduced transient Supabase
  `AuthRetryableFetchError` failures under both ordinary and zero-retry benchmark
  load. The Node-only provisioning fixture now uses a bounded equal-jitter retry
  only for that SDK-classified retryable error; three contract tests, E2E
  typecheck, nine implicated Chromium cases and the implicated WebKit journey pass
  with Playwright retries disabled. Rebenchmark the final 481-test head at 16/20
  shards before updating the capacity record; no test removal or threshold-only
  bypass. Final-head review/CI remain required.
  The benchmark now freezes one inventory/history and uses normal CI's duration
  planner for both candidates, replacing its outdated test-count partitioning.
  Local planner checks cover all 476 tests exactly once at either count; measured
  GitHub timings are still pending, not inferred from those predictions.
- **Hosted preview:** actual browser catalog → Python Intermediate → Mini ORM
  capstone, narrow-screen lists/code and invalid discovery → catalog recovery
  pass. Invalid paths return HTTP 404. This is preview evidence, not production.
- **Latest product source:** 658 frontend tests, production build/typecheck and
  unchanged asset budgets pass. **34 marketing + 62 public-theme/share-reveal
  checks pass in Chromium/WebKit, zero retries.** These supplement real browsing.
  The combined 96-case run passed again after unlock (2.0 minutes), along with
  all 632 tests, the production build and asset budgets.
  September 8 source snapshot: 44 changed/untracked frontend and E2E files;
  SHA-256 `2e8c21a6458aa40316121c86fd9642d4ae9a7a6a49eae8e8af3c4aab1f7a745a`
  over sorted path-NUL/content-NUL pairs. This identifies the reviewed local
  source, not a commit or the harness's final staged fingerprint.
- **Actual desktop journey:** homepage → Privacy → Terms → Support → comparison
  → catalog/course → Mini ORM capstone → Hello World trial → Back. Reading,
  focus, scroll restoration and public/workspace theme separation checked.
- **Actual phone-width journey:** auth modes/recovery/callback, legal reading,
  support keyboard focus, comparison → trial → Back, catalog, valid/invalid share,
  blocked lookup → keyboard Retry → recovered share. Dense paragraphs, lists,
  code and controls inspected while the glyph field moved.
- **Cold paint/history:** held app JavaScript leaves a near-black login; reload
  recovers. Fresh auth/legal Back/Forward and static discovery/home/trial returns
  retain theme tokens. A documented dev account successfully signed in; saved
  Light survives public Privacy → Start → reload, without changing preferences
  or progress. One earlier anomalous history entry remains unexplained (UX-199).
- **Motion/resilience:** actual short/fast/reversed scrolling, Read/Ask/Check,
  keyboard artwork input, live Reduce Motion changes and blocked-renderer recovery
  checked. Scoped checks also cover 320px, tablet, 4K, no-JavaScript discovery,
  route-loading focus and long-share reveal.
- **Scope preservation:** legal text/section-title AST comparison against base
  passes. No backend, migration, authored-course or auth-handler changes.
  Final boundary review additionally confirms entry-document metadata is unchanged
  and login/reset/signup function bodies differ only in CSS classes (AST-backed
  comparison recorded in the parent harness). Shared route/loading/world code
  was inspected separately; this is not a production-hosting claim.
  Static production hosting still requires deployed verification.
- **Resumed final browser pass:** access returned after manual unlock. Signup's
  Privacy link opens a readable separate tab and leaves signup intact; the test
  tab was closed. Held-script signup first paint stays near-black. Fresh
  Back/Forward retains tokens/bootstrap and restores a measured Privacy reading
  position of 863px. Phone Terms remains readable during motion and live Reduce
  Motion; Support keyboard focus and blocked graphics → usable homepage Ask →
  Reload recovery pass. Viewport/network/media overrides were restored.

No email or personal messaging app was opened. Browser wheel/viewport emulation
does not prove physical iPhone swipe momentum, virtual keyboard or feel.

## Finding checklist

Checked means the bounded finding has local browser evidence, not whole-release acceptance.

| Status | Finding | Change / remaining work |
| --- | --- | --- |
| [x] Local | UX-198 | Center auth; remove purposeless split-layout sculpture. |
| [x] Local | UX-199 | Initial document/loading/settled colors aligned. Fresh cold loads, saved-Light and resumed Back/Forward journeys pass. The earlier missing-token/bootstrap history anomaly has not reproduced on the final source; retain it as an unexplained historical observation, not a claimed root-cause fix or browser defect. Recheck deployed cold load/history. |
| [x] Local | UX-200 | Main-content focus appears on the heading, unobscured by child surfaces. |
| [x] Local | UX-201 | Repair trust dividers and protect contact-link readability. |
| [x] Local | UX-202 | New public navigation starts at destination top; explicit anchors and Back retain their own behavior. |
| [x] Local | UX-203 | Router selects trust content; `/privacy/` no longer becomes Support. |
| [x] Local | UX-204 | Malformed shares show unavailable; actual lookup failures retain working Retry. |
| [x] Local | UX-205 | Themed static discovery 404 with real error status and no-JavaScript recovery; production host unverified. |
| [x] Local | UX-206 | Living world, readable materials and persistent SPA renderer implemented. Connected desktop/phone family reading/navigation, auth and share recovery, workspace isolation, and resumed graphics interruption/recovery pass. Final harness phase/production gates remain separate. |
| [x] Local | UX-207 | Disabled auth controls use opaque state colors instead of letting glyphs bleed through opacity. |
| [x] Local | UX-208 | Bound auth foreground at 4K; preserve full-screen ambient density. |
| [x] Local | UX-209 | Restore homepage graphics-download notice and Reload recovery after renderer extraction. |
| [x] Local | UX-210 | Align header/wordmark/action geometry; auth heading no longer recenters with form height. |
| [x] Local | UX-211 | Live Reduce Motion settles share code/count/timeline without replaying on restoration. |
| [x] Local | UX-212 | Open homepage explanation area; keep demo functional surfaces solid. Owner approved. |
| [x] Local | UX-213 | Support action retains readable normal/hover/focus colors; no mail app used. |
| [x] Local | UX-214 | Lazy public loading retains escape navigation and focus through nested fallbacks. |
| [x] Local | UX-215 | Long lesson inline code wraps without phone-wide document overflow. |
| [x] Local | UX-216 | Omit empty concept panels; retain populated ones. |
| [x] Local | UX-217 | Mixed text/code objective chips wrap as one text flow. |
| [x] Local | UX-218 | Direct `/#study-demo` arrives after lazy loading; user interruption cancels pending handoff. |
| [x] Local | UX-219 | Homepage loading handoff retains skip/home/main focus without unwanted page movement. |
| [x] Local | UX-220 | Mobile homepage typography agrees across direct entry, auth return, reload and Back. |
| [x] Local | UX-221 | Public share comments use readable faint-text role (at least 4.5:1); image-export palette unchanged. |
| [x] Local | UX-222 | Auth supporting copy shares 14px/21px recipe; workspace signup unchanged. Intercepted recovery responses prove presentation, not delivery. |
| [x] Local | UX-223 | Long reveal ends within five seconds of typing start and reserves line/footer space; short cadence retained. Network loading/later celebration excluded. |
| [x] Local + owner | UX-224 | More phone formation space: hero departure interval at 390×844 increases from about 1px to 351px. Local adversarial scroll/recovery checks pass; after restored phone access Mehul confirmed it works and approved the experience. |
| [x] Closed | UX-225 | Completion dialog now owns Escape at first mount and closes safely before checkout gates; the browser evidence now confirms the first-commit close path, with modal-level regression checked and happy-path recovery preserved. |
| [x] Closed | UX-226 | Direct auth, recovery, callback, share and anonymous-lesson entries use the lightweight public bootstrap while retaining the same routes in the full app for later SPA navigation. Rebuilt real-browser and retry-disabled Chromium/WebKit proof pass. |
| [x] Closed | UX-227 | Auth-dependent navigation from a deferred public page cancels the five-second hydration delay immediately; homepage → login/trial are ready without the stale waiting state. |
| [x] Closed | UX-228 | Public bootstrap classification now matches React Router for case and trailing slashes across exact, share and anonymous-lesson routes. |

## Evidence map

Screenshots and detailed chronological audits are machine-local, not included in
a fresh clone. Root: `.agent-harness/browser-evidence/`.

| Session directory | Evidence |
| --- | --- |
| `5c7d75ed-22d3-41db-bfc3-857daf5b8b6f/` | Parent audits; `UX199-*`, `UX204-*`, `UX205-*`, `UX206-final-*`, `UX210-final-*`, `UX212-*`, `UX214-final-*`, `UX215-*`–`UX219-*`. |
| Same parent, `connected-*.png` | Final desktop family/long-lesson journey and auth recovery. |
| Same parent, `dev-account-*.png` | Dev-account sign-in and saved-Light/public-dark/workspace-Light boundaries. |
| Same parent, `final-*.png` | Latest cold login, phone legal/support/comparison/trial, share failure/retry, callback/reset and static-history checks. |
| Same parent, `resumed-*.png` | Post-unlock signup privacy-tab, held-script first paint, history/863px reading restoration, phone Terms/preferences/Support focus and graphics recovery. |
| Parent finding audits | UX-199: `79a1d45e-a40e-458c-a867-cb5f07479852`; UX-206: `2a8377ee-db89-4806-9a3f-bb86f86c3ecf`. |
| Final local phase | `b293581c-f3e4-4a7f-a724-50f5daf20165`; staging-only fingerprint refresh `459bb440-e310-4631-8bea-f4d73cd38a85`. Parent harness finished and pre-commit live-browser gate passed. |
| `693b16bc-7909-40fc-b51d-b531f67fe84d/` | UX-213 action states. |
| `e2880cbd-d263-4e58-abb7-5cf88b8809d6/` | UX-220–222 typography/contrast/supporting-copy repairs. |
| `dd56a6ef-9a6c-4f6c-b414-2092b1522ef6/` | UX-223 reveal/interruption/recovery. Failed audit retained, incident resolved; passing audit `b56570ef-8eeb-48e6-9d83-d9b79bc31021`. |
| `e61236d8-3b68-4c1c-84a7-f704c6045827/` | UX-224 formation/dwell, reversal, keyboard, preferences and graphics recovery. Finding audit `cc2ea60a-4a6a-4502-ae3e-4b3de4e43d7a`. |
| `b3564266-122c-439e-92c9-2dd55e3c4e3e/` | Independent design review of 27 primary-agent captures and source; reviewers did not run separate browser sessions. |
| `825e4a74-2653-4b04-ae59-269a8bc6f90f/` | Final-head UX-225/226 browser replay: direct auth without App, pre-app paint, protected redirect, phone/reduced-motion recovery, share-to-anonymous handoff, completion Escape and focus restoration. |
| `a6c213ed-476c-4201-a428-ebe6b7ea02d4/` | UX-227/228 review follow-up: immediate homepage-to-auth/product hydration and normalized direct public entry. |

Historical prototype captures do not establish acceptance of later edits.
Named final checks supersede them only for their stated scope. The anomalous
history capture is `UX199-restored-document-missing-theme.png`; do not discard it.
UX-220–224 finding evidence is also indexed in the parent harness session, with
original audit IDs, timestamps and fingerprints preserved in its notes. This is
evidence consolidation, not a new browser execution or physical-phone acceptance.

## Design review disposition

Product/brand, motion/UX and design-system reviewers agreed on one recognizable
family; keep the direction. Confirmed typography, share contrast and auth hierarchy
inconsistencies became UX-220–222. Heavy-text browsing found no through-letter
glyph collision; protect reading locally rather than broadly dimming the world.

Optional, **not approved for this phase**: shorten desktop hero to expose CTA
earlier; link Lessons to the course anchor; reconcile method/demo wording; soften
comparison copy; quiet peripheral glow. Transparent pager/secondary-control
consistency merits inspection, not redesign based on an assumed defect.

## Remaining release gates

- [x] After manual unlock, inspect signup's new privacy tab, restore viewport and
  finish the connected browser pass and UX-199/206 disposition. Retain relevant
  keyboard, loading/error/recovery, moving readability, responsive, preference
  and adjacent-workspace coverage.
- [x] Get physical-phone feedback for UX-224 through the registered local preview.
  The temporary gateway stopped while localhost remained healthy. It has been
  replaced with the owner-requested persistent, reserved-phone project gateway;
  automatic process restart, allowed/denied peers, registration/removal and local
  browser rendering pass. The service remains running on recheck. See
  [local phone access](DEVELOPMENT.md#local-phone-access). This is not a production
  deployment. Mehul subsequently confirmed: “Yeah it worked and I like it approved
  from me.” This closes owner phone acceptance, not production verification.
- [x] Retain the approved [D1 motion policy](PUBLIC_BRAND_CONTINUITY_DESIGN.md#review-decisions-and-open-questions):
  current design approved after the pending decisions were surfaced; OS Reduce
  Motion works and no pause button is added. Accessibility conformance remains
  unproven and must not be advertised as established by product approval.
- [x] Record final finding/whole-phase evidence; inspect the full diff, stage only
  this phase, run final deterministic checks, doctor and harness finish on the
  exact intended phase. Any subsequent product-source change invalidates the
  affected evidence and requires revalidation.
- [x] Publish separate PR with before→after journey notes: PR #51.
- [ ] Require **green CI AND
  clean Codex review** on final head: reviewer has completed its review with no
  outstanding actionable findings, not merely no pending comment request.
  Answer/resolve actionable threads and obtain a fresh review after fixes.
- [ ] Merge after those gates, verify deployment SHA and changed/adjacent
  production browser journeys, then complete the goal.

PR journey notes: independent page themes → shared living brand; old scroll
retained → new destination at top; stalled loading without escape → retained
navigation/focus; direct walkthrough at top → correct delayed anchor; malformed
share “connection failure” → unavailable; long reveal hides lines/moves footer →
capped stable reveal; phone shapes rush away → longer native formation space.
Direct logged-out entries waited on the authenticated application route tree →
auth, recovery, callback, share and anonymous-lesson entries load through the
lightweight public route tree while protected-entry navigation remains intact.
Auth/access rules are unchanged.

Separate follow-up approved: automatically choose the shard count from trusted
runtime history, measured setup cost and safe concurrency bounds. Preserve the
full suite, stable fallback and a minimum meaningful gain; validate predictions
against real runs before enabling. This is not part of PR #51.
