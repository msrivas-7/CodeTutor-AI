import { defineConfig } from "@playwright/test";
import * as path from "node:path";
import * as dotenv from "dotenv";

// Separate config from the main Playwright suite so security tests can
// run on their own schedule (nightly + path-triggered) without pulling
// in the UI-spec defaults. `globalSetup` is reused — same per-worker
// Supabase user pool.

dotenv.config({ path: path.resolve(__dirname, "..", "..", ".env") });

// The security suite is a standalone Playwright entrypoint, so it cannot rely
// on the main config to establish a test-user namespace for local runs.
process.env.E2E_USER_SUFFIX ??= `security-local-${process.pid}-${Date.now().toString(36)}`;
// Security scenarios use Playwright's APIRequestContext and never render the
// app. Keep the shared readiness hook, but scope it to the backend so this
// suite does not build and boot an unused frontend merely to satisfy a probe.
process.env.E2E_SKIP_FRONTEND_HEALTH ??= "1";

const IS_CI = !!process.env.CI;

export default defineConfig({
  testDir: "./scenarios",
  // Resource-class tests (S4) rely on host-sentinel baselines that get
  // noisy when parallel workers fork-bomb each other's measurements.
  // Serial is the honest default; individual describe blocks can opt back
  // into parallel if the scenarios within are independent.
  fullyParallel: false,
  workers: 1,
  forbidOnly: IS_CI,
  // One retry for genuine network flakes (e.g. transient GoTrue 500).
  // Never more — security regressions must NOT be masked by retries.
  retries: IS_CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: IS_CI
    ? [["html", { open: "never", outputFolder: "playwright-report" }], ["github"], ["list"]]
    : [["html", { open: "never", outputFolder: "playwright-report" }], ["list"]],
  // Reuse the main e2e globalSetup so the per-worker user pool is a
  // single source of truth. The setup is idempotent — running it in
  // both configs during a local "run everything" loop is safe.
  globalSetup: path.resolve(__dirname, "..", "fixtures", "boot.ts"),
  globalTeardown: path.resolve(__dirname, "..", "fixtures", "teardown.ts"),
  outputDir: "./test-results",
  projects: [
    {
      name: "security",
    },
  ],
});
