# Development

## Local Setup

```bash
# Install dependencies for type-checks / hot-reload
(cd frontend && npm install)
(cd backend  && npm install)

# Type-check
(cd frontend && npx tsc --noEmit)
(cd backend  && npx tsc --noEmit)

# Unit tests
(cd frontend && npm test)
(cd backend  && npm test)

# Content validation (frontend)
(cd frontend && npm run lint:content)       # schema + structural + concept graph
(cd frontend && npm run verify:solutions)   # runs every golden solution against its completion rules

# End-to-end tests (Playwright, mocked OpenAI; see e2e/README.md)
docker compose up -d
(cd e2e && npm install && npx playwright install --with-deps chromium && npm test)

# Frontend only (backend in Docker)
docker compose up -d backend
cd frontend && npm run dev
```

## Authoring lessons

See [CONTENT_AUTHORING.md](./CONTENT_AUTHORING.md) for the full guide. Quick reference:

```bash
# Scaffold a new lesson
(cd frontend && npm run new:lesson -- \
  --course python-fundamentals \
  --id my-lesson \
  --title "My lesson" \
  --description "One-line pitch." \
  --minutes 15 \
  --prereq previous-lesson)

# Add a practice exercise to an existing lesson
(cd frontend && npm run new:practice -- \
  --course python-fundamentals \
  --lesson my-lesson \
  --id my-exercise \
  --title "Exercise title" \
  --prompt "Learner-facing prompt" \
  --goal "What this reinforces" \
  --rule-style function)     # or stdout | file
```

Both scaffolders run `npm run lint:content` at the end — expect a few warnings on a fresh scaffold while you fill in objectives, concept tags, and completion rules.

CI runs `lint:content` and `verify:solutions` on every push. The `solutions-pass` job depends on `content-lint` and uses `python3` directly (no Docker), so it completes in ~15 seconds.

## Dev-only content health dashboard

When the frontend is running in dev mode (`npm run dev`), visit **http://localhost:5173/dev/content** for a per-lesson overview: order / rules summary / teaches + uses concept counts / content + solution presence / concept-graph issues. The route is gated on `import.meta.env.DEV` and tree-shaken out of production bundles.

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
| `EXECUTION_BACKEND` | `local-docker` | Execution backend impl (future: cloud variants) |
| `DOCKER_HOST` | `tcp://socket-proxy:2375` | Docker endpoint — set by compose so dockerode talks to the allowlisted socket proxy, not the raw socket |
| `AI_RATE_LIMIT_WINDOW_MS` | `60000` | Rate-limit window for `/api/ai/*` |
| `AI_RATE_LIMIT_MAX` | `60` | Max AI requests per window per `sid\|ip` bucket (unknown sids fall back to IP) |
| `SESSION_CREATE_RATE_LIMIT_WINDOW_MS` | `60000` | Window for `/api/session*` per-IP bucket |
| `SESSION_CREATE_RATE_LIMIT_MAX` | `30` | Max session lifecycle calls per window per IP |
| `MUTATION_RATE_LIMIT_WINDOW_MS` | `60000` | Window for `/api/project/snapshot` + `/api/execute*` per-IP bucket |
| `MUTATION_RATE_LIMIT_MAX` | `120` | Max mutation calls per window per IP |
| `DEBUG_PROMPTS` | unset | When `1`, the AI provider logs full system + user turn text. Leave unset; learner code would otherwise reach the backend log. |

## Direct Docker Compose

```bash
docker compose up --build    # start (Ctrl-C to stop)
docker compose down           # teardown
```

## Shared utilities

Reach for these before copy-pasting — each one exists because the same pattern was duplicated across ≥2 call sites.

### Frontend

| Module | What it gives you |
| --- | --- |
| `frontend/src/util/layoutPrefs.ts` | `usePersistedNumber(key, default)` and `usePersistedFlag(key, default)` — drop-in `useState` replacements that persist to localStorage and route quota errors to the warning banner. `clamp(n, [min, max])` + `clampSide(n, [min, max])` for splitter/panel sizing. |
| `frontend/src/util/timings.ts` | Named durations for values shared across files (`COACH_AUTO_OPEN_MS`, `RESUME_TOAST_MS`). Only add here when ≥2 callsites want the same semantic value. |
| `frontend/src/state/storageStore.ts` | `noteStorageQuotaError(err)` — React-free helper. Call from any `catch` around `localStorage.setItem`; sniffs `QuotaExceededError` + `NS_ERROR_DOM_QUOTA_REACHED` (Firefox) and flips the global banner flag. The banner itself (`StorageQuotaBanner`) is mounted once in `App.tsx`. |
| `frontend/src/components/SelectionPreview.tsx` | Shared "selected code context" chip used by the editor and guided tutor panels. |
| `frontend/src/features/learning/stores/progressStore.ts` → `updateLesson(lessonId, patch)` | Merge-patch a lesson's progress record. Prefer this over hand-rolled spreads. |

### Backend

| Module | What it gives you |
| --- | --- |
| `backend/src/services/execution/commands.ts` → `languageSchema` | The canonical `z.enum` over supported languages. Routes that accept a language parameter should import this rather than re-declaring the enum inline. |
| `backend/src/services/session/requireActiveSession.ts` | Route helper: `const session = requireActiveSession(res, sessionId); if (!session) return;`. Handles the 404 / 409 responses and returns a narrowed `ActiveSession` type (`containerId: string`, not `string \| null`) so downstream code reads the field without re-asserting. |
| `backend/src/services/execution/harness/registry.ts` | Per-language harness plug-in point for `function_tests`. Python and JavaScript registered today; new languages add a `HarnessBackend` implementation and register it. The harness runs learner code as a child subprocess and returns results inside an HMAC-signed envelope verified by `runHarness.ts` — see the "Harness trust model" bullet in [ARCHITECTURE.md](./ARCHITECTURE.md#guided-learning-system). |

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

| # | ID | Frozen | Scope | What it's for |
| --- | --- | --- | --- | --- |
| 1 | `fresh-install` | ✓ | — | Welcome spotlight → dashboard banner → lesson 1 nudge → workspace tour |
| 2 | `welcomed-not-started` | ✓ | — | Dashboard "Ready to start coding?" banner |
| 3 | `first-lesson-editing` | ✓ | Python | CoachRail edited-no-run nudge on Python `hello-world` |
| 4 | `mid-course-healthy` | ✓ | Python + JS | Multi-course dashboard happy-path — both courses in progress with "Next up" + activity feed |
| 5 | `stuck-on-lesson` | ✓ | Python | CoachRail many-fails nudge on Python `conditionals` |
| 6 | `needs-help-dashboard` | ✓ | Python + JS | Dashboard Review card — 3 shaky Python entries + 2 clean JS lessons for multi-course shape |
| 7 | `capstones-pending` | ✓ | Python + JS | JS fully complete, Python on `capstone-word-frequency` cold — Examples + Run examples flow |
| 8 | `capstone-first-fail` | ✓ | Python | Broken `count_words` pre-seeded on Python capstone — FailedTestCallout + 2nd-fail "Ask tutor why" gate |
| 9 | `all-complete` | ✓ | Python + JS | Both courses fully complete — all-green dashboard + celebration replay |
| 10 | `sandbox` | ✗ | — | Free-play — persists across reloads under its own snapshot slot |

The **Scope** column is a signal to screenshot authors: narrative-specific Python profiles stay Python-only because their story is tied to a specific Python lesson. Profiles labelled "Python + JS" seed state for both courses so the multi-course dashboard, review card, and celebration replay exercise real polyglot rendering rather than mocked state.

**Frozen vs sandbox:**

- **Frozen** profiles re-apply their canned seed on every page load (via the pre-hydration `bootstrap.ts` that runs before any Zustand store reads localStorage). Interact freely — the next refresh resets everything to the seed. Great for verifying one UI state repeatedly without drift.
- **Sandbox** persists under `__dev__:sandboxSnapshot`. Switch away and back; your progress is preserved. Use for multi-step walkthroughs.

**Safety:**

- An allow-list in `applyProfile.ts` ensures OpenAI keys, theme, and UI size preferences are never touched when profiles swap.
- Your pre-dev-mode state is captured once under `__dev__:realSnapshot`. Exiting dev mode always restores it.
- Snapshot → clipboard and Paste snapshot (Developer tab) round-trip ad-hoc bug repro states. Paste validation rejects any key outside the allow-list.

**Keyboard shortcut implementation note:** the listener uses `event.code === "KeyD"` (not `event.key`) because on macOS the Option modifier transforms `e.key` into a unicode symbol (`Option+D` → `∂`). The listener is registered with `capture: true` on `window` so it fires before Monaco's own keydown handlers.

**Adding a profile:** edit [`frontend/src/__dev__/profiles.ts`](../frontend/src/__dev__/profiles.ts). Each profile returns a map of localStorage key → serialized value from `seedStorage()`. Only keys matching `OWNED_PREFIXES` (`learner:v1:`, `onboarding:v1:`) are ever written; any other key is dropped at apply time. Add a matching case to [`profiles.test.ts`](../frontend/src/__dev__/profiles.test.ts) if the profile encodes an invariant worth asserting (e.g., "exactly N shaky entries").

## Demoing the product

Two paths, depending on whether you want a frozen scripted state or a realistic walk-through.

**Quick demo with dev profiles (recommended for screenshots, short videos, UI-state walkthroughs).** The shortcut is intentionally dev-only — it's your cheat code, not something end users ever see.

1. `npm run dev` (or `./start.sh` for the full Docker stack).
2. `Cmd/Ctrl + Shift + Alt + D` to enable dev mode.
3. Open Settings → Developer tab, pick the profile that matches the story you're telling:
   - `fresh-install` — first-run welcome spotlight, dashboard banner, workspace tour.
   - `mid-course-healthy` — dashboard progress bar, "Next up", activity feed.
   - `all-complete` — celebration + review replay.
4. Frozen profiles snap back to their seed on every reload, so you can interact freely without drift between takes.

**End-user Export/Import for portable demo state.** If you've built up a specific progress state by hand and want to reproduce it on another machine (or share it with a teammate for bug repro), use **Settings → General → Progress → Export progress**. The JSON round-trips through the same allow-listed keys as the dev switcher — API keys, theme, and layout preferences are never included. Import replaces current progress and reloads.

**When to ship dev mode to external users.** Don't. Dev mode is a production-safe no-op (tree-shaken from the prod bundle), but the shortcut + Developer tab are aimed at developers. For guided demos to non-developers, either pre-seed the browser with the profile you want before they sit down, or walk them through the real flow.
