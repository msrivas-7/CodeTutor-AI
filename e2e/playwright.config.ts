import { defineConfig, devices } from "@playwright/test";
import * as path from "node:path";

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
  workers: IS_CI ? 2 : undefined,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: IS_CI
    ? [["html", { open: "never" }], ["github"], ["list"]]
    : [["html", { open: "never" }], ["list"]],

  globalSetup: path.resolve(__dirname, "fixtures/boot.ts"),

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
