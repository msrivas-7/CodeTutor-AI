# Public brand continuity — design reset

Status: **phone-reviewed auth direction approved for rollout; local implementation in progress**.
Approval covers the described direction, not acceptance of an unseen rendered result.
The prior local treatment is rejected; its functional fixes and tests remain useful,
but are not evidence that its visual design is acceptable.

### Latest moving-prototype feedback

Mehul has now reviewed login/signup on his phone: they look better, but navbar
sizes and other elements jump between routes. He explicitly requested correcting
those seams and extending this direction to the remaining public pages, including
privacy. Implementation and supporting checks may proceed while the Mac is locked;
final actual-browser verification waits for unlock. This advances the rollout
approval, not the release/quality gates or approval of unrelated design changes.

Earlier feedback rejected the first motion treatment (historical prototype):
public pages must feel like different parts of one living body, not a static glyph
shape using matching colors. Reduced-motion emulation was briefly active during
recovery-page QA and has been cleared; that test state does not explain away the
design feedback. In that prototype's normal motion, the auth scene fixed its
assembly and scale, with only the shared small yaw and pointer displacement.
It did not deliver the planned arrival, redistribution or route persistence;
the current connected-world implementation is described below.

Keep the improved surface treatment and centered forms. Next evaluate connected
field behavior, not additional standalone sculptures: material carries momentum
between public SPA routes and redistributes into the available space around each
task. Avoid a permanently outlined bracket frame, arbitrary timed shape carousel,
or moving form controls. Preserve the homepage's established pacing and physics;
prove the effect through homepage → login → signup/recovery and back, as a moving
journey, before accepting this as the shared brand contract.

**Current local experiment:** `PublicMotionWorld` now owns the renderer above
route Suspense boundaries; pages register presentation-only scene descriptors.
The auth experiment uses the living-clearing alternative: seeded glyphs flow
through a broad stream on the same retained clock, instead of holding a stretched
code contour. Target interpolation shares the CPU pointer projection and shader
geometry. The phone review authorizes extension; it is not a released design.
The original homepage chapter solver and pointer spring remain the reference.

**Latest local surface refinement (UX-212):** Mehul requested improving the
opaque “From why to I see it” area and centralizing design decisions. The local
study uses letterform shadows plus a small elliptical fade for that brief display
heading, not rectangular backing. Dense explanation copy keeps local protection;
the actual demo controls/code/tutor body remain solid. Desktop/phone supporting
captures prompted the added fade after the unprotected phone heading looked busy.
Mehul explicitly approved this current design after viewing the local study-demo
page on his phone on September 8. This does not authorize making dense prose
transparent or substitute for final actual-browser readability/recovery checks.
The [design system](DESIGN_SYSTEM.md) now owns shared token and material conventions.

## Decision in plain language

The homepage is the brand. Moving to another public page should feel like entering
another part of the same living environment, not leaving it for a dark form template.
Keep its near-black canvas, luminous code-symbol material, depth, spectral variation,
inertial pointer response, deliberate pacing, typography and action language.
Change the composition to support the page's task—not the material or physics.

**Recommended first study: the surface-and-field relationship on the homepage
and centered login together.** Remove unnecessary background-blocking wrappers,
not every useful surface. Preserve the homepage's story and motion. Then evaluate
login's proposed open code contours within that same material system—not a fixed
bracket ornament. Mehul approves the actual moving desktop and phone experience
before it becomes the shared design contract.

## What failed, and what the evidence proves

| Evidence | Consequence |
| --- | --- |
| `AuthShell` chooses `ambient`; `ParticleField` forces `spread=1`, `opacity=.35` | The foreground never gathers into a meaningful composition. |
| Auth CSS multiplies canvas opacity by `.5` | Foreground maximum alpha is `.175` before texture/brightness attenuation. |
| Desktop hides a 500px central strip; phone hides everything except 20px edges | Little visible space remains for interaction. |
| Public foreground count is 240 versus homepage 420; `createScatter` puts foreground at extreme edges | The visual weight and distribution differ before any masking. More particles alone cannot fix this. |
| Page components own their renderer; changing route replaces those components | Clock, spring displacement and canvas are discarded. Sharing component code is not continuous motion. |
| Actual in-app homepage → Sign in showed a full-screen skeleton before the new scene | Correct background color alone does not preserve the experience. |

Source anchors: `frontend/src/features/marketing/study/ParticleField.tsx:419`,
`frontend/src/features/marketing/study/geometry.ts:130`,
`frontend/src/features/marketing/public/public-page.css:147`,
`frontend/src/features/marketing/public/PublicPage.tsx:98`,
`frontend/src/auth/AuthShell.tsx:17`, and `frontend/src/PublicApp.tsx:47`.
Diagnosis refers to the uncommitted `dev/public-theme-continuity` worktree based
on `690c767`; line anchors may move during the design reset.
Actual browser comparison: 1159×863 desktop, approved homepage versus rejected login.
Machine-local evidence:
`.agent-harness/browser-evidence/5c7d75ed-22d3-41db-bfc3-857daf5b8b6f/login-rejected-treatment-desktop.png`.
That gitignored evidence is not portable with a clone; capture fresh proof when
reviewing the prototype and attach appropriate public-safe evidence to its PR.
Numeric causes are source-derived; motion quality still needs moving-browser proof.

## Surface review: what should cover the field?

Mehul's follow-up reopens **surface treatment** on the homepage as well as public
pages for review. It does not approve changing the homepage's layout, narrative,
typography, glyph identity, pointer physics or scroll choreography. The three
returning reviewers (product, motion/UX and frontend feasibility) agree that the
previous proposal did not distinguish protective surfaces precisely enough.

| Current surface / source | Proposed treatment | Reason |
| --- | --- | --- |
| Homepage hero, chapter and closing copy; footer (`study.css`, `.study-solid`) | Transparent layout; localized protection for actual text/link clusters | Whole wrappers hide field in otherwise empty space. |
| Homepage artwork caption and navigation backing | Protect caption text and navigation controls; evaluate removing excess full-width backing | Avoid a visible strip cutting through the shared world; maintain legible navigation. |
| Homepage walkthrough (`.study-demo-surface`) | Keep a stable, explicit product surface | Code, output and tutor conversation should read as one usable product demonstration. |
| Login/signup/reset intro, form wrapper and full-height canvas mask (`public-page.css`) | Remove broad masks; centered content with local text/control protection | The environment should surround the form, not survive only in edge slivers. Inputs stay solid. |
| Legal/support/comparison headings and broad reading wrappers | Transparent section layout; paragraph/heading-cluster protection with open section intervals | Keep sustained reading safe without turning the whole page into an opaque slab. |
| Discovery hero/main shells (`discovery-theme.css`) | Remove broad shell backing; preserve authored grouping | Expose real space between sections and cards without adding artificial whitespace. |
| Discovery course cards, method articles, notes, code and tables | Retain useful local grouping; distinguish clickable cards from noninteractive articles | Shared `.course-card` styling does not mean every item is interactive. Do not add false hover affordances. |
| Share outer artifact/recovery wrappers (`SharePage.tsx`) | Remove redundant outer backing where local protection suffices; retain actual code/artifact panel | Avoid nested slabs. Preserve protection throughout the existing opacity/scale reveal, not just at rest. |
| Errors, loading and footer states | Same localized material rules; status and actions remain immediately readable | No separate visual language for exceptional states. |

### Material contract

1. **World:** one near-black base and a connected, living glyph field.
2. **Layout:** ordinary alignment/spacing wrappers are transparent, not cards.
3. **Reading:** small protected text/control clusters have an opaque core and a
   short, feathered outer transition where needed. Do not fade directly under
   letters, create per-line stripes, or replace visible slabs with equally large
   invisible rectangular holes.
4. **Objects:** inputs, buttons, active states, real code/output, tables and the
   demo retain stable surfaces. Clickable collections keep recognizable boundaries
   and keyboard focus. Surface reduction must not remove information hierarchy.

Compose particles in connected available space **first**; protection is a safety
net for motion near content, not a substitute for composition. Do not maximize
transparency as a metric. At dense text, small screens, zoom or an open keyboard,
readability wins; do not force extra scrolling merely to exhibit more particles.

**Rejected defaults:** blanket transparency (moving glyphs behind text), frosted
glass everywhere (the same rectangles with moving blur), giant central exclusion
zones (the rejected edge-only field), and a new particle collision/obstacle solver.
Subtle local backing is the first prototype, not an assertion that its appearance
has already passed review.

### Evidence and acceptance

In-app inspection at 1280×720 confirmed opaque homepage copy/caption wrappers and
the purposeful walkthrough surface; the actual **02 Ask** demo was exercised.
Comparison and discovery were also inspected, including navigation to the real
course-card collection. These are current-state observations, not validation of
the proposed materials. Source review covers the remaining wrappers listed above.
The homepage hero-copy box measured 640×470 and its caption backing 700×17 in this
viewport: paint hides the complete rectangles, not only their text. Shared base
color can conceal the rectangle's outline without restoring the field behind it.

The first approval comparison must show the unchanged homepage beside the local
proposal, plus centered login: idle, scroll, pointer circles across edges and soft
release. Check visible continuity **and** text contrast; no rectangular cutouts,
halos, shimmer, clipped focus or glyphs leaking through code. Include phone,
200%/400% zoom, wrapped/long text, expanded errors, keyboard, reduced motion,
slow graphics and failure fallback. Verify the share reveal separately before
propagating its treatment. Screenshots alone cannot establish moving readability.

## Shared design rules

- One visual world, one maintained renderer/interaction model, no new animation
  engine, paid service, AI-generated asset or reference-site code copied into the repo.
- Recognizable foreground glyphs plus persistent distant particles. Preserve size,
  depth and color variation; do not reduce the whole scene to faint edge dust.
- Protect actual text, controls, focus outlines and expanded errors using the
  material contract above. Measured composition clearances must not become broad
  invisible holes or a full-height center strip.
- Do not solve every page with a floating illustration or identical loop. A shape
  must explain the composition or the learning context, not merely fill space.
- Forms, reading and navigation work immediately. Motion never gates entry, fakes
  progress, moves a control away from the pointer or reacts to credentials.
- Touch scrolling and text selection stay native. No scroll-jacking, trapped drag
  gestures, forced introductory delays or required decorative interaction.
- Existing public copy, claims, concessions, CTAs, auth handlers, return targets,
  authorization, lesson content, metadata and internal workspaces remain unchanged.

## Login study: options and recommendation

| Option | Composition | Decision |
| --- | --- | --- |
| Open code contours | Loose `< >` strands belong to one surrounding field; the form is its center | Recommended study: strongest connection to the existing homepage motif. |
| Living clearing | A distributed field flows around a form-sized clear region, without a stable contour | Fallback if contours feel decorative or overbearing; must not repeat the rejected dust treatment. |
| Separate chapter moments | Above/below-form shapes respond to scrolling | Do not lead with this: desktop login should not gain unnecessary scrolling or another hero section. |

The recommended study must **not** look like two side illustrations or a rigid
box enclosing a form. Use the homepage's code topology as loose connected material:
wide surrounding space, visible upper/lower connections, dimensional depth and
responsive local movement. The form stays centered at its current usable width.
If the available viewport cannot support that composition, recompose it—do not
crop it into slivers or shrink glyphs into illegibility.

### Behavior storyboard

1. **Homepage → login:** retain the living background while content changes. Glyphs
   settle toward the login composition; no empty-canvas flash or full-screen scene
   replacement. The form does not wait for the particles to finish.
2. **Direct load:** correct canvas and an intentional static starting composition
   appear before the graphics download. First animated frame joins that composition,
   avoiding an unrelated scatter → sudden shape jump. Graphics failure retains it.
3. **Idle:** preserve the homepage's gentle dimensional motion and distant field.
   Do not introduce an automatic 20-second shape carousel or periodic pulse just to
   prove something is animated. Judge presence at actual viewing size.
4. **Pointer:** curved strokes carry nearby glyphs into a visible swirl; release
   retains momentum and returns softly. The surrounding field—not a tiny invisible
   hit area—is responsive. Entering a form stops new forces, not existing momentum.
5. **Typing, validation, submission:** inputs remain stable and legible. No password
   influence on the scene, validation checkmark sculpture, red-particle error storm,
   focus-triggered global dimming, or login-success choreography added to the flow.
6. **Signup/reset navigation:** preserve material, clock and motion; update scene
   clearances when content grows. History, return targets and focus retain their
   intended behavior. Background persistence must not preserve credentials across
   routes or defeat the forms' existing cleanup.
7. **Phone/virtual keyboard:** use available upper/lower and surrounding space with
   readable glyph sizes. Keep native scrolling and inputs visible; keyboard resize
   must not restart/recenter the scene violently or cause horizontal overflow.
8. **Reduced motion:** equally intentional static composition, not a blank page.
   Preserve the approved preference behavior. A new pause button is **not approved**.
   Review the applicable motion-accessibility requirements separately; never claim
   reduced-motion handling alone proves all WCAG motion criteria are satisfied.

## Other page families, after login approval

| Family | Purpose and composition | Must remain primary |
| --- | --- | --- |
| Signup/reset/callback | Same welcoming environment; composition follows changing form/recovery bounds | Current authentication, errors and recovery actions |
| Privacy/terms | Field continues around headings and section intervals; meaningful reading contours can gather between sections | Legal text, anchor navigation and sustained readability |
| Support | Same environment and recognizable orientation; no service-status-like animation | Existing help and contact paths |
| Why not ChatGPT | Continuous material accompanies argument and section transitions; no extra product demo | Balanced comparison and existing concessions |
| Catalog/course/lesson discovery | Shared glyph material connects overview, course structure and authored reading | Complete static content, code/tables, canonical metadata and links |
| Public share | Field supports the real learner artifact; coordinate with its existing reveal rather than layering competing shows | Actual code, accomplishment and share controls |
| 404/unavailable | World remains present; composition feels settled and recoverable, never broken or punitive | Clear error meaning and immediate navigation |

The latest phone review authorizes extending the same system to these families.
Validate representative reading, discovery and share pages before publication;
any different layout model or new motion language still requires approval.

## Engineering strategy and constraints

**App-rendered routes:** use one lazy, presentation-only motion host above the
changing PublicApp/FullApp and content-Suspense boundary. Pages register a scene
descriptor (composition targets, content-cluster bounds and readiness),
not their own WebGL renderer. Keep GPU resources, seeded identities, elapsed time
and pointer springs stable; blend updated targets without recreating the engine.
Resolve and release route anchors on navigation, not just window resize. Late route
registration must not overwrite a newer scene. Unregister on workspace entry and
dispose/pause resources without decorating or changing internal pages.

Extract the existing homepage scene solver as the unchanged story descriptor.
Maintain its choreography, demo controls, density rules and pointer response as the
golden reference. Only the separately approved surface treatment may change;
renderer extraction is not permission for a broader homepage redesign. React's lifetime model explains why
the host must survive route replacement: [preserving state](https://react.dev/learn/preserving-and-resetting-state).

**Paint and protection:** make ownership explicit: base → field → transparent route
layout → local protective backing → text/controls/focus. Hoisting the canvas behind
today's opaque route roots would hide it. Use ordinary CSS backing/pseudo-elements
first; they follow wrapping, errors and transforms without per-frame layout reads.
They must not intercept input or obscure focus. Keep share code protected during
its existing `.55` opacity entry and parent scaling, using independent backing if
necessary. A stationary final-state mask is not proof for an animated artifact.

Keep placement, visibility and interaction physics separate. Cache scene bounds
on registration, resize, font readiness and content resize; never read DOM geometry
per particle/frame. Do not add obstacle forces or shader-only position avoidance:
CPU pointer projection and shader placement must remain consistent. Only if the
CSS prototype fails, evaluate visibility-only shader fading after final projection,
accounting for full glyph/glow size. That is a fallback experiment with extra
scroll/DPR/zoom risk, not a second simultaneous implementation.

**Static discovery:** its normal links perform document navigation. Preserve that
architecture and no-JavaScript content; reuse scene definitions and a deterministic
first-paint composition with matched arrival. Do not promise cross-document GPU
state continuity, hijack links, or convert discovery to an SPA for decoration.

**Budget and recovery:** retain bounded particle pools, area-based density, DPR cap
1.5, hidden-tab suspension, lazy graphics and context-loss recovery. Measure frame
times during pointer bursts and navigation before raising counts. Preserve current
production asset budgets and public-entry avoidance of eager editor/admin downloads.
No exact count or timing is a design success criterion by itself.

## Review decisions and open questions

- Motion/UX proposed open contours, a living clearing and chapter moments; product
  agreed the world must surround the task, not compete with it. Frontend review
  judged reuse feasible; persistent-host extraction, first-paint matching and
  keyboard recomposition are prototype risks, not demonstrated results.
- Do **not** adopt a periodic 20-second loop suggested during review; preserve the
  approved interaction language first. Do **not** introduce the suggested pause
  control without Mehul's approval.
- Product review correctly separates perceptual continuity from literal GPU-state
  persistence. Persist the SPA host where useful; use coherent new-document arrival
  for static discovery. Do not expand routing scope to chase an illusion.
- Generic skill-generated font/palette/horizontal-scroll recommendations were
  rejected: the approved homepage already supplies the brand. Skills inform the
  design-review and accessibility checklist, not a replacement aesthetic.
- Motion accessibility requires explicit review: W3C distinguishes
  [automatic movement](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html)
  from [interaction-triggered animation](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html).
  Do not cite another site's missing control as compliance evidence. Resolve any
  needed user-facing policy change before implementation/shipping; no silent
  motion restriction or new control.

**D1 — motion policy (release design approved; conformance not established):** this prototype
retains the existing automatic, indefinite low-speed drift and intentional pointer/
keyboard response; it adds no periodic shape carousel, delay, or new motion control.
Reduced motion remains static. W3C 2.2.2 covers automatic motion over five seconds
alongside other content, so absence of a pause control is not evidence of compliance.
The owner approved retaining the current design after the phone preview was
restored and the pending motion decision was surfaced. No new control or motion
restriction is introduced. This is product approval, not an accessibility ruling
or permission to make an unsupported WCAG claim.

September 8 standards follow-up: the [normative definition of mechanism](https://www.w3.org/TR/WCAG22/#dfn-mechanism)
allows platform/user-agent mechanisms, so a visible in-page pause button is not
inherently required. However, W3C's [C39 technique](https://www.w3.org/WAI/WCAG22/Techniques/css/C39)
is expressly sufficient for interaction-triggered motion (2.3.3), not a blanket
determination for automatic animation (2.2.2). The working group's exact question
about OS Reduce Motion and 2.2.2 remains [open in issue 4319](https://github.com/w3c/wcag/issues/4319).
An open discussion is evidence of uncertainty, not a ruling that this implementation
passes or fails. Our live preference-change checks prove that the artwork stops
and content remains usable; they do not settle that interpretation. Further generic
searching is unlikely to resolve this gate. Preserve the approved no-new-button
design; obtain an explicit release disposition acknowledging the limitation, or
approval for a different mechanism. Do not change the Mac's system preferences
or substitute another site's design as conformance evidence.

For subsequent proposed behaviors, the implementing agent records whether each proposed
behavior is automatic or deliberately activated, its duration, preference response
and applicable accessibility criterion. Review this before implementing the motion
study. Mehul approves any resulting visible control or changed motion policy before
it is applied. The current no-new-pause-button direction is not permission to claim
unproven compliance; an unresolved conflict must be surfaced, not silently worked
around. This decision belongs here rather than becoming a fabricated confirmed bug.

## Approval and delivery gates

- [x] Mehul approves the revised material contract and study direction ("Approved").
- [x] D1 motion-policy classification reviewed for the local prototype; no policy change.
- [x] Owner approved current release design; preserve D1 limitation without claiming conformance.
- [x] Local direction approved for extension after Mehul's phone login/signup review: wrapper reduction,
      protected text/controls and solid demo, with unchanged homepage story/physics.
      Navigation seam correction is explicitly required before readiness.
- [x] Complete moving login study and persistent-host work; desktop/phone evidence is in the delivery ledger.
- [x] Mehul reviewed login/signup in his phone browser and authorized extension;
      final moving-browser regression verification remains a separate gate.
- [x] Extend the agreed composition to signup/reset/callback; test real input,
      keyboard/focus, expanded errors, interruption/recovery, browser history,
      reduced motion, graphics failure and phone widths. Owner phone acceptance
      supplements emulation; this is not exhaustive device/virtual-keyboard proof.
- [x] Verify the authorized reading/discovery/share extension in the actual local browser.
- [x] Complete scoped public-route and adjacent-workspace local checks; production verification remains separate.
- [x] Final source/deterministic/browser/harness gates passed for implementation `ee325f3`.
- [ ] Separate PR: brief before-to-after journeys, green CI **and** clean Codex
      review on final head, then authorized merge, deployment and production proof.

Functional checks are necessary but cannot override a failed visual review. Keep
the existing [delivery checklist](PUBLIC_THEME_CONTINUITY.md) as the single finding
ledger; this document owns the proposed design reset, not duplicated fix status.
