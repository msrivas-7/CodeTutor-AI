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

# Opt into a local failure video when motion/timing is the thing under review
E2E_VIDEO=1 npx playwright test specs/learning.spec.ts

# Advisory no-retry critical lane (the full suite is still the release gate)
npx playwright test --grep @lane:critical --project=chromium --retries=0

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
| `fixtures/testMetadata.ts` | Required risk/owner/browser/device/quarantine metadata for the advisory critical lane |
| `fixtures/seeds/*.json` | Serialized `__dev__` profile localStorage seeds |
| `utils/selectors.ts` | Centralized Playwright locators (role + aria-label first) |
| `utils/assertions.ts` | Domain-level expects (`expectLessonComplete`, `expectStdoutContains`, …) |

## Conventions

- **No arbitrary timeouts.** Use auto-waiting `expect(locator).toBeVisible()` and friends.
- **Mock OpenAI by default.** Real OpenAI only under `specs/real-api/**`.
- **Backend harness runs for real** for function-tests specs — it's fast and proves the full stack agrees.
- **Don't boot the stack per-test.** `docker compose up -d` is the developer's one-time setup. `globalSetup` fails loudly if it's not running.
- **Use `loadProfile(page, id)`** to land deterministically on "mid-course healthy / capstone-first-fail / all-complete" — it resets the worker user's DB rows then PATCHes the seed, so the next `page.goto` hydrates into the scenario without clicking through N lessons.
- **Chromium owns the exhaustive suite.** Firefox and WebKit run the focused cross-browser product journey in CI.
- **Cross-cutting pre-lesson gates are explicit fixtures.** The shared authenticated fixture returns no memory warm-up by default so unrelated editor/lesson tests keep one owned boundary. `memory-warmup.spec.ts` opts into the real endpoint with `test.use({ memoryWarmupsEnabled: true })`; new gate behavior needs the same dedicated opt-in pattern.
- **Critical means source-owned metadata, not a filename list.** Use `criticalTest(...)`; the shadow contract rejects missing dimensions, P2 risk, active quarantine, or erosion below the frozen floor.
- **No browser coverage is demoted during shadow.** Lower-layer migration pilots run beside their original browser boundaries until the plan's catch-quality gate passes.
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
3. `E2E_VIDEO=1 npx playwright test ...` — records local failure video when motion or timing needs visual diagnosis. CI always retains failure videos; local runs keep video opt-in so capture overhead cannot create false app-readiness failures.
4. `--repeat-each=10` for a single spec to stress-test flakiness.
5. Common culprits: Monaco not ready on first click (use `waitForMonacoReady`), SSE mock missing (check `page.route` was called before the action), seed JSON out of shape (inspect `fixtures/seeds/<id>.json`; `loadProfile` logs the PATCH failures).

## CI

See `.github/workflows/e2e.yml`. The current PR model is:

- ten blocking Chromium shards for all 420 tests, selected by a same-commit,
  zero-retry capacity benchmark with no regression-coverage reduction;
- blocking Firefox and WebKit focused journeys;
- one advisory, zero-retry Chromium critical lane (currently 41 tests in 15 files);
- CI retries retain diagnostic traces, but `failOnFlakyTests` makes a flaky
  result fail its shard so a targeted rerun cannot erase the original signal;
- versioned shadow evidence that records queue-inclusive readiness and any miss where the critical lane passes but the full suite fails.

`e2e/shadow/regression-corpus.json` freezes the initial P0/P1 catch corpus.
`e2e/shadow/migration-pilots.json` records the three lower-layer pilots and the
browser boundary retained for each. The earlier shard benchmark measured four,
six, and eight shards on commit `c6aa5f0`; at the then-smaller suite size, six
was fastest at 316 seconds versus 340 for eight and 495 for four. The suite has
since grown to 420 Chromium tests, so
`.github/workflows/e2e-shard-benchmark.yml` now compares 6, 8, and 10 shards on
the same commit, sequentially and without retries. Run
[`33295206692`](https://github.com/msrivas-7/CodeTutor-AI/actions/runs/33295206692)
selected ten shards at 325 seconds, versus 367 for eight and 504 for six; every
job passed and all 420 tests remained blocking. It reports end-to-end
completion, slowest test time, shard imbalance, aggregate runner time, setup
overhead, and tests per shard. A larger topology is recommended only when every
shard passes and it improves completion by at least 20 seconds and 5%; this
avoids buying more runner/setup overhead for a noisy or negligible gain.
`.github/e2e-shard-capacity.json` records the measured decision. Shard 1 counts
the live Chromium inventory and fails closed when it reaches 462 tests or falls
to 378, one measured shard-workload from the 420-test baseline. Re-run the
benchmark and update the record at that point instead of guessing a new shard
count or selecting tests away.
