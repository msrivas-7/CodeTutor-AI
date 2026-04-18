# Development

## Local Setup

```bash
# Install dependencies for type-checks / hot-reload
(cd frontend && npm install)
(cd backend  && npm install)

# Type-check
(cd frontend && npx tsc --noEmit)
(cd backend  && npx tsc --noEmit)

# Tests
(cd frontend && npm test)
(cd backend  && npm test)

# Frontend only (backend in Docker)
docker compose up -d backend
cd frontend && npm run dev
```

## Configuration

All optional — defaults work for local use. See [.env.example](../.env.example).

| Variable | Default | Purpose |
| --- | --- | --- |
| `SESSION_IDLE_TIMEOUT_MS` | `120000` | Reap idle sessions after this |
| `SESSION_SWEEP_INTERVAL_MS` | `45000` | Sweeper interval |
| `RUN_TIMEOUT_MS` | `10000` | Wall-clock per `docker exec` |
| `RUNNER_MEMORY_BYTES` | `536870912` | Per-container memory (512 MB) |
| `RUNNER_NANO_CPUS` | `1000000000` | Per-container CPU (1 CPU) |
| `CORS_ORIGIN` | `http://localhost:5173` | Frontend origin |

## Direct Docker Compose

```bash
docker compose up --build    # start (Ctrl-C to stop)
docker compose down           # teardown
```

## Design Tokens

All colors in the frontend use semantic Tailwind tokens, never raw palette names:

| Semantic | Use for |
| --- | --- |
| `bg` / `panel` / `elevated` | Surface layers (page, panel, raised card) |
| `ink` / `muted` / `faint` | Primary / secondary / tertiary text |
| `border` / `borderSoft` | Dividers and outlines |
| `accent` / `accentMuted` | Primary interactive elements (focus rings, CTAs) |
| `success` | Completion, validation pass, "OK" states |
| `warn` | Compile errors, "worth your attention" nudges |
| `danger` | Runtime errors, destructive actions |
| `violet` | Guided learning, practice mode, tutor walkthroughs |

These resolve to CSS variables in [`src/index.css`](../frontend/src/index.css) and switch automatically between dark and light themes. **Do not** use `text-green-400`, `bg-red-500/15`, or any raw `{color}-{shade}` class — always use the semantic token so light-theme and re-theming stay correct.

Contrast floor: all text on `panel` / `bg` meets WCAG AA (4.5:1). If you introduce a new foreground/background combination, check it with a contrast tool before shipping.

## Dev Profile Switcher

A dev-only "cheat code" system for manually verifying UI states without grinding through lessons. Entire system lives under `frontend/src/__dev__/` and is gated on `import.meta.env.DEV` so it's tree-shaken out of production bundles.

**How to use:**

1. Press **`Cmd/Ctrl + Shift + Alt + D`** anywhere in the app to toggle dev mode. A violet toast confirms enable/disable. The first enable captures a snapshot of your real user state so you can always get back to it.
2. Open **Settings** (gear icon). With dev mode on you'll see a **General | Developer** tab bar at the top.
3. In the **Developer** tab, pick a profile from the dropdown and click **Apply**. The app reloads into that profile's state.
4. Same shortcut again exits the active profile, restores the real snapshot, and hides the Developer tab.

**Profiles:**

| # | ID | Frozen | What it's for |
| --- | --- | --- | --- |
| 1 | `fresh-install` | ✓ | Welcome spotlight → dashboard banner → lesson 1 nudge → workspace tour |
| 2 | `welcomed-not-started` | ✓ | Dashboard "Ready to start coding?" banner |
| 3 | `first-lesson-editing` | ✓ | CoachRail edited-no-run nudge |
| 4 | `mid-course-healthy` | ✓ | Dashboard happy-path — progress bar, "Next up", activity feed |
| 5 | `stuck-on-lesson` | ✓ | CoachRail many-fails nudge |
| 6 | `needs-help-dashboard` | ✓ | Dashboard Review card — 3 shaky-mastery entries with reason pills |
| 7 | `capstones-pending` | ✓ | Enter `capstone-word-frequency` cold — Examples + Run examples flow |
| 8 | `capstone-first-fail` | ✓ | Broken `count_words` pre-seeded — FailedTestCallout + 2nd-fail "Ask tutor why" gate |
| 9 | `all-complete` | ✓ | All-green dashboard + celebration replay |
| 10 | `sandbox` | ✗ | Free-play — persists across reloads under its own snapshot slot |

**Frozen vs sandbox:**

- **Frozen** profiles re-apply their canned seed on every page load (via the pre-hydration `bootstrap.ts` that runs before any Zustand store reads localStorage). Interact freely — the next refresh resets everything to the seed. Great for verifying one UI state repeatedly without drift.
- **Sandbox** persists under `__dev__:sandboxSnapshot`. Switch away and back; your progress is preserved. Use for multi-step walkthroughs.

**Safety:**

- An allow-list in `applyProfile.ts` ensures OpenAI keys, theme, and UI size preferences are never touched when profiles swap.
- Your pre-dev-mode state is captured once under `__dev__:realSnapshot`. Exiting dev mode always restores it.
- Snapshot → clipboard and Paste snapshot (Developer tab) round-trip ad-hoc bug repro states. Paste validation rejects any key outside the allow-list.

**Keyboard shortcut implementation note:** the listener uses `event.code === "KeyD"` (not `event.key`) because on macOS the Option modifier transforms `e.key` into a unicode symbol (`Option+D` → `∂`). The listener is registered with `capture: true` on `window` so it fires before Monaco's own keydown handlers.

**Adding a profile:** edit [`frontend/src/__dev__/profiles.ts`](../frontend/src/__dev__/profiles.ts). Each profile returns a map of localStorage key → serialized value from `seedStorage()`. Only keys matching `OWNED_PREFIXES` (`learner:v1:`, `onboarding:v1:`) are ever written; any other key is dropped at apply time. Add a matching case to [`profiles.test.ts`](../frontend/src/__dev__/profiles.test.ts) if the profile encodes an invariant worth asserting (e.g., "exactly N shaky entries").
