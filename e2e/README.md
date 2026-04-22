# CodeTutor AI — E2E Harness

Playwright + TypeScript suite that drives the real product (Vite dev server + Dockerized backend + polyglot runner) to catch UI-integration regressions that unit tests miss: Monaco focus quirks, modal portals, SSE streaming, DB hydration, router navigation, backend round-trips.

## Prerequisites

1. Docker stack up: `docker compose up -d` from the repo root.
2. Frontend dev server + backend reachable at `localhost:5173` and `localhost:4000`. `globalSetup` asserts this before any spec runs.
3. Node 20+.

## Install

```bash
cd e2e
npm install
npx playwright install --with-deps chromium
```

## Profile seeds

`fixtures/seeds/<id>.json` holds each scenario's starting state (the original `__dev__` profile shape — `learner:v1:*` / `onboarding:v1:*` keys). `fixtures/profiles.ts` → `loadProfile(page, id)` parses the JSON and translates it into `PATCH /api/user/preferences` + `PATCH /api/user/courses/:id` + `PATCH /api/user/lessons/:course/:lesson` calls against the worker's pre-authed Supabase test user. The app then hydrates server-side state on the next `page.goto`.

The seeds are hand-authored JSON checked into the repo — no `dump-seeds` script anymore (the localStorage profile switcher that generated them was retired when state moved to Postgres). Edit them by hand when a scenario needs to change; `profiles.ts` is the sole consumer.

## Run

```bash
# Default: mocked AI, fast, runs on every PR
npm test

# Interactive mode — great for selector authoring
npm run test:ui

# Step-through debugger
npx playwright test specs/editor.spec.ts --debug

# Single spec
npx playwright test specs/learning.spec.ts

# Open the last HTML report
npx playwright show-report
```

## Real-OpenAI suite (opt-in)

Industry-standard dual-mode: mocked by default (fast, deterministic, every PR), opt-in real-API suite for release-gate smoke. Specs under `specs/real-api/**` are excluded unless `E2E_REAL_OPENAI=1`.

```bash
# From .env (never committed):
export OPENAI_API_KEY=sk-...
npm run test:real
```

`globalSetup` refuses to run with `E2E_REAL_OPENAI=1` if `OPENAI_API_KEY` is unset.

## Fixtures

| Fixture | Purpose |
| --- | --- |
| `fixtures/boot.ts` | globalSetup; asserts frontend + backend reachable |
| `fixtures/profiles.ts` | `loadProfile(page, id)` + `seedApiKey(page)` + `clearAppStorage(page)` |
| `fixtures/monaco.ts` | `waitForMonacoReady` / `setMonacoValue` / `getMonacoValue` (uses `window.monaco` global) |
| `fixtures/aiMocks.ts` | SSE scenario frames for `/api/ai/ask/stream` — matches production `data: {...}\n\n` wire format |
| `fixtures/harnessResults.ts` | Canned `TestReport` payloads for `/api/execute/tests` |
| `fixtures/seeds/*.json` | Serialized `__dev__` profile localStorage seeds |
| `utils/selectors.ts` | Centralized Playwright locators (role + aria-label first) |
| `utils/assertions.ts` | Domain-level expects (`expectLessonComplete`, `expectStdoutContains`, …) |

## Conventions

- **No arbitrary timeouts.** Use auto-waiting `expect(locator).toBeVisible()` and friends.
- **Mock OpenAI by default.** Real OpenAI only under `specs/real-api/**`.
- **Backend harness runs for real** for function-tests specs — it's fast and proves the full stack agrees.
- **Don't boot the stack per-test.** `docker compose up -d` is the developer's one-time setup. `globalSetup` fails loudly if it's not running.
- **Use `loadProfile(page, id)`** to land deterministically on "mid-course healthy / capstone-first-fail / all-complete" — it resets the worker user's DB rows then PATCHes the seed, so the next `page.goto` hydrates into the scenario without clicking through N lessons.
- **Chromium only** for v1. Firefox/WebKit add 3× CI time with marginal value on a local-first desktop-only app.
- **One behavior per test.** Keep tests tight — if two paths diverge (pass vs fail), they're two tests.

## Adding a spec

1. `touch specs/my-feature.spec.ts`
2. Import `{ test, expect } from '@playwright/test'`, the fixture(s) you need, and `* as S from '../utils/selectors'`.
3. Start with `await loadProfile(page, '<closest-profile>')` before the first `page.goto()` so state hydrates cleanly.
4. Assert on role/aria first; if forced into class selectors, extend `utils/selectors.ts`.
5. Run `npm test -- specs/my-feature.spec.ts` locally before committing.

## Debugging flakes

1. `npx playwright show-report` — HTML report includes trace viewer.
2. `npx playwright test --trace on` — forces trace on every test (heavier, keep off by default).
3. `--repeat-each=10` for a single spec to stress-test flakiness.
4. Common culprits: Monaco not ready on first click (use `waitForMonacoReady`), SSE mock missing (check `page.route` was called before the action), seed JSON out of shape (inspect `fixtures/seeds/<id>.json`; `loadProfile` logs the PATCH failures).

## CI

See `.github/workflows/e2e.yml`. Docker stack is brought up in the job, Chromium cached, artifacts include the HTML report on failure.
