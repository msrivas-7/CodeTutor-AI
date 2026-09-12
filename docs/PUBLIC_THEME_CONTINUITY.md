# Public theme continuity audit

Last updated: September 12, 2026

## Status

- [PR #51](https://github.com/msrivas-7/CodeTutor-AI/pull/51) merged as
  `d454e56f2d5767b078f956d795488603116af009`.
- Production release
  [34692580750](https://github.com/msrivas-7/CodeTutor-AI/actions/runs/34692580750)
  passed and `release.json` returned the exact merge SHA.
- UX-198 through UX-229 are shipped. The focused production browser pass covered
  the changed and adjacent public journeys rather than replaying the full
  historical audit.
- UX-230 was discovered during that pass and is being repaired separately: a
  tab kept open across a deployment could request a removed lazy chunk and show
  a blank canvas until the learner manually reloaded.

## Approved product direction

The homepage and every logged-out surface belong to one living code-glyph world:
near-black canvas, contextual formations, open composition around text, and
solid forms/code/controls where readability needs protection. Auth stays
centered. The anonymous editor remains a focused workspace. OS Reduce Motion
gets a still composition; there is no separate pause control and phones retain
the experience.

Material changes to this visual language, layout model, motion, interaction,
information architecture, or product narrative require owner approval. See
[the design plan](PUBLIC_BRAND_CONTINUITY_DESIGN.md) and
[the design system](DESIGN_SYSTEM.md).

## Production verification

The in-app browser checked the exact deployed release on desktop and narrow
viewports:

- Homepage artwork visibly advances, the primary lesson CTA works, and 404
  recovery returns home.
- Login and signup remain centered; auth controls, copy, glyphs, and footer are
  readable without horizontal overflow.
- Privacy, Terms, Support, Why not ChatGPT, and the public lesson catalog retain
  the shared theme and readable long-form text without document overflow.
- The anonymous lesson opens from the homepage. `?` opens shortcut help away
  from text input, typed `?` stays in the Tutor composer, Ctrl+K focuses the
  Tutor, and Escape closes help.
- The sign-up continuation modal is fully contained. A physical Escape during
  a 900×720 viewport reflow closes it and restores focus to “Sign up to save.”
- Invalid/retired public shares show a themed recovery state with working
  navigation.

The first anonymous-lesson attempt came from a homepage tab loaded before the
release. Its old bundle requested a deleted chunk and left `#root` empty; reload
immediately recovered onto the exact deployed release. This is UX-230, not a
failure of the current fresh route. Vite documents this deployment-skew class
and its `vite:preloadError` recovery event in
[Building for Production](https://vite.dev/guide/build.html#load-error-handling).

Browser wheel/viewport emulation does not prove physical iPhone swipe momentum
or virtual-keyboard feel. Owner phone acceptance for the approved motion
experience was completed against the local phone gateway before PR #51.

## Finding checklist

This is the single shipment-status list. “Production” means the fix is included
in the exact deployed release; the bounded interactions replayed there are
listed above. “Local” means implemented and validated but not yet deployed.

| Status | Finding | Outcome |
| --- | --- | --- |
| [x] Production | UX-198 | Auth is centered; the detached split-layout sculpture is gone. |
| [x] Production | UX-199 | Initial, loading, and settled public colors remain aligned. |
| [x] Production | UX-200 | Main-content focus is visible on the readable heading. |
| [x] Production | UX-201 | Trust dividers and contact links remain readable. |
| [x] Production | UX-202 | New public navigation starts at the destination top. |
| [x] Production | UX-203 | Privacy/trust routing selects the correct content. |
| [x] Production | UX-204 | Invalid shares show an honest, recoverable unavailable state. |
| [x] Production | UX-205 | Unknown routes show themed 404 recovery and real error status. |
| [x] Production | UX-206 | Public surfaces share one persistent living motion world. |
| [x] Production | UX-207 | Disabled auth controls stay opaque and legible. |
| [x] Production | UX-208 | Auth content stays bounded on very large displays. |
| [x] Production | UX-209 | Graphics failure retains a usable reload recovery path. |
| [x] Production | UX-210 | Header, wordmark, and action geometry stay aligned. |
| [x] Production | UX-211 | Reduce Motion settles reveal state without replaying it. |
| [x] Production | UX-212 | Homepage explanation is open; functional surfaces stay solid. |
| [x] Production | UX-213 | Support action states retain accessible contrast and focus. |
| [x] Production | UX-214 | Lazy public loading preserves navigation and focus. |
| [x] Production | UX-215 | Long inline lesson code wraps without phone-wide overflow. |
| [x] Production | UX-216 | Empty concept panels are omitted. |
| [x] Production | UX-217 | Mixed text/code objective chips wrap as one flow. |
| [x] Production | UX-218 | Direct `/#study-demo` entry reaches the walkthrough correctly. |
| [x] Production | UX-219 | Homepage loading handoff retains skip/home/main focus. |
| [x] Production | UX-220 | Mobile homepage typography stays consistent across journeys. |
| [x] Production | UX-221 | Public-share comments retain readable contrast. |
| [x] Production | UX-222 | Auth supporting copy uses one consistent type recipe. |
| [x] Production | UX-223 | Share reveal finishes within five seconds without layout jumps. |
| [x] Production + owner | UX-224 | Phone formation pacing gives the artwork room to read. |
| [x] Production | UX-225 | First-commit dialogs own Escape and restore focus safely. |
| [x] Production | UX-226 | Direct public entries use the lightweight route tree. |
| [x] Production | UX-227 | Product/auth navigation cancels deferred hydration immediately. |
| [x] Production | UX-228 | Public path matching handles case, slashes, and guarded decoding. |
| [x] Production | UX-229 | Anonymous lesson restores `?` and Ctrl/Cmd+K without acquisition-page shortcuts. |
| [ ] Local | UX-230 | Recover one time from a removed lazy chunk after deployment, without a reload loop. |

## Evidence

Machine-local screenshots remain gitignored under
`.agent-harness/browser-evidence/`. The focused production set is in
`production-d454e56/` (`homepage-desktop.jpg`, `login-desktop.jpg`,
`privacy-mobile.jpg`, `anon-lesson-desktop.jpg`, and
`signup-modal-desktop.jpg`). Harness sessions and earlier evidence retain the
detailed chronology; this document intentionally stays compact.

## Separate follow-up

Automatically choosing E2E shard count from trusted runtime history, measured
setup cost, and safe concurrency is approved as a separate PR. It must preserve
the full suite, use a stable fallback, and prove a meaningful gain in real runs
before activation.
