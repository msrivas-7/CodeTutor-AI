# Live-browser UX evidence template

Use this after exercising the real product through the Browser or Chrome
control skill, or through Computer Use when the finding requires a native
browser such as Safari. Standalone Playwright, unit tests, DOM scripts, source
review, and screenshots captured without interaction are useful supporting
checks but do not satisfy this gate.

Store screenshots below `.agent-harness/browser-evidence/<session-id>/`; this
keeps potentially account-specific UI evidence out of Git. Never capture or
record passwords, OAuth callback codes, private tokens, or sensitive user data.

Use `--tool computer-use:computer-use --browser "Safari native macOS"` for
authentic Safari verification. The evidence narrative must identify the native
browser and platform; never label Safari evidence as Chromium merely to satisfy
the harness.

## Finding-level record

Run once after each finding is fixed. Replace every placeholder with observed
evidence; do not describe intended behavior.

```sh
node scripts/agent-harness.mjs browser-audit \
  --session <session-id> \
  --level finding \
  --findings UX-001 \
  --tool browser:control-in-app-browser \
  --browser "In-app Chromium" \
  --environment local \
  --url "http://localhost:5173/real-entry-point" \
  --entrypoint "How the learner reached the changed surface" \
  --happy "Actions performed and visible successful result" \
  --failure-recovery "Failure or interruption exercised and recovery observed" \
  --adversarial "All relevant repeat, interruption, collision, boundary, stale-state, and misuse paths attempted, with observed results" \
  --viewports "1152x863 dark; 390x844 light" \
  --focus "Keyboard path, focus destination, Escape/back behavior, and announcement result" \
  --screenshots ".agent-harness/browser-evidence/<session-id>/UX-001-result.png" \
  --result pass \
  --notes "Timing, console, visual-polish, or residual observations"
```

Record `--result fail` when the browser exposes a defect. The harness creates a
pending incident; fix it, retest it, and classify the incident before finish.
Never overwrite a failed record with a passing claim.

## Phase-level record

After every finding has its own pass, stage the final phase and exercise the
whole group together. The phase audit must be recorded after the last product
change; its workspace fingerprint must match the staged commit exactly.

```sh
node scripts/agent-harness.mjs browser-audit \
  --session <session-id> \
  --level phase \
  --tool browser:control-in-app-browser \
  --browser "In-app Chromium" \
  --environment local \
  --url "http://localhost:5173/phase-entry-point" \
  --entrypoint "Complete phase journey from the real product entry" \
  --happy "All repaired findings exercised together in the intended journey" \
  --failure-recovery "Combined interruption, reload, error, or back-path result" \
  --adversarial "All relevant cross-feature collisions and hostile sequences attempted, with observed results" \
  --viewports "Required phase viewport/theme/browser matrix" \
  --focus "End-to-end keyboard, focus, modal, and announcement result" \
  --screenshots ".agent-harness/browser-evidence/<session-id>/phase-final.png" \
  --result pass \
  --notes "Console state, timing, visual cohesion, and remaining limitations"
```

The phase record automatically covers the findings declared when the session
started. If the final code changes afterward, repeat the combined live-browser
pass and record new phase evidence.

Adversarial coverage is risk-based, not count-based. A simple static copy change
may have one meaningful hostile check; asynchronous, modal, persistence, auth,
AI, or multi-surface work will normally require several. The evidence must name
the relevant possibilities considered and the ones actually exercised.

## Legitimate non-browser bypass

Use a bypass only for a change with no browser-observable effect, such as a
repository-only documentation or harness contract update. Name the concrete
change and why no user flow can be affected:

```sh
node scripts/agent-harness.mjs start \
  --feature "Repository-only contract" \
  --scope infra \
  --browser-impact none \
  --browser-bypass "Changes only tracked agent instructions and CLI tests; no application runtime, API response, content, styling, or browser behavior changes."
```

`tests pass`, `small change`, `backend only`, `no UI`, and lack of time are not
valid reasons. A session that owns any `UX-###` finding cannot bypass.
