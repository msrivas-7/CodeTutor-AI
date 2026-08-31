import { defineConfig, devices } from "@playwright/test";
import * as path from "node:path";
import * as dotenv from "dotenv";

// Source ../.env so SUPABASE_SERVICE_ROLE_KEY + OPENAI_API_KEY are available
// to fixtures/boot.ts and fixtures/auth.ts. Same file docker compose reads —
// one source of truth for local dev. CI provides these via workflow secrets;
// the dotenv call is a no-op if the file is absent.
dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

// Give every local Playwright invocation its own user namespace, just as CI
// does. Without this, one run's global teardown broadly deletes every e2e-w*
// account and can invalidate another run that happens to overlap (for example,
// a focused flake reproduction finishing while the full suite is starting).
// Set this in the coordinator process so every spawned worker and the global
// teardown inherit the same value.
process.env.E2E_USER_SUFFIX ??=
  `local-${process.pid}-${Date.now().toString(36)}`;

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:5173";
const API_URL = process.env.E2E_API_URL ?? "http://localhost:4000";
const IS_CI = !!process.env.CI;
const CROSS_BROWSER = process.env.E2E_CROSS_BROWSER === "1";
const RECORD_VIDEO = IS_CI || process.env.E2E_VIDEO === "1";
const durationReporter = process.env.E2E_TIMING_OUTPUT
  ? [[path.resolve(__dirname, "reporters/durationReporter.ts"), { outputFile: process.env.E2E_TIMING_OUTPUT }]]
  : [];
// GitHub-hosted Ubuntu and Playwright's official Linux container ship
// different native fallback-font sets. Both are valid release renderers, but
// their glyph metrics differ enough on phone layouts that one shared "linux"
// golden would require a loose threshold. Keep each reviewed environment
// strict instead. The override is useful for reproducing either set locally.
const SNAPSHOT_ENVIRONMENT =
  process.env.E2E_SNAPSHOT_ENV ?? (IS_CI ? "gha-linux" : process.platform);

const browserProjects = [
  {
    name: "chromium",
    use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
  },
  ...(CROSS_BROWSER
    ? [
        {
          name: "firefox",
          use: { ...devices["Desktop Firefox"], viewport: { width: 1440, height: 900 } },
        },
        {
          name: "webkit",
          use: { ...devices["Desktop Safari"], viewport: { width: 1440, height: 900 } },
        },
      ]
    : []),
];

export default defineConfig({
  testDir: "./specs",
  // Default excludes real-api specs — opt in via `npm run test:real`.
  testIgnore: process.env.E2E_REAL_OPENAI === "1" ? [] : ["**/real-api/**"],
  fullyParallel: true,
  forbidOnly: IS_CI,
  // Retries preserve traces for diagnosis, but a retry is evidence rather
  // than a clean pass. CI therefore fails a shard that contains any flaky
  // result so only that shard can be rerun after the original failure remains
  // visible in the Actions history.
  retries: IS_CI ? 2 : 1,
  failOnFlakyTests: IS_CI,
  // Local and CI: 2 workers. Four concurrent session-start tests can saturate
  // the local runner pool and leave otherwise-correct lessons stuck at
  // "Waiting for session". Two preserves useful parallelism without turning
  // infrastructure capacity into false product failures.
  //
  // CI parallelism comes from sharding (16 matrix shards × 2 workers = 32
  // effective workers across separate ubuntu-latest runners) — see
  // .github/workflows/e2e.yml. The measured topology and rebenchmark band live
  // in .github/e2e-shard-capacity.json. Larger
  // GitHub-hosted runners require a paid Team/Enterprise plan even for
  // public repos, so sharding is the right shape for the Free tier.
  workers: 2,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: IS_CI
    ? [["html", { open: "never" }], ["github"], ["list"], ...durationReporter]
    : [["html", { open: "never" }], ["list"], ...durationReporter],
  // Keep strict visual baselines per reviewed rendering environment. The
  // production app deliberately falls back to native fonts while its optional
  // brand-font stylesheet loads, so macOS, Playwright-container Linux, and
  // GitHub-hosted Ubuntu have meaningfully different glyph metrics and line
  // wrapping even when the layout is correct. Environment-specific goldens
  // preserve the 3% threshold instead of weakening it enough to hide clipping.
  snapshotPathTemplate:
    `{testDir}/{testFilePath}-snapshots/{arg}-${SNAPSHOT_ENVIRONMENT}-{projectName}{ext}`,

  globalSetup: path.resolve(__dirname, "fixtures/boot.ts"),
  globalTeardown: path.resolve(__dirname, "fixtures/teardown.ts"),

  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    // CI keeps failure videos for artifact-based diagnosis. Local recording is
    // opt-in because Playwright captures from test start even in
    // `retain-on-failure` mode; on a busy developer Mac that encoder can delay
    // Vite's module graph long enough to create false Monaco/Suspense timeouts.
    // Screenshots remain enabled locally, and `--trace on` is the preferred
    // focused diagnostic. Set E2E_VIDEO=1 when a local motion recording helps.
    video: RECORD_VIDEO ? "retain-on-failure" : "off",
    screenshot: "only-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    extraHTTPHeaders: {
      "x-e2e-api-url": API_URL,
    },
  },

  // Chromium owns the exhaustive suite and pixel baselines. The release
  // workflow opts into Firefox + WebKit for the focused Phase A-Q critical
  // journey by setting E2E_CROSS_BROWSER=1. Keeping the opt-in explicit
  // prevents ordinary local `npm test` runs from unexpectedly tripling.
  projects: browserProjects,
});
