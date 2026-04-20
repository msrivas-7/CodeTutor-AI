import { defineConfig, devices } from "@playwright/test";
import * as path from "node:path";
import * as dotenv from "dotenv";

// Source ../.env so SUPABASE_SERVICE_ROLE_KEY + OPENAI_API_KEY are available
// to fixtures/boot.ts and fixtures/auth.ts. Same file docker compose reads —
// one source of truth for local dev. CI provides these via workflow secrets;
// the dotenv call is a no-op if the file is absent.
dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:5173";
const API_URL = process.env.E2E_API_URL ?? "http://localhost:4000";
const IS_CI = !!process.env.CI;

export default defineConfig({
  testDir: "./specs",
  // Default excludes real-api specs — opt in via `npm run test:real`.
  testIgnore: process.env.E2E_REAL_OPENAI === "1" ? [] : ["**/real-api/**"],
  fullyParallel: true,
  forbidOnly: IS_CI,
  // One local retry absorbs intermittent React-render races under 4-worker
  // parallel load (setInputFiles → modal render, store-update re-renders
  // detaching buttons mid-click). CI keeps 2 retries.
  retries: IS_CI ? 2 : 1,
  // Local: 4 workers. Eight workers × (Docker container create + Supabase auth
  // round-trip) saturates the docker-socket-proxy under parallel load and
  // tests race to 30s session-start timeouts. Four is the sweet spot on an
  // M1 Pro — plenty of CPU headroom, stable under parallel container churn.
  // CI stays at 2 so we don't starve the runner.
  workers: IS_CI ? 2 : 4,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: IS_CI
    ? [["html", { open: "never" }], ["github"], ["list"]]
    : [["html", { open: "never" }], ["list"]],

  globalSetup: path.resolve(__dirname, "fixtures/boot.ts"),
  globalTeardown: path.resolve(__dirname, "fixtures/teardown.ts"),

  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    extraHTTPHeaders: {
      "x-e2e-api-url": API_URL,
    },
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
});
