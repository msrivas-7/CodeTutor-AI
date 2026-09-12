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

| Fixture                      | Purpose                                                                                         |
| ---------------------------- | ----------------------------------------------------------------------------------------------- |
| `fixtures/boot.ts`           | globalSetup; asserts frontend + backend reachable                                               |
| `fixtures/profiles.ts`       | `loadProfile(page, id)` + `seedApiKey(page)` + `clearAppStorage(page)`                          |
| `fixtures/monaco.ts`         | `waitForMonacoReady` / `setMonacoValue` / `getMonacoValue` (uses `window.monaco` global)        |
| `fixtures/aiMocks.ts`        | SSE scenario frames for `/api/ai/ask/stream` — matches production `data: {...}\n\n` wire format |
| `fixtures/harnessResults.ts` | Canned `TestReport` payloads for `/api/execute/tests`                                           |
| `fixtures/testMetadata.ts`   | Required risk/owner/browser/device/quarantine metadata for the advisory critical lane           |
| `fixtures/seeds/*.json`      | Serialized `__dev__` profile localStorage seeds                                                 |
| `utils/selectors.ts`         | Centralized Playwright locators (role + aria-label first)                                       |
| `utils/assertions.ts`        | Domain-level expects (`expectLessonComplete`, `expectStdoutContains`, …)                        |

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

- an automatically selected blocking Chromium topology of up to twelve shards
  for the complete current inventory, plus four concurrent Firefox, WebKit and
  critical support stacks, with no coverage reduction;
- blocking Firefox and WebKit focused journeys;
- one advisory, zero-retry Chromium critical lane (currently 41 tests in 15 files);
- CI retries retain diagnostic traces, but `failOnFlakyTests` makes a flaky
  result fail its shard so a targeted rerun cannot erase the original signal;
- disposable-user provisioning retries only the Supabase SDK's explicit
  `AuthRetryableFetchError`, whether thrown or returned in the SDK response,
  with a four-attempt exponential equal-jitter bound; ordinary auth errors and
  every browser assertion still fail immediately;
- each lane, shard, attempt, and benchmark stage receives a stable synthetic
  address from the reserved `2001:db8::/32` range through the Vite proxy, so
  the real per-IP abuse controls are tested without unrelated jobs sharing one
  daily database counter;
- versioned shadow evidence that records queue-inclusive readiness and any miss where the critical lane passes but the full suite fails.

`e2e/shadow/regression-corpus.json` freezes the initial P0/P1 catch corpus.
`e2e/shadow/migration-pilots.json` records the three lower-layer pilots and the
browser boundary retained for each. The latest capacity run
[`34688798759`](https://github.com/msrivas-7/CodeTutor-AI/actions/runs/34688798759)
compared 16 and 20 Chromium shards sequentially on the exact 484-test PR head
with two workers per shard and no retries. All 16 shards passed in isolation;
20 failed after the shared development database reached its 200-client
connection ceiling. Exact-head normal run `34690166145` showed that 16 Chromium
shards plus Firefox, WebKit and two critical support stacks also reaches 20
database stacks and reproduces that failure. The operational workflow
therefore caps and falls back to 12 Chromium shards while reserving four
support slots, keeping the full run at or below the proven 16-stack limit. All
tests remain blocking. The benchmark reports end-to-end completion, slowest
test time, shard imbalance,
aggregate runner time, setup overhead, and tests per shard. A larger topology
is recommended only when every shard passes and it improves completion by at
least 20 seconds and 5%.

After the account moved to GitHub Pro, the controlled capacity pass narrowed to
a fresh same-commit comparison of the 16-shard incumbent and 20 shards. The
40-job account-wide ceiling must also accommodate the ordinary CI, preview,
security, Firefox, WebKit, and advisory jobs that run on a PR; 20 Chromium
shards is therefore the practical no-starvation ceiling for the current
workflow set. Higher matrix counts are syntactically valid but would queue or
delay adjacent quality checks instead of making the complete PR faster.

Re-evaluate the candidate ceiling whenever the GitHub plan, runner class, or
observed account concurrency changes. The matrix supports up to 256 jobs, but
that syntax limit is not useful capacity unless the account can actually start
the jobs concurrently.

The labeled `.github/workflows/e2e-runtime-benchmark.yml` runtime experiment
uses the `ci-runtime-benchmark` label and holds those sixteen shards constant.
It first compares the existing per-shard
Docker build with one digest-pinned backend, runner, and development-frontend
build reused by every shard, then measures two, three, and four Playwright
workers on the reused images. Each stage is sequential, retry-free, and must be
fully green. Image reuse is adopted only from a material end-to-end gain;
worker count is selected independently from the Playwright test critical path.

`.github/e2e-shard-capacity.json` records the measured safety and performance
envelope. The duration-planning job counts the live Chromium inventory and
chooses the smallest topology whose predicted completion is within the
measured 20-second or 5% noise floor of the fastest safe candidate. Its model
uses the trusted per-test history, two proven workers per shard, and the
measured 129-second fixed preparation/setup cost. The hard maximum is the
smaller of the GitHub concurrency allowance and the database limit after four
support stacks are reserved; today that is twelve blocking shards.

The selected matrix is passed to the browser job through a job output and
GitHub's supported `fromJSON` dynamic-matrix contract. Every candidate plan is
coverage-complete and deterministic. Missing, malformed, older-than-30-day, or
less-than-80%-complete history cannot drive topology: the workflow falls back
to the proven twelve-shard configuration. Test-count boundaries at 443 and 525
now recommend a controlled capacity rebenchmark instead of blocking ordinary
growth; selection adapts automatically inside the proven envelope on every
run. Rebenchmark the hard ceiling when the runner class, GitHub plan, database
capacity, support-lane count, or worker reliability changes—never by guessing
a larger matrix or selecting tests away.

The automatically sized blocking lane uses a duration-aware plan rather than
Playwright's test-count-only partition. `.github/e2e-duration-seed.json` is the cold-start
baseline from a clean 439-test run. Before each workflow, the planner enumerates
the current Chromium inventory and assigns the longest predicted test to the
least-loaded shard until every test appears exactly once. Unseen tests receive
an eight-second conservative estimate, so additions cannot disappear from the
suite. A successful exhaustive run publishes per-test timings; a separate
post-processing job updates a branch-scoped moving-average cache for the next
run. Timing artifacts include their shard and workflow-attempt identity. When
GitHub reruns only a failed matrix job, the learner keeps the newest clean
attempt for each shard and ignores the older failed artifact instead of
depending on nondeterministic file overwrites. Forks can read the trusted
default-branch history but cannot publish it. The tracked seed remains the
deterministic duration fallback if no cache is available.

The 63-test advisory critical lane consumes the same inventory and duration
history but runs as two isolated shards. This preserves its frozen contract,
zero-retry posture, and complete coverage while removing one duplicated serial
bottleneck. Browser jobs still use two Playwright workers: the measured
three-worker candidate was faster but failed under resource contention, so
duration balancing adds no extra pressure inside an individual runner.
