# CodeTutor design system

The homepage anchors the public brand. Shared decisions must have one owner;
page-specific composition must not become a second theme. This guide describes
the local implementation, not evidence that its latest visual changes are released.
See [the public continuity ledger](PUBLIC_THEME_CONTINUITY.md) for verification.

## Architecture and ownership

| Layer | Source of truth | Responsibility |
| --- | --- | --- |
| Public values | `frontend/src/design-system/tokens.ts` | Palette, named surface/text roles, shared header/control sizing, reading protection and field arrival duration |
| First paint | `frontend/scripts/vitePluginDesignTokens.ts` | Inline the same token output into Vite HTML before the bootstrap; no extra request or runtime theme generator |
| Static documents | `frontend/scripts/discoverySite.ts` | Inline the same tokens and derive browser chrome from the same canvas value; works without JavaScript |
| Shared public materials/components | `frontend/src/features/marketing/public/theme.css`, `frontend/src/features/marketing/public/PublicPage.tsx`, `frontend/src/auth/AuthShell.tsx` | Navigation geometry, display-copy treatment and reusable page/form boundaries |
| Public family composition | `frontend/src/features/marketing/public/public-page.css`, `frontend/src/features/marketing/public/discovery-theme.css`, `frontend/src/features/marketing/study/study.css` | Reading widths, editorial layouts and responsive arrangements; consume roles instead of copying values |
| Shared motion | `frontend/src/features/marketing/public/PublicMotionWorld.tsx`, `frontend/src/features/marketing/study/ParticleField.tsx`, adjacent scene/geometry modules | Retained renderer and existing motion physics; page descriptors supply composition, not another engine |
| Workspace themes | `frontend/src/index.css`, `frontend/tailwind.config.js` | Existing light/dark semantic colors and typography; unchanged by the public palette migration |

The dependency direction is **values → purpose-based roles → materials/components
→ page composition**. `--study-*` names remain compatibility aliases, not another
palette. Tailwind's space-separated RGB channel variables and ordinary CSS colors
are derived from the same public values. Existing light-study overrides are
centralized too; this does not introduce a new user-facing theme control.

This is an incremental system, not a claim that every legacy style is migrated.
Workspace roles already centralize theme colors. Bespoke typography, spacing,
shadows, syntax colors, graphics material constants and component motion still
have existing owners. Migrate those by a coherent, browser-verified slice when
needed; do not copy them into a second registry or silently restyle the workspace.

Public pages own their `.public-surface` typography boundary, not the initial
entry router: direct loading, auth-to-home navigation and history must render
the same fonts. Public auth dividers and recovery instructions share the scoped
supporting-copy recipe; workspace signup retains its own existing styling.
Browser share comments consume the readable faint text role. The image export's
fixed palette remains a separate output contract, not a second web theme.

## Surface rules

- **World:** the shared near-black canvas and living glyph field.
- **Layout:** transparent spacing/alignment wrappers. A layout box is not a card.
- **Display copy:** large, brief headings can use `brand-display-copy`; letterform
  shadows and a local elliptical fade avoid painting a hard rectangle. Currently applied only to
  the walkthrough heading as a local visual experiment. Moving readability needs
  actual-browser acceptance before broader adoption.
- **Reading:** dense prose uses a solid canvas core with the shared
  `--brand-reading-shadow` edge. Do not put animated glyphs through paragraphs.
- **Objects:** code, tutor content, controls, tables and actionable cards remain
  stable surfaces. Do not make everything transparent or apply glass everywhere.
  Public filled actions use `public-action`; `public-action--accent` swaps its
  resting and hover fills while keeping the paired foreground. Do not combine
  page-level link-hover colors with independent workspace button utilities.

The walkthrough keeps its code/tutor body and controls opaque. Its outer layout
and explanatory interval are open; actual explanation text keeps local backing.
No content, demo stages, geometry, navigation or particle physics change with this
material experiment. Focus outlines must remain outside protective paint layers.

Mobile story pacing belongs to `study.css`: artwork reserves bounded stable-
viewport space so the scroll-driven renderer can form, linger and disperse before
reading clusters. Chapter/closing frames share `--study-phone-art-space`; the
opening has its own larger interval. Do not shrink these to decorative icons or
compensate by slowing pointer physics or intercepting native scroll. Validate
short/tall phones, reverse scrolling, reduced motion and physical swipe feel.

## How to make a change

1. Read the approved brand direction and start the harness. Material redesigns
   need Mehul's approval; token centralization is not permission to redesign.
2. If a decision is shared, change its existing token or component. Add a token
   only for a real reusable role, not every arbitrary number. Distinguish surfaces
   such as `field` and `object` even if they later share a value.
3. Components consume CSS roles such as `var(--study-ink)` or Tailwind `text-ink`.
   Do not import the token generator into React or copy raw palette values into
   route files. The build owns serialization and first-paint injection.
4. Do not change a role's meaning between themes. Keep text, control, focus,
   disabled, hover, error and loading states coherent. Component behavior and
   authorization remain outside the theme layer.
5. Run token/public-theme unit tests and build/asset budgets. The public E2E
   contract tests mutate tokens to prove real SPA and static consumers inherit
   them, check first paint with the app blocked, and protect workspace isolation.
6. Rebuild local services; inspect affected routes plus adjacent consumers in the
   actual browser. Include motion, reduced motion, keyboard/focus, long/error
   content, narrow/large displays and reload. Automated checks support, but never
   replace, this gate. Update the finding ledger with exact evidence and limits.

Do not create a catch-all configurable component, another CSS framework, or a
global selector that changes every button/dialog. Reuse existing components when
semantics and behavior match; extract a primitive only when duplication warrants it.
For a future workspace migration, preserve values first, verify dark/light states,
then propose any actual visual change separately.

## Research and tradeoffs

[IBM Carbon's theming model](https://carbondesignsystem.com/elements/themes/overview/)
uses stable purpose-based token names whose values vary by theme, including color,
spacing and typography. That is the basis for role ownership here, not a proposal
to adopt Carbon's visual style or component package.

[Adobe Spectrum's design tokens](https://spectrum.adobe.com/page/design-tokens/)
also separate reusable values and their semantic use. We apply that separation
without adding an unused catalog of hundreds of tokens.

[DTCG 2025.10](https://www.designtokens.org/tr/2025.10/format/) standardizes a token
interchange format, including types and aliases; it is a Community Group report,
not a W3C Recommendation or a prescribed application architecture. Our small
TypeScript source is **not claimed to be DTCG-format JSON**. It fits the current
single web-codebase build. If design-tool/native exports become real requirements,
migrate the canonical source to DTCG with generated consumers rather than maintain
two editable copies. No new dependency or token service is needed now.
