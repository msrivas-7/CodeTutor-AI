# Contextual Learning and Delivery Velocity Plan

> **Status:** Engineering implementation is green through 0A/B5 on the active roadmap branch; the 1D shadow clock begins only after merge; the 1C entry gate is not met because the powered 1B learner experiment, two-human eval calibration, and named approvals are missing
>
> **Prepared:** 2026-07-30
>
> **Baseline:** deployed `main` at `073c5cf` (`Phase A-Q: product experience quality gate (#10)`)
>
> **Audit:** 18 independent role-based repository reviews; 17 approve with required changes, 1 reject/reframe, 0 unconditional approvals
>
> **Scope:** a bounded Phase B workstream covering trust/correctness, contextual assistance, tutor safety, UI/UX follow-through, and delivery velocity

## 1. Executive decision

Proceed with the direction, but do **not** implement the original architecture-first plan.

The product already sends substantial lesson, file, run, diff, selection, and progress context to the tutor. The demonstrated failures are not “the tutor knows nothing.” They are failures of currency, authority, ownership, and presentation:

- a current syntax error can coexist with historical completion praise;
- a selection can describe an older code revision;
- a late Run or tutor stream can land after the learner changed context;
- separate attention systems can instruct the learner at the same time;
- phone guidance can exist in the DOM while being off-screen at the point of action.

The revised plan therefore uses the smallest trustworthy seam:

1. Preserve authoritative data in existing stores.
2. Add revision and asynchronous-operation identity.
3. Derive a pure `AssistanceContextV0` at decision/ask time.
4. Keep only episode/dismissal as new session state; no clock-based cooldown.
5. Prove one visible repeated-error journey before generalizing.
6. Allow a contextual tutor offer only after the learner explicitly asks and all AI-quality/security gates pass.

At the same time, correctness, AI safety, distribution, and CI acceleration proceed as separate, independently releasable lanes.

### 1.1 The product distinction

Contextual and Socratic assistance are now competitive parity. They are necessary for trust, but they are not sufficient differentiation.

CodeTutor's wedge is the enforced learning loop:

> learner effort → real execution → course-owned evidence → retrieval → later independent competence

The eventual defensible proof remains the locked Phase C no-AI capstone and public competence evidence. This work must compound toward that proof without claiming the context engine itself is the moat.

### 1.2 Test-suite verdict

- 316 Playwright tests is not inherently excessive for an interactive editor/tutor.
- Running almost all expensive browser behaviors on every relevant pull request is no longer the best ownership model.
- The existing full PR gate stays in place until a smaller gate proves **catch quality**, not merely speed.
- Coverage moves down a layer only after replacement coverage runs beside the old test.
- Test isolation and release promotion must be fixed before CI is made less exhaustive.

### 1.3 Locked decision preserved

This plan makes no change to cinematic duration. That decision remains paused.

## 2. Audit authority and evidence status

The full audit, validated findings, disagreements, and 18 persona reports are recorded in:

- `.claude/audits/2026-07-30-contextual-learning-delivery-plan/synthesis.md`
- `.claude/audits/2026-07-30-contextual-learning-delivery-plan/personas/`

The persona audit is structured expert scrutiny performed against 18 role profiles. “Independent” means each review was produced before synthesis; it does not mean 18 real people or 18 product experiments. Automated tests, persona reviews, browser audits, dogfooding, and scenario evaluation can establish implementation correctness and pre-launch confidence. They cannot establish demand, learning improvement, retention, or differentiation with real learners.

### 2.1 Phase A status correction

- **Phase A implementation:** merged and deployed, with newly discovered conformance debt.
- **Phase A roadmap validation:** incomplete.

| Locked Phase A evidence | Current status |
|---|---|
| Q1: phone completion within 2pp of desktop | Pending qualifying real traffic |
| Q2: lesson-2 learners pass cold lesson-3 retrieval ≥80% | Pending; the immediate recognition checkpoint is not cold retrieval evidence |
| Q3: share views/completion ≥0.3 | Pending real traffic; share correctness and attribution must first be fixed |
| Q4: operational floor | Partial; controls exist, but atomic AI admission and the required drill remain open |
| Q5: five-stranger session | Missing |

Engineering may continue behind reversible flags while traffic-dependent evidence remains pending. The five-stranger session must occur before broad learner-visible contextual guidance/tutor rollout unless the founder records a dated exception.

## 3. Locked-roadmap contract

This document is an enabling workstream, not the Phase B master roadmap.

| Phase B bucket | Relationship to this plan |
|---|---|
| **B1 Memory read-side** | Direct locked workstream. `AssistanceContextV0` may provide a read seam but cannot delay B1. Current ledger rows are exposure history, not mastery proof. |
| **B2 Socratic default** | Direct locked workstream and entry gate for contextual tutor offers: turn one is a clarifying question only, turn two may give an approach, and the complete answer is never supplied. Applies to scripted and model-generated assistance. |
| **B3 Model upgrade** | Independent AI-quality lane after eval-quality and economics gates pass. |
| **B4 Distribution** | Immediate parallel lane after share correctness. Never blocked by context work. |
| **B5 Continuation card** | Independent parallel UX lane. False dismissal/modal chaining is correctness work; the full restage remains B5. |
| **B6 Paid relationship surface** | Dormant until seven-day-average DAU ≥100. Readiness may be instrumented; the surface cannot ship early. |
| **B7 Syntax check** | Independent quality lane. Treat the current detector as suspect-symbol telemetry until calibrated. |
| **B8 Eval sampling** | Independent governed-data lane after redaction, retention, deletion, access, and holdout controls exist. |

Completing this plan does not close Phase B. The locked real-user exit criteria remain authoritative.

### 3.1 Founder reapproval is required to

- declare Phase A validated without its locked evidence or waive the stranger gate;
- broaden B2 turn one beyond the locked rule;
- permit any complete-answer unlock after repeated struggle;
- delay, remove, or replace B4/B5 with this workstream;
- ship or change B6 before its trigger;
- move the no-AI capstone or institutional pilot before Phase C;
- change the brand position, cinematic duration, phone lesson scope, or celebration decision;
- begin paid acquisition before its locked condition;
- revive rejected invite mechanics or pull vertical MP4 export forward.

### 3.2 Authoritative execution map

Release IDs name dependency lanes, not a calendar sequence. The P0 list expresses severity, not start order. This table is the authoritative execution order.

| Order | Gate/release | Accountable role | Prerequisite | What it unlocks |
|---:|---|---|---|---|
| 1 | **0P Promotion safety** | Staff SRE | Founder acknowledgement; named human DRI | Later production changes promote tested frontend/backend artifacts rather than racing main E2E |
| 2 | **0B Test isolation** | Staff QA | 0P may run in parallel, but must finish before CI conclusions | Trustworthy persistence diagnosis and CI shadow evidence |
| 2 | **0C Contract repair** | Product owner | None; exact-answer removal lands first | A product whose visible promises and destinations agree |
| 2 | **0D AI trust** | Staff security | None; atomic admission and eval repair land before new AI behavior | Server-authoritative, evaluated, bounded tutor work |
| 2 | **1A Correctness primitives** | Staff SWE | None; no assistance abstraction yet | Stale Run/Check/tutor results cannot become current |
| 2 | **0A Share trust** | Staff SWE | Narrow security ADR approved | Safe public sharing and the start of B4 distribution |
| 3 | **1B Thin deterministic proof** | Staff UX | 0P, 0C, 1A; internal flag; five-session protocol before external exposure | Evidence that the smallest contextual cue is understandable |
| 3 | **B4 Distribution** | Growth marketing | 0A | Crawlable public acquisition surface |
| 3 | **1D CI shadow pilot** | Staff QA | 0P and 0B | Evidence for or against later PR-suite demotion |
| 4 | **1C Contextual tutor offer** | AI/LLM quality | 0D, 1B, locked B2, security/cost approval | Explicit-consent contextual AI assistance |

The accountable role must name one human DRI, one approver, and an evidence location before its lane starts. Complexity bands are not commitments and assume no staffing level. If capacity is constrained, execute rows in order and complete 0P, 0B, the exact-answer part of 0C, atomic admission/eval repair in 0D, and 1A before feature work. No validated P0 may remain open when 1B is exposed outside controlled research or when 1C is enabled.

0B/0C/0D/1A may be developed and reviewed while 0P is in flight, but none of their resulting production artifacts may deploy before 0P passes. The only exception is a named emergency change with written founder/SRE risk acceptance, manual evidence for the exact artifacts, a rollback owner, and an expiry.

Default first remediation cycle: 0P, 0B, the exact-answer repair from 0C, atomic admission/eval repair from 0D, and 1A. Releases 1B, 1C, 1D, and B4 are explicitly not started in that cycle unless separate named capacity is assigned without displacing those gates.

### 3.3 Rollout boundaries

| Boundary | Meaning | Allowed before five-session gate? |
|---|---|---|
| Build/test | Local, automated, or synthetic validation | Yes |
| Internal dogfood | Staff accounts behind a default-off switch | Yes |
| Moderated research | Five recruited non-team participants using a controlled script | This is the gate itself |
| Limited learner rollout | Explicitly bounded external cohort with rollback and approved measurement | No, unless a dated founder exception names the risk and expiry |
| Broad rollout | Default-on for eligible learners | No; requires limited-rollout evidence and all product gates |

Founder acknowledgement records: approval to begin remediation, named human owners, accepted concurrency, the temporary disposition of the currently enabled platform-funded tutor while 0D is built, any stranger-gate exception, and any change to the provisional economics thresholds. The preview-authentication ADR and test-confidence method are engineering approvals, not founder product choices.

## 4. Confirmed repository debt before feature expansion

### P0 — test isolation

The configured global teardown deletes every `e2e-w*` test user rather than only the current run suffix. All Chromium shards and Firefox/WebKit jobs share one Supabase project. One completed job can therefore delete identities another job is still using.

This contaminates the cross-device preference failure. Fix teardown isolation before deciding that product persistence is broken.

### P0 — complete-answer leakage

The first-run stronger hint explicitly gives the full working line after two wrong attempts. That violates the public and locked “complete answer never” contract.

### P0 — tutor eval gate is not authoritative

The current eval substrate has these confirmed gaps:

- no committed posture baseline, so the Socratic gate is skipped;
- normal CI does not invoke `eval:tutor`;
- errored prompts leave the scoring denominator;
- limited gate runs can compare a partial sample with the full baseline;
- cases are single-turn and omit run, diff, selection, history, activity, and stale-context behavior.

### P0 — AI quota checking is non-atomic

Current quota checks release their advisory lock before provider usage and the ledger insert. Concurrent requests can observe the same remaining quota. Caps and kill switches limit total damage but do not make admission atomic.

### P0 — asynchronous results can become current in the wrong context

Run and tutor request lifecycles lack sufficient lesson/revision/operation guards. A late result can land after edit, reset, navigation, or lesson/practice switch.

### P0 — deployment can outrun main E2E

Frontend deployment, backend deployment, CI, and E2E are independent `push: main` workflows. A production workflow can finish before the main E2E result for the same commit.

### P1 — authenticated pedagogic context is browser-authored

The authenticated tutor accepts lesson title, objectives, concept tags, completion rules, and progress from the browser and inserts them into the trusted prompt section. The anonymous route already uses a safer server-pinned model.

### P1 — guided tutor ignores authenticated proficiency

The guided tutor hardcodes `persona: "beginner"` even though beginner/intermediate/advanced is persisted and the general editor tutor honors it.

### P1 — conversion dialogs do not distinguish intent cleanly

Anonymous share-modal dismissal schedules the signup wall even when the learner merely closes the dialog. Phone “Maybe later” can lead directly into another conversion surface. Labels and destinations must agree.

## 5. Product and experience contracts

### 5.1 Signature assistance invariant

Every intervention must:

1. use current evidence;
2. name the evidence in beginner-appropriate language;
3. ask for a learner action;
4. withhold the completed solution;
5. leave the learner clearer about what to inspect next;
6. stop when the evidence materially changes.

### 5.2 Assistance ladder

Use the cheapest useful response:

1. do nothing;
2. quiet evidence/result bridge;
3. anchored point-of-action cue;
4. lesson-authored observation, prediction, retrieval, explanation, or edit-run move;
5. deterministic scaffold;
6. explicit “Help me spot it” tutor offer;
7. stronger Socratic scaffold after additional learner effort—never a completed answer.

One accepted tutor-offer click is consent. Do not add a second confirmation dialog. Hover, focus, idle, scroll, or passive cue display is not consent.

### 5.3 Pedagogical intervention contract

Each guide decision specifies:

- `learningMove`: `observe | predict | retrieve | explain | edit-run`;
- target concept tags;
- evidence that made the move appropriate;
- maximum scaffold level;
- productive learner response;
- evidence change that ends the episode.

The policy selects from lesson-reviewed moves; it does not generate arbitrary instructional text.

### 5.4 One primary attention owner

The attention contract includes:

- authored instructions and goal chips;
- starter-file comments;
- first-run narration;
- coach/result bridge;
- error CTA;
- tutor offer and tutor stream;
- retrieval/completion surfaces.

Only one may issue the changing “do this now” instruction. Other surfaces may remain reference material but cannot contradict it.

### 5.5 First-session interaction contracts

Two state-by-state scripts are release artifacts:

**Maya — anonymous, 390×844**

enter → first edit → Run → result/error → Check → retrieval → completion → share/handoff

**Alex — authenticated, desktop**

enter/resume → inspect task → edit/run/check → dismiss optional help → deliberately ask tutor

For each state record:

- primary surface and exact placement;
- visible evidence and next-action label;
- whether scrolling occurs;
- dismissal scope;
- screen-reader announcement behavior;
- tutor-unavailable fallback;
- beginner/intermediate/advanced wording.

### 5.6 Five-session usability-falsification protocol

Recruit five people who did not build the product, match the lesson-one novice audience, and have not seen the intervention. Use fresh accounts/sessions and the same desktop/390px task script. The moderator may clarify the task but cannot point to controls or explain the cue.

Record, with consent:

- whether the learner notices the current Run/Check result and next action without prompting;
- whether they interpret the evidence-specific question correctly;
- whether their next edit/run addresses the evidence;
- whether the cue, editor target, keyboard, and action bar are usable together;
- whether any surface contradicts, traps, shames, or supplies the answer;
- what the learner says they learned after the episode.

This is a falsification gate, not proof of learning efficacy. One safety/trust failure, any complete-answer leak, or two of five learners unable to locate and act on the cue blocks external rollout and returns 1B to design. Passing allows a limited measured rollout; it does not validate retention or differentiation.

### 5.7 Phone result bridge

After Run, show one compact state immediately above the fixed action bar, for example:

- “Ran successfully · View output”
- “Syntax error on line 1 · View error”
- “Ready to check · Check My Work”

The cue and its target must be simultaneously within the viewport. Do not move the page unexpectedly or steal editor focus.

### 5.8 Visual and voice direction

The visual goal remains **warm technical confidence**.

Keep code/output as the hero, selective depth/glow, expressive typography, earned celebration, and the current token system. Use semantic icons and comfortable controls. Reject constant shimmer/pulse, glass everywhere, generic AI sparkle, tiny hover-only actions, decorative 3D, and shame mechanics.

Voice contracts:

| Voice | Surfaces | Character |
|---|---|---|
| Warm coach | lesson, cue, tutor | specific, curious, calm, never patronizing |
| Narrator | cinematic, completion, continuation/share | concise, coherent, forward-moving |
| Referee | errors, limits, offline, security | plain, factual, recovery-first |

Known accessibility defects—tiny dismiss/remove controls, 28px contextual actions, narrow reveal strip, repeating spotlight motion, mobile point-of-action placement—ship independently of the context foundation.

## 6. Target technical design: `AssistanceContextV0`

### 6.1 Ownership rule

Existing stores and hooks remain canonical. The new context module derives a snapshot; it does not mirror mutable project, run, progress, lesson, or tutor data.

Domain stores must not import the policy/context module. The context module reads typed inputs at the composition boundary.

### 6.2 Minimum canonical additions

- session-scoped `contextEpoch` regenerated on reload, reset, lesson/practice switch, and project replacement;
- monotonic `projectRevision` incremented on file content, add/remove/rename, language, stdin, or other execution-relevant mutation within that epoch;
- selection plus its source revision;
- Run and Check operation ID, lesson/practice identity, and source revision;
- tutor request ID, context identity, and source revision;
- lesson completion record kept separate from current-code validity;
- current persona/guidance level;
- session-only assistance episode and shown/dismissed action state. V0 has no time-based cooldown.

### 6.3 Pure snapshot

```ts
type AssistanceContextV0 = {
  contextEpoch: string;
  contextVersion: 0;
  lessonKey: string;
  practiceKey?: string;
  projectRevision: number;
  persona: 'beginner' | 'intermediate' | 'advanced';
  selection?: { file: string; range: Range; sourceRevision: number };
  latestRun?: OperationEvidence;
  latestCheck?: OperationEvidence;
  historicallyComplete: boolean;
  currentValidity: 'unknown' | 'passing' | 'failing';
  currentAttentionOwner: AttentionOwner;
  episode?: AssistanceEpisodeState;
};
```

`buildAssistanceContextV0(inputs)` is pure and called at guide-decision and tutor-ask time.

Supporting V0 contracts are deliberately narrow:

- `OperationEvidence`: operation ID, context epoch, lesson/practice key, project revision, operation kind, pending/success/failure status, normalized allowlisted error codes/locations, and start/finish timestamps;
- `AttentionOwner`: one enum matching the arbitration order below;
- `AssistanceEpisodeState`: lesson/practice key, normalized evidence key, move ID, shown/dismissed state, and originating revision;
- `contextVersion`: a schema version for compatibility; it changes only when the contract changes, not on each edit.

V0 does not merge live state across browser tabs. Each tab owns its epoch. A selection is cleared as soon as `projectRevision` changes; stale selection text is never shown or sent. At one revision, a Check result outranks any Run result: Check pass means `passing`, Check failure means `failing`. Without a Check, Run failure means `failing`, while Run success means `unknown`. Mutation/reset returns to `unknown`.

### 6.4 Stale-operation rejection

Every asynchronous completion carries:

- session/context epoch;
- lesson/practice identity;
- operation/request ID;
- originating project revision;
- context version.

The composition boundary owns acceptance. A completion may commit only when its context epoch, context version, lesson/practice key, originating project revision, and operation/request ID all equal the active snapshot and latest ID for that operation kind. Completions that fail any term cannot update output, progress, completion, hint level, current guidance, current conversation, or assistance outcomes. Navigation/reset aborts or invalidates outstanding work. Stale tutor answer content is discarded; the UI may show only the deterministic retry status defined in Release 1C, outside the transcript.

### 6.5 Minimal deterministic policy

```ts
type AssistanceDecision =
  | { kind: 'none'; reason: string }
  | { kind: 'cue'; move: LearningMove; surface: Surface; target: TargetId; action: ActionId; announce: boolean }
  | { kind: 'offer-tutor'; move: LearningMove; surface: Surface; action: ActionId };
```

V0 rules:

- current Run/Check error outranks historical completion;
- stale selections clear immediately;
- active streaming suppresses guide cues;
- a visible error/result bridge suppresses redundant coach copy;
- dismissal remains until relevant evidence changes;
- one unsolicited cue per episode;
- policy never invokes AI.

For the first proof, “same error” means the same normalized, allowlisted runner/validator error code in the same lesson and relevant file/range across two learner-initiated attempts, with at least one source revision between attempts. The episode ends when that code disappears, the relevant location no longer matches, or the learner resets/navigates. Dismissal does not end the episode; it changes the episode to `dismissed` and suppresses the cue until the evidence key changes. V0 has no clock-only reappearance.

Attention arbitration is deterministic: blocking referee/modal state → active learner-requested tutor → current Run/Check result bridge → authored current lesson task → unsolicited contextual cue → completion/continuation. Only the highest active owner may issue a changing “do this now” instruction.

Lesson-authored moves live in a versioned `assistanceMoves` course-content field, pass content-schema validation, and require curriculum/product approval. They contain reviewed question/cue IDs and concept tags, never arbitrary model-written instructional copy.

### 6.6 Explicit deferrals

Do not add until a second proven use requires them:

- general learner event log;
- edit oscillation or undo-thrashing inference;
- focus/visibility-based stuck classification;
- broad mastery context;
- production context inspector;
- raw event telemetry;
- universal model/property test framework.

Targeted randomized/model tests remain required for stale asynchronous-operation invariants.

## 7. Dependency-aware release lanes

Complexity is a planning band, not a deadline.

### Release 0P — Promotion safety

**Complexity:** approximately one week.

Deliver:

- build immutable frontend and backend artifacts once;
- record commit SHA, artifact digests, configuration/schema-compatibility requirements, and required-check results in one candidate manifest;
- promote those exact artifacts only after required CI/E2E checks for the candidate pass;
- keep database changes backward-compatible until both application artifacts are promoted;
- document partial-promotion recovery and rehearse frontend/backend rollback.

Exit:

- failed, missing, or cancelled required checks prevent promotion;
- the deployed artifact digests match the approved candidate manifest;
- an intentionally failed post-merge E2E run cannot reach production;
- partial promotion and rollback drills pass.

### Release 0A — Share trust

**Complexity:** approximately one week.

Deliver:

- internal non-counting preview route;
- purpose-specific service authentication selected in a small ADR approved by Staff Security and Staff SRE; the decision covers replay protection, least privilege, rotation, revocation, logging, and failure behavior;
- minimal metadata DTO;
- independent budget, timeout, cache/coalescing, degraded behavior, metrics, and kill switch;
- no fallback to the public counting endpoint;
- separate `copied`, `share completed`, `cancelled`, and `dismissed` outcomes;
- real Slack, Discord, LinkedIn, and iMessage unfurl proof.

Exit:

- crawler-only previews increment views zero times;
- one cold human visit increments once;
- preview bursts cannot consume public-client capacity;
- failure/rotation/revocation cases are safe;
- the two PR #10 defects are closed: crawler previews neither increment `view_count` nor consume the public reader rate budget.

Use a fresh share token and recorded request/metadata evidence for each external unfurl check. Third-party cache refresh timing is reported but is not treated as a deterministic release assertion.

### Release 0B — Test and preference reliability

**Complexity:** approximately one week.

Deliver:

- suffix-scoped teardown using one implementation;
- a server-side hard guard that refuses fixture deletion unless the identity has the exact current-run suffix and approved test domain;
- overlapping-run namespace test;
- unique test identities;
- awaited preference persistence acknowledgement instead of fixed sleeps;
- ordered PATCH/GET/hydration evidence before product persistence changes.

Exit:

- run A teardown cannot affect active run B;
- no cross-namespace deletion is recorded;
- Chromium produces zero failures across 600 isolated, retry-disabled executions under varied worker/shard ordering. Under the rule-of-three approximation, this supports a one-sided 95% upper bound near 0.5% only if runs are independent and the environment is stable; focused Firefox/WebKit runs are reported separately and make no equivalent statistical claim;
- failure cause is classified as fixture or product evidence.

### Release 0C — Product-contract integrity

**Complexity:** one to two weeks.

**Implementation status (2026-07-30):** locally complete on
`dev/contextual-learning-roadmap`; draft-PR CI is the remaining release gate.
The executable public-claims inventory is
`frontend/src/productContract.ts`. Local evidence includes 385/385 frontend
unit/contract tests, a production build, content lint, golden-solution
verification, and 34/34 executed changed-surface Chromium tests, including the
corrected iPhone-13 CTA check (the opt-in real-provider check was intentionally
skipped). The fresh-browser journey is covered independently at desktop and
390×844. A draft-PR WebKit failure also exposed and repaired Safari's
click-without-focus behavior: the share opener is now passed explicitly so
Escape restores focus across engines. The focused Chromium suite passes 7/7
and the WebKit critical journey passes 2/2 locally. Cinematic duration remains
unchanged by explicit product decision. The deployed PR preview returns 200,
has zero observed console/page errors or horizontal overflow at desktop and
390×844, routes both primary CTAs to the anonymous lesson, mounts the lesson
workspace, and restores focus to the share opener after Escape.

Deliver:

- remove exact-answer scripted rescue;
- versioned inventory mapping each public product claim to its source and contract test;
- make signed-out primary path/no-signup promise coherent;
- use one source for lesson-one duration;
- remove unearned Maya personalization or label it as an example;
- honor persisted tutor persona in authenticated guided mode;
- make “Maybe later,” share dismissal, and signup destinations truthful;
- repair ordered-list continuity and unexplained beginner jargon;
- add a true zero-state desktop/390px critical journey.

Exit:

- public claims map to passing contract tests;
- no scripted path supplies the complete solution;
- selected persona reaches the guided tutor;
- labels match destinations;
- first-use content has one clear next action.

### Release 0D — AI trust foundation

**Complexity:** two to four weeks.

**Implementation status (2026-07-30):** locally complete on
`dev/contextual-learning-roadmap`; draft-PR CI, review, and application of the
forward-only Supabase migration are the remaining release gates. The platform
tutor now reserves capacity transactionally before a provider call, finalizes
usage idempotently (including conservative accounting when provider usage is
unknown), and reclaims bounded expired reservations after crashes. Lesson and
mastery context is reconstructed by the server, prompts use an explicit
trusted/untrusted projection, tutor intent and text-only output are validated,
and contextual BYOK is limited to the versioned evaluated-model registry. The
tracked eval contract pins its dataset, evaluator, quality-contract hashes,
approved model, per-intent floors, and observed baseline so a reduced or stale
gate cannot masquerade as approval.

Local evidence includes 983 passing backend tests (21 intentional skips), 386
passing frontend tests, backend/frontend typechecks, 5/5 real PostgreSQL
reservation and identity-isolation integration cases against the actual
migrations, 50/50 full live-model eval cases with zero hidden errors and all
intent/posture floors at 100%, 6/6 agent-harness lifecycle tests, and 2/2
retry-disabled Chromium model-quality journeys at desktop and 390×844. A
production-dependency gate has zero unreviewed high/critical findings; its one
RSC-only exception is exact-version pinned, documented, and time bounded. The
release workflow independently blocks promotion when remote migration history
does not match the candidate.

Deliver:

- atomic reservation/finalization for platform-funded admission: one idempotency key per accepted action; transactional `reserved → finalized | released | expired` states; provider call only after reservation; retries reuse the key only when the provider guarantees idempotency; TTL is bounded by request timeout; crash recovery reconciles expired reservations without granting duplicate capacity;
- server-authoritative lesson/mastery context;
- trusted/untrusted field classification;
- minimal prompt projection;
- eval gate v2: full sample only, zero hidden errors, posture baseline, per-intent and must-pass floors;
- multi-turn, stale, adversarial, citation, refusal, answer-leak, and suspect-symbol cases;
- structured text-only output safety;
- offer-accept idempotency;
- versioned evaluated-model registry and honest BYOK quality labels.

Exit:

- concurrent cap-boundary tests admit only reserved capacity;
- reservation-store failure produces zero platform calls;
- prompt-authority red-team cases cannot override trusted rules or expose hidden tests/cross-user mastery;
- deliberately seeded quality regressions fail the gate;
- every selectable model has an evaluated/unevaluated state, and unevaluated models are blocked from the contextual tutor path.

If the provider may have accepted a call but the outcome is unknown, conservatively finalize the reservation at the maximum reserved amount, do not retry automatically, and reconcile later from provider usage records. A new explicit learner action may create a new request only after the prior request reaches a terminal local state.

### Release 1A — Context correctness primitives

**Complexity:** two to four weeks.

**Implementation status (2026-07-30):** locally complete on
`dev/contextual-learning-roadmap`; draft-PR CI and review are the remaining
release gates. The project store now owns a monotonic revision across source,
language, reset, replacement, hydration/session, and project-context changes.
Run, Check, and tutor work captures that identity plus a per-operation ID;
stdin has a separate monotonic input revision. Results, errors, progress,
celebration, and stream chunks publish only while the captured identity is
current. Editor selections carry the revision they came from, and current Run
or Check failure suppresses historical completion praise. Context switches
also clear evidence-derived pending asks. The implementation adds no guidance,
persisted telemetry, or AI request.

Local evidence includes 398/398 frontend tests, frontend and E2E typechecks, a
production build, and 3/3 retry-disabled Chromium lifecycle-fault cases that
hold successful Run, Check, and tutor responses until after navigation or an
edit. Eight existing retry-disabled Chromium regressions also pass across
editor Run/stdin, lesson Check/completion/navigation, tutor streaming/cancel,
and browser back/forward restoration of project and conversation state. The
runtime dependency remains acyclic: `projectStore → runStore → aiStore`, while
the only reverse reference from `aiStore` is a type-only project-version
import removed from the emitted graph.

Deliver:

- project revision and async operation identity;
- revision-bound selection;
- current failure outranks historical completion;
- late Run/Check/tutor results rejected after context changes;
- only the types/selectors required to enforce those correctness invariants;
- dev-only structured diagnostics if needed, not a product surface;
- no visible new guidance and no persisted telemetry.

Exit:

- no duplicated source of truth, unused assistance abstraction, or new circular store dependency;
- historical-completion plus current-syntax-error cannot show praise, and a Run/tutor request started in lesson A cannot write into lesson B after navigation;
- lifecycle reordering/fault-injection cases pass;
- old-lesson evidence cannot enter a new lesson;
- no AI request is added.

### Release 1B — Visible deterministic guide proof

**Complexity:** two to four weeks.

**Implementation status (2026-07-30):** locally complete on
`dev/contextual-learning-roadmap` behind the default-off internal preview flag
`?contextGuide=1`; draft-PR CI and review are the remaining engineering release
gates. The proof recognizes only an allowlisted Python unclosed-parenthesis
error tied to a current project file and line. It requires two learner-initiated
attempts on distinct source revisions, selects reviewed lesson-authored copy,
and never imports or invokes an AI/network path. The result bridge and editor
line become one attention owner: generic coach/error encouragement and the
manual tutor-error CTA yield while it is visible. Edit, rerun, dismissal,
navigation, successful/non-matching Run, or changed evidence ends or resets the
session-only episode according to the contract below.

Local evidence includes 410/410 frontend tests, frontend and E2E typechecks,
content lint with zero errors, a production build, and 3/3 retry-disabled
Chromium plus 3/3 retry-disabled WebKit browser proofs. Those proofs cover desktop authored-copy selection,
zero automatic AI requests, current-line focus, dismissal persistence and
changed-evidence recovery; 390×844 reduced-motion cue/target co-visibility and
44px actions; and a 390×500 software-keyboard viewport with Run/Check recovery
still reachable. The active-guide state also passes an axe scan (with Monaco's
separately audited canvas internals excluded), exposes a polite screen-reader
status, and records named before-repeat/after-authored-move screenshots in the
Playwright report. Fifteen adjacent retry-disabled Chromium journeys also pass
across stale-context rejection, anonymous conversion, the supported viewport
matrix, light/reduced-motion, 200% zoom, and software-keyboard behavior. Local
Firefox did not reach test code because its macOS headless SWGL renderer failed
to launch; the GitHub-hosted Linux Firefox job remains the authoritative
Firefox release gate rather than treating a pre-page renderer failure as a
product verdict.

This is engineering and internal-dogfood evidence only. The five-session
usability-falsification protocol remains pending, so the flag stays default-off
and this release is not approved for moderated research, limited learner
rollout, or broad rollout.

Deliver one canonical experience:

1. learner repeats the same unclosed-parenthesis error;
2. completion praise disappears;
3. result bridge names the current evidence;
4. a lesson-authored question asks which opening symbol lacks a partner;
5. a relevant edit/run ends the episode;
6. no automatic AI call;
7. dismissal persists until evidence changes.

Build only the `AssistanceContextV0` fields and deterministic policy branches required by this vertical slice. A second consumer must justify broadening the abstraction.

Exit:

- reducer/component/browser evidence with zero retries;
- 390px, desktop, phone keyboard, reduced motion, screen reader, and 44px target checks;
- cue and target simultaneously visible;
- one attention owner;
- annotated before/after recordings;
- the five-session usability-falsification protocol in Section 5 passes before any external rollout, or a dated founder exception is recorded.

### Release 1C — Contextual tutor offer

**Gate audit (2026-07-31):** not eligible to start. The current tutor boundary
has the required engineering mechanisms, but no powered 1B learner-experiment
result or two-human eval-calibration artifact exists, and the lane has no named
human DRI/approver record. See `docs/RELEASE_1C_ENTRY_GATE.md` for the complete
evidence matrix. No learner-visible contextual tutor rollout is approved.

**Entry gate:** Release 1B's preregistered experiment passes the primary recovery rule and every applicable guardrail in Section 10.3; B2, eval v2, authority, idempotency, cost, and security gates also pass. Five qualitative sessions alone cannot unlock 1C.

**Complexity:** two to four weeks.

Deliver:

- “Help me spot it” click is consent and triggers at most one billed call;
- same current evidence and scaffold level reaches the tutor;
- if code/context changes during generation, discard the answer content and show a deterministic “Your code changed while I was thinking—ask again when ready” status outside the conversation transcript;
- offline/quota/BYOK/kill-switch states retain deterministic recovery;
- no full answer at any escalation level.

Exit:

- contextual golden/adversarial cases pass;
- stale-stream fault injection passes;
- no model call before click and exactly one after accepted action;
- first turn satisfies locked B2;
- prompt/cost report stays within approved guardrails.

### Release 1D — CI shadow pilot

**Complexity:** two to four weeks.

**Implementation status (2026-07-30):** the initial additive pilot is built on
the active roadmap branch. It contains source-owned metadata, a 36-test/13-file
zero-retry critical lane, a frozen 10-case P0/P1 corpus, three lower-layer
migration pilots with their browser boundaries retained, queue-inclusive miss
evidence, and a label-triggered same-commit 4/6/8 shard benchmark whose 6- and
8-shard alternatives run sequentially to protect the shared Supabase project.
[Run 30604240871](https://github.com/msrivas-7/CodeTutor-AI/actions/runs/30604240871)
completed without retries on commit `c6aa5f0`: six shards were
fastest at 316 seconds, versus 340 seconds for eight and 495 seconds for four.
It also used the least aggregate runner time: about 27.3 runner-minutes versus
37.3 for eight and 29.4 for four.
The blocking full Chromium suite therefore keeps all 333 tests and moves from
four to six shards; no test was selected away or demoted. The 30-day/50-eligible-
run clock begins only after this implementation merges and produces its first
eligible evidence artifact; no demotion decision has been made.

Deliver:

- source-owned Playwright tags/annotations for risk, owner, browser/device, and quarantine;
- initial critical lane running beside unchanged full PR suite;
- three migration pilots: CoachRail/selection/tutor state, endpoint-only cases, one settings/free-tier matrix;
- historical and deliberately seeded regression corpus;
- post-demotion rollback automation and miss monitoring; promotion safety remains Release 0P.

Exit:

- at least 30 days and 50 eligible PR/main runs in shadow, whichever is later, across UI, backend, content, dependency, fixture, and CI changes;
- candidate critical gate ≤8 minutes queue-inclusive p95;
- every P0/P1 case in the frozen versioned corpus caught;
- no P0/P1 under the frozen taxonomy is unique to the full suite during the window;
- rendered/service replacements pass the signed equivalence checklist in Section 8.5;
- changed-file selection remains advisory throughout the pilot;
- after demotion, the full suite runs daily for 30 days and one P0/P1 miss immediately restores PR blocking;
- only then consider demoting exhaustive PR Chromium.

### Parallel Release B1 — Memory read-side

**Implementation status (2026-07-31):** implementation is complete on
`dev/contextual-learning-roadmap`. The development Supabase project has the three
forward migrations applied. Local browser evidence, the 18-lens persona review,
all 28 required PR checks, preview deployment and HTTP route health, and the
review-thread audit are green. The B1 harness session finished with zero pending
incidents. This does not claim the
locked D7 retention outcome, and it does not surface the full learner-facing
mastery graph reserved for Phase C.

Deliver:

- keep the A6 ledger honest as exposure history rather than relabeling it as
  mastery;
- add bounded practice and retrieval evidence with own-user read RLS, revoked
  browser writes, cascade deletion, export coverage, retry/concurrency safety,
  and server-owned canonical scoring;
- derive `unseen → encountered → practiced → remembered → retained` without
  allowing speed, completion, pasted work, practice alone, or recall after
  feedback to become high-confidence retention;
- author and lint one deterministic retrieval bank per public course;
- place at most one due warm-up before a lesson whose prior concepts have not
  been retrieved recently, with no model call and one primary attention owner;
- record practice identity, attempts, authored/tutor help dose, elapsed time,
  and model assistance as supporting evidence;
- fail open to the lesson on memory-service failure while making retry and the
  degraded state explicit.

Exit:

- real PostgreSQL cases prove cross-user RLS without application `WHERE`
  clauses, denial of direct authenticated writes, successful backend-owned
  writes, idempotent practice/retrieval writes, concurrent episode creation,
  first-attempt versus feedback-supported classification, five-day spacing,
  and immediate-repeat suppression;
- route and browser tests prove the answer never reaches the client before a
  choice, errors recover without trapping the learner, keyboard/focus/mobile/
  reduced-motion contracts hold, and no automatic AI request occurs;
- content lint, unit suites, typechecks, production builds, migrations, full
  PR CI, deployed preview, and review threads are green;
- the release packet records rollback, privacy/export, operational bounds, and
  the distinction between engineering correctness and pending real-user D7
  evidence.

Detailed evidence lives in `docs/RELEASE_B1_MEMORY_READ_SIDE_PACKET.md`.
The phase-specific persona verdict lives in
`docs/B1_MEMORY_READ_SIDE_PERSONA_AUDIT.md`.

### Parallel Release B2 — Socratic default

**Implementation status (2026-07-31):** complete on
`dev/contextual-learning-roadmap` at phase commit `9994ae4`. Local validation,
the complete 60-case live model gate, all 28 required remote checks, deployed
public-preview browser verification, the harness, persona audit, and two
post-push review-thread audits are green. The server enforces one clarifying
question on the first successful task turn, permits a bounded approach only
after a learner reply, and prevents a complete answer on every turn. The same
contract covers authenticated, anonymous, guided, editor, scripted, and
generated help.

Deliver:

- make the server—not browser history—the authority for the question-to-
  approach transition;
- bind a short-lived signed progression proof to actor and canonical task and
  fail closed on absent, malformed, forged, expired, or cross-context input;
- allow exactly one open question and no other guidance on turn one;
- apply complete-answer enforcement to every learner-visible prose field and
  mirror it with an independent deterministic release backstop;
- remove exact-answer scripted rescue and keep scripted copy out of model
  history;
- render one calm, non-clickable “Your turn” question card without moving focus
  or adding an automatic model call;
- expand eval v2 to 60 cases with ten Socratic cases and six balanced intents.

Exit:

- unit, route, hostile-token, policy, store, stale-operation, auth/anon browser,
  mobile, accessibility, and cross-browser tests pass;
- the complete retry-disabled Chromium corpus and hostile security suite pass;
- the 60-case live model gate completes with zero errors/deterministic failures,
  ≥95% overall posture, ≥90% per-intent posture/helpfulness, and every absolute
  case green;
- the reviewed baseline fingerprint matches the shipped prompt, output policy,
  evaluator, dataset, and model registry;
- full PR CI, preview checks, and review threads are green before B3 begins.

Detailed evidence lives in `docs/RELEASE_B2_SOCRATIC_DEFAULT_PACKET.md`.
The phase-specific persona verdict lives in
`docs/B2_SOCRATIC_DEFAULT_PERSONA_AUDIT.md`.

### Parallel Release B4 — Distribution surface

B4 begins after share correctness and is never blocked by releases 1A–1D.

Deliver:

- crawlable public lesson pages from structured course content;
- unique raw HTML title/description/canonical/OG data;
- sitemap and internal-course exclusion;
- per-lesson OG assets;
- category-claim surface;
- privacy-bounded source/share attribution through first run/completion.

Actual organic traffic remains the locked outcome; pre-launch work proves crawler correctness only.

**Implementation evidence (2026-07-30, pre-merge):** the build now derives 3
public course pages, 38 lesson documents, 38 unique 1200 × 630 lesson images,
`sitemap.xml`, `robots.txt`, and a public-only registry from the structured
course tree. Raw HTML carries unique metadata and structured data; unknown or
internal reserved paths fail closed with 404. Organic/category and share CTAs
carry an allowlisted first touch through landing, first run, completion,
signup, and lesson 2; the server stores only coarse enums/bounded slugs and a
domain-separated share hash. The admin surface reports channel cohorts without
raw referrer URLs or tokens. Unit/build checks, a real dev-database telemetry
integration, the critical E2E contract, Chromium phone/accessibility proof, and
the production dependency audit pass locally. Merge CI, deployment verification,
indexing, and the locked organic-traffic observation window remain pending; no
traffic outcome is claimed. Detailed release evidence lives in
`docs/RELEASE_B4_DISTRIBUTION_PACKET.md`.

### Parallel Release B5 — Continuation card

**Engineering release status (2026-07-31):** complete at `d2b3c62` on
`dev/contextual-learning-roadmap`; local, persona, full remote CI, Linux
Firefox, deployed-preview desktop/phone, harness, and PR-thread gates pass.

Deliver:

- restage anonymous account creation inside the lesson using the completion
  celebration's panel language and ordinary `dialog` semantics;
- keep OAuth, email fields, validation, loading, provider errors,
  confirmation, resend, address correction, sign-in, and dismissal inline;
- preserve reason-specific, truthful continuation copy without claiming that
  incomplete anonymous work has been persisted;
- reuse the existing one-shot handoff for completed next/share paths and
  prefill a real extracted learner name when available;
- retain no-request-before-submit, server/provider-owned auth policy, and the
  existing `/auth/callback` boundary;
- cover stacked-modal restaging, focus/inert cleanup, reduced motion, 44px
  controls, phone scrolling, and no horizontal overflow.

Exit:

- the full frontend unit suite, typecheck, production build, and E2E typecheck
  pass;
- retry-disabled Chromium covers inline submission, metadata, confirmation,
  resend, every wall reason, direct-signup parity, telemetry, modal chaining,
  focus recovery, and phone layout;
- WebKit and the normal CI Firefox project cover the critical desktop/phone
  journey;
- a rendered desktop/phone audit verifies the initial, confirmation, and
  scroll states with no page errors or overflow;
- the 18-lens audit has no P0/P1 open, full PR CI/preview is green, and every
  actionable review thread is resolved.

Detailed evidence lives in `docs/RELEASE_B5_CONTINUATION_CARD_PACKET.md`.
The phase-specific persona verdict lives in
`docs/B5_CONTINUATION_CARD_PERSONA_AUDIT.md`.

### Parallel Release B7 — Suspect-symbol telemetry

**Engineering release status (2026-07-31):** implementation, calibration,
persona, backend regression, typecheck, build, approved-baseline, and complete
live model gates pass at `8cf02ed`. All 29 remote checks, including the full
unchanged browser matrix and shadow evidence, pass; only the expected
preview-close job is skipped while the PR remains open. The thread-aware audit
found zero reviews and zero review threads.

Deliver:

- scan only code-formatted tutor output after response completion;
- trust reviewed runtime/stdlib symbols, symbols present in learner files, and
  functions/classes/variables/methods concretely declared in the same tutor
  code span;
- treat learner questions as untrusted evidence rather than symbol authority;
- flag unknown call terminals and invented dotted-call roots without exempting
  plausible snake-case or camel-case names;
- emit a bounded, versioned `tutor_suspect_api` counter/log event without raw
  code, paths, questions, prompts, or tutor prose;
- preserve response delivery exactly: no block, mutation, retry, extra model
  call, database write, or learner-visible state;
- calibrate against a versioned, balanced labeled corpus and make the corpus,
  evaluator, and detector part of the approved AI quality fingerprint.

Exit:

- the 40-case corpus remains balanced across Python/JavaScript and
  fabricated/clean cases and clears ≥95% precision, recall, exact-case, and
  clean-case rates;
- always-empty and always-flag mutations fail the calibration gate;
- authenticated sync, authenticated stream, and anonymous stream route
  contracts prove the completed response is observed once;
- the complete backend suite, typecheck, production build, baseline verifier,
  and full 60-case live model gate pass on the final fingerprint;
- the 18-lens audit has no P0/P1 open, full PR CI is green, and every actionable
  review thread is resolved.

Detailed evidence lives in
`docs/RELEASE_B7_SUSPECT_SYMBOL_TELEMETRY_PACKET.md`. The phase-specific
persona verdict lives in `docs/B7_SUSPECT_SYMBOL_PERSONA_AUDIT.md`.

### Parallel Release B8 — Governed anonymous eval sampling

**Engineering release status (2026-07-31):** local implementation, real-
database privacy/lifecycle tests, full backend/frontend regression, production
builds, eval governance, database lint, Chromium/WebKit browser checks, and the
18-lens audit pass. The phase commit, remote CI/preview matrix, and PR
review-thread closeout remain pending.

Deliver:

- show a plain-language, explicit, off-by-default consent control only on the
  anonymous platform-funded tutor;
- select a deterministic 5% of successful turns without adding a model call or
  learner-visible response latency;
- project through a conservative pre-insert redactor into a bounded schema with
  no source files, selections, terminal data, paths, IPs, raw history, or BYOK;
- give the browser a high-entropy deletion capability, support retryable
  turn-off/delete, link retained rows for user export/account cascade, and
  enforce an exact 30-day maximum with an executable expiry job;
- keep tables backend-only, admin reads/reviews audited, repeated patterns
  deduplicated, and the two-independent-reviewer cap concurrency-safe;
- close two-reviewer consensus and move only disagreement into a weekly
  synthesis queue; delete privacy-rejected candidates immediately;
- prohibit direct traffic promotion into the golden holdout and make explicit
  expert/synthetic provenance, independent authoring, two reviewers, unique
  source patterns, and duplicate-content checks part of CI;
- provide an independent sampling kill switch that fails closed while tutor
  delivery and existing-sample deletion/expiry continue.

Exit:

- unit, route, real-Postgres, concurrency, expiry, access, export/deletion,
  admin-audit, and provenance tests cover every B8 invariant and unhappy path;
- the full backend/frontend suites, typechecks, production builds, approved
  baseline, governance verifier, suspect-symbol calibration, content/solution
  checks, and asset budgets pass;
- retry-disabled Chromium covers default-off, request-time consent, deletion,
  retry failure, disclosure, privacy navigation, axe, keyboard, and 390px
  reduced-motion layout; WebKit covers the critical phone/privacy journey;
- linked Supabase migrations are at parity and schema lint is clean;
- the 18-lens audit has no P0/P1 open, full PR CI/preview is green, every
  actionable review thread is resolved, and the harness session is finished.

Detailed evidence lives in
`docs/RELEASE_B8_GOVERNED_EVAL_SAMPLING_PACKET.md`. The phase-specific persona
verdict lives in `docs/B8_GOVERNED_EVAL_SAMPLING_PERSONA_AUDIT.md`.

## 8. Test and CI strategy

### 8.1 Current baseline

- 336 listed Playwright tests across 50 files after the B4 distribution contract
  was added on 2026-07-30;
- 11,666 E2E spec lines as re-counted after the B4 contract on 2026-07-30;
- six Chromium shards plus Firefox/WebKit critical jobs, selected by the
  same-commit 4/6/8 benchmark above;
- two workers per shard;
- nine independent stack boots: six exhaustive, two cross-browser, and one
  advisory critical lane;
- CI retains up to two diagnostic retries but `failOnFlakyTests` fails any
  shard that needed one; local runs retry once;
- the E2E README now documents exhaustive Chromium, focused Firefox/WebKit,
  and the additive 1D advisory lane;
- frontend unit tests are predominantly pure Node tests, leaving a thin rendered-component middle.

### 8.2 Target layers

| Layer | Owns | Target |
|---|---|---|
| Pure unit/model | selectors, policy, validators, prompt/context contracts | seconds |
| Rendered component | guide/tutor/dialog/copy/focus/a11y state matrices | under 2 min |
| Backend/service integration | routes, auth, quota admission, rate limits, persistence, share counts | under 3 min |
| PR critical browser | named product spine and browser-only boundaries | ≤8 min p95 after proof |
| Full Chromium | exhaustive retained behavior | remains PR-blocking until shadow proof; later main/nightly/release |
| Cross-browser critical | highest-risk browser-specific journey | PR/main/release as risk requires |
| Visual/accessibility | named critical states and device contracts | UI PR/nightly/release |
| Production checks | availability/readiness plus bounded non-destructive journey | separate release signal |

### 8.3 Browser behaviors that stay

- cold anonymous phone/desktop first win;
- Monaco typing, focus, selection, shortcuts, and model sync;
- real Run/Check/runner boundary;
- auth, hydration, sign-out/in, and cross-context persistence;
- modal/inert/focus restoration;
- SSE streaming and cancellation;
- lesson/practice/retrieval/completion journey;
- phone action bar and viewport intersection;
- public share boundary;
- focused cross-browser and security/system boundaries.

### 8.4 Candidate migrations

- Coach/tutor/settings/free-tier UI permutations → reducer/component tests plus representative browser journeys.
- Metrics, unsubscribe, admin authorization, and share count/rate cases → backend integration plus one UI/browser boundary.
- Per-language permutations → runner/backend matrix plus representative browser smokes.
- Course permutations → content/schema/solution verification plus representative learner journeys.

### 8.5 Flake and catch-quality policy

Freeze these definitions before the shadow window:

- **Eligible run:** a non-draft PR or main push whose full suite completes and that changes frontend/backend behavior, course/content schema, dependencies, fixtures, workflow/configuration, or infrastructure. Docs-only changes are excluded. Cancelled/superseded runs and documented external outages are excluded from pass-rate math but remain in the operations record.
- **P0 fault:** security/privacy/cross-user exposure, destructive data behavior, uncontrolled spend/admission, answer-contract violation, stale cross-context write, or untested production promotion.
- **P1 fault:** core learn/run/check/share/auth journey failure, material accessibility blocker, persisted-preference loss, or contractual UI destination/claim failure without P0 impact.
- **Severe failure:** any P0 or P1 under the frozen taxonomy.
- **Equivalent replacement:** the lower-layer test asserts the same relevant user state, focus/accessibility behavior, request authentication/status/payload, persistence/side effect, and failure recovery. Browser-specific boundaries retain at least one browser assertion. Staff QA and Staff SWE sign the checklist before the original browser case can be demoted.

- A retry is evidence, not a clean pass.
- Critical tests target zero retries.
- Every flake has owner, issue, first-seen date, and expiry.
- Quarantine requires replacement protection or explicit risk acceptance.
- Do not fix flakes by permanently increasing retries/timeouts.
- Keep the original failure in the quality record after a shard rerun.
- Candidate gate must catch historical and seeded P0/P1 regressions before coverage demotion.
- The regression corpus is versioned, names the originating incident/defect and expected catching layer, and is frozen before each shadow evaluation window.
- Shared config/store/router/schema/CSS/dependency/fixture/CI changes force the full gate until dependency selection is proven.

### 8.6 Release safety

- build once, test the candidate manifest, and promote the exact frontend/backend artifact digests associated with its Git SHA;
- failed/missing/cancelled required confidence checks pause promotion;
- schema migrations are expand/contract and backward-compatible across partial promotion; their migration IDs and compatibility window are part of the manifest;
- frontend and backend rollback are rehearsed;
- production availability/readiness probes run every 10–15 minutes;
- spend-bearing journey checks remain bounded and less frequent;
- recovery is recorded without alert spam.

## 9. AI, data, economics, and operational guardrails

### 9.1 Trusted context

Server-authoritative:

- lesson identity/title/objectives/concepts/completion rules;
- authenticated mastery/progress;
- permitted hidden-test categories.

Client-observed and untrusted:

- code, selection, stdin, stdout/stderr, diffs, history, activity summaries, assistance reason.

`contextId` is freshness/correlation metadata, never authorization.

### 9.2 Eval v2

- gate mode requires the complete versioned dataset;
- any errored/missing case fails;
- complete-answer refusal, prompt-authority, cross-user isolation, and applicable try-first cases are 100% absolute must-pass;
- Socratic posture passes at ≥95% overall and ≥90% within every intent; judged helpfulness/correctness passes at ≥90% within every intent, with no intent allowed to regress by >2 percentage points from its approved baseline;
- deterministic schema/citation/path/answer-leak/suspect-symbol validators run before the judge;
- multi-turn contextual/adversarial/stale cases are first-class;
- results identify prompt, schema, context builder, model, evaluator, and dataset versions;
- baseline changes require reviewed artifacts.

Before the gate becomes authoritative, two human reviewers independently label a stratified set of at least 50 cases and reach Cohen's kappa ≥0.75 against the automated judge; disagreements are adjudicated and become regression cases. Recalibrate after judge, rubric, or major model changes. Deterministic safety validators override the judge. Judge-only results within two percentage points of a floor require human review. Unevaluated models cannot serve Release 1C, even if they remain available elsewhere under an explicit quality label.

### 9.3 Telemetry

Raw edits, selections, focus, visibility, and timers stay client-local.

“Observe-only” in Releases 1A/1B means local developer diagnostics or in-memory counters that disappear on reload; it never means hidden server persistence. The moderated five-session study uses consented research notes/recordings outside product telemetry.

Before any unmoderated limited rollout, Product Owner, Staff Security, and the named data owner approve a versioned episode-outcome schema plus field inventory, purpose, retention/deletion test, role-based access list, volume/cost bound, and sample payloads. It uses allowlisted enums/counters, random episode IDs, coarse timing, per-session/day caps, retention/deletion, access roles, and fail-open dropping. No source, selection text, prompts, conversation, output, emails, IPs, hidden-test details, or arbitrary strings. The schema must support the metric dictionary in Section 10 and nothing broader.

### 9.4 Provisional economics guardrails

These are baseline-dependent engineering guardrails, not founder-locked pricing decisions:

- contextual supplement ≤500 net-new input tokens at p95;
- one accepted offer → at most one billed request;
- nano-only platform AI target ≤$0.025/AI-active learner/day;
- mixed nano/mini target ≤$0.05/AI-active learner/day unless founder-approved;
- measure calls/active/day, p50/p95 tokens, cost/intent, funding-source mix, and cost/useful outcome;
- project 100, 500, 1,000, and 10,000 DAU before routing changes.

B3 requires quality improvement and acceptable cost per helpful outcome.

### 9.5 Runtime controls

Independent switches:

- local/in-memory context diagnostics;
- learner-visible contextual cues;
- contextual tutor offers;
- assistance telemetry;
- internal preview adapter.

Policy/telemetry failure disables the new cue/offer and leaves editor, Run, Check, and authored lesson instructions usable. It never disables or bypasses server authority, atomic admission, answer-leak protection, output safety, or eval-approved model constraints.

The currently deployed learner-initiated tutor is a temporary explicit risk decision while 0D is built: the founder either disables platform-funded tutor access immediately, or records a dated acceptance with current caps/kill switch, no contextual expansion, an owner, and an expiry no later than the 0D release decision. After 0D, its protections are non-bypassable. Disable/rollback drill target: under 10 minutes.

## 10. Success and stop gates

### 10.1 Ready to begin remediation

- founder acknowledgement artifact exists;
- each active lane has a named human DRI, approver, evidence location, rollback owner, and capacity allocation;
- release switches and default-off behavior are recorded.

This authorizes Releases 0P–0D and 1A. It does not authorize external contextual guidance.

### 10.2 Ready for learner-visible contextual work

- validated P0 correctness/security items resolved;
- exact-answer leakage removed;
- test namespaces isolated;
- stale async evidence rejected;
- current evidence cannot be contradicted by completion history;
- server owns pedagogic authority;
- tutor quality gate is complete and failure-intolerant;
- phone cue/target are visible together and accessible;
- no automatic AI call;
- CI candidate proves catch quality before demotion;
- production promotes the exact tested artifact digests recorded for the approved SHA.

Release 1B may be built and internally dogfooded before every item above is complete, but it cannot enter moderated research until 0P/0C/1A pass or external limited rollout until all applicable items pass. Release 1C additionally requires 0D, locked B2, and cost/security approval.

### 10.3 Product metric dictionary

The five-session protocol in Section 5 is qualitative falsification. Unmoderated product claims require a preregistered experiment and the minimal approved episode schema from Section 9.3.

| Metric | Population and exposure | Definition | Decision rule |
|---|---|---|---|
| Independent recovery within 120 seconds | First eligible repeated-error episode per non-staff learner; treatment sees 1B cue, control sees existing result/instructions | Target error disappears after learner edit plus Run/Check, before tutor open or any supplied solution | Primary 1B signal: ≥8 percentage-point absolute uplift and 95% confidence-interval lower bound >0; sample size set before launch for 80% power from the measured control baseline; no decision below that sample |
| Cue dismissal | Exposed treatment episodes | Learner dismisses before a relevant edit/run | One-sided 95% upper confidence bound <25%; otherwise revise placement/timing even if recovery rises |
| Tutor escalation | Eligible episodes by arm | Learner explicitly opens tutor before independent recovery | One-sided 95% upper confidence bound on treatment-minus-control <5 percentage points; desired direction is lower |
| Lesson completion | Eligible learners by arm | Course-owned Check and required retrieval complete in the same session | Non-inferiority: one-sided 95% lower confidence bound on treatment-minus-control >−2 percentage points |
| Stale/wrong intervention | All dogfood, research, and rollout episodes | Cue/answer refers to a different epoch, lesson, revision, or normalized evidence key | Zero allowed in test/research; any confirmed production occurrence disables the affected switch and opens a P0 incident |
| Cold retrieval | Learners reaching the roadmap's later cold task | First attempt succeeds without answer reveal or tutor assistance | Phase A uses the locked ≥80% lesson-3 threshold; 1B does not claim this outcome until the cold task is instrumented |
| D7 retention | Learners exposed to the complete Phase B memory + Socratic treatment versus control | Returns and performs a qualifying learning action on day 7 | Locked Phase B decision: ≥30% relative improvement; this is not attributed to 1B alone |
| Tutor-induced dropoff | Tutor users versus preregistered comparable/control cohort | Leaves the lesson or becomes inactive within the preregistered window after tutor response | Definition/window and non-inferiority margin are frozen before B3; model upgrade cannot ship if it regresses |

The experiment record names randomization unit, exclusions, control, exposure version, baseline, analysis window, owner, and stop decision. Before launch, power every primary/guardrail comparison at 80% for its stated margin using the measured baseline; the required analyzable sample is the largest of those calculations, and no success decision occurs below it. Correctness tests prove the mechanism; they do not satisfy this table.

### 10.4 Product success (pending real evidence)

- the primary recovery rule and all guardrails above pass;
- later cold retrieval/transfer improves under a separately powered design, not merely completion speed;
- the locked Phase B D7-retention, tutor-dropoff, organic-search, and share outcomes are evaluated without attributing them to unsupported causes.

### 10.5 Stop/scale rules

- If a narrow derived snapshot solves the defects cleanly, do not build the event platform.
- If deterministic guidance does not improve the next meaningful action, do not add proactive tutor offers.
- If a critical CI lane misses one agreed high-severity regression, expand the map and keep full PR blocking.
- If contextual prompts exceed cost/size guardrails without quality benefit, reduce context or stop rollout.
- If guidance creates more interruptions, stale advice, or answer-seeking, fall back to current-state correctness and explicit help.

## 11. Priority backlog

### P0

1. **0P:** gate production promotion on the approved candidate manifest and exact artifact digests.
2. **0B:** suffix-scoped E2E teardown, non-test-user deletion guard, and overlapping-run proof.
3. **1A:** late Run/Check/tutor operation identity and stale-result rejection.
4. **0D:** atomic platform-AI reservation/admission and complete eval gate v2.
5. **0C:** remove first-run complete-answer rescue.
6. **0A:** internal non-counting share preview path and truthful share outcomes.
7. **0D before 1C:** server-authoritative authenticated lesson/mastery context.

### P1

8. **0C:** honor learner persona and complete product-contract/first-use corrections.
9. **1B:** build only the minimum `AssistanceContextV0` and phone-visible repeated-error proof.
10. **B4:** distribution in parallel after 0A.
11. **1D:** CI shadow pilot and three lower-layer migrations after 0P/0B.

### P2

12. B1/B2 groundwork per the locked roadmap.
13. Contextual tutor offer after 0D, 1B, and B2 entry gates.
14. B3/B7/B8 integrations per the locked roadmap.
15. Full cost/performance/operations reporting.
16. Broader visual polish after correctness and attention placement.

## 12. Explicit non-goals

- No cinematic-duration change.
- No forced tour or normal-control locking.
- No surprise tutor opening or automatic model call.
- No complete-answer path.
- No generic autocomplete/copilot.
- No phone-native expansion beyond lesson one.
- No universal event platform in V0.
- No raw interaction telemetry.
- No test deletion merely to hit a count or time.
- No full-suite demotion before catch-quality proof.
- No richer learner-memory claims without valid evidence/privacy controls.
- No roadmap bucket displacement by this workstream.

## 13. Plain-language glossary

- **Locked:** explicitly decided in the approved roadmap; changing it requires the reapproval listed in Section 3.1.
- **Course-owned evidence:** a deterministic curriculum/Check result, not the model's opinion or simple lesson completion.
- **Context epoch:** one active lesson/practice project lifetime; reset, navigation, reload, or replacement starts another.
- **Posture baseline:** the committed expected rate at which tutor responses follow try-first/Socratic behavior and refuse complete solutions.
- **Must-pass:** an eval case that cannot be averaged away; one failure blocks the gate.
- **Suspect-symbol telemetry:** a hint that a symbol may be involved, not a proven syntax diagnosis until precision/recall is calibrated.
- **Catch quality:** whether a smaller test lane detects the important failures the full suite detects, including historical, seeded, and newly observed faults.
- **D7 retention:** a learner returns and performs the preregistered qualifying learning action on day seven.

## 14. Source notes

- Persona audit synthesis: `.claude/audits/2026-07-30-contextual-learning-delivery-plan/synthesis.md`
- Locked roadmap: `.claude/audits/2026-05-06-post-phase-27/roadmap-v2.md`
- Product architecture: `docs/ARCHITECTURE.md`
- Current E2E guide: `e2e/README.md` (stale; update during CI work)
- Release 0P promotion/rollback runbook: `docs/RELEASE_0P_RUNBOOK.md`
- Main E2E run and targeted successful rerun: <https://github.com/msrivas-7/CodeTutor-AI/actions/runs/30565960537>
- Playwright best practices: <https://playwright.dev/docs/best-practices>
- Playwright CI: <https://playwright.dev/docs/ci>
- Playwright projects: <https://playwright.dev/docs/test-projects>
- Playwright CLI: <https://playwright.dev/docs/test-cli>
- Testing-pyramid background: <https://testing.googleblog.com/2015/04/just-say-no-to-more-end-to-end-tests.html>
