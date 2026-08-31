import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(new URL("../workflows/security.yml", import.meta.url), "utf8");
const securityConfig = readFileSync(new URL("../../e2e/security-suite/playwright.config.ts", import.meta.url), "utf8");
const sharedSetup = readFileSync(new URL("../../e2e/fixtures/boot.ts", import.meta.url), "utf8");

test("API-only security scenarios do not build or boot the frontend", () => {
  assert.doesNotMatch(workflow, /docker compose build frontend/);
  assert.doesNotMatch(workflow, /docker compose up[^\n]*backend frontend/);
  assert.match(workflow, /docker compose up -d --no-build backend/);
  assert.match(workflow, /docker compose up -d backend/);
});

test("API-only security scenarios do not provision unused browser dependencies", () => {
  assert.doesNotMatch(workflow, /playwright install(?:-deps| --with-deps)/);
  assert.doesNotMatch(workflow, /\.cache\/ms-playwright/);
});

test("API-only security mode skips only the frontend readiness probe", () => {
  assert.match(securityConfig, /E2E_SKIP_FRONTEND_HEALTH \?\?= "1"/);
  assert.match(sharedSetup, /E2E_SKIP_FRONTEND_HEALTH !== "1"/);
  assert.match(sharedSetup, /ping\(`\$\{BACKEND}\/api\/health`, "backend"\)/);
});

test("host sentinel installs tcpdump only when the runner image lacks it", () => {
  assert.match(workflow, /if ! command -v tcpdump/);
  assert.match(workflow, /sudo -n tcpdump --version/);
});
