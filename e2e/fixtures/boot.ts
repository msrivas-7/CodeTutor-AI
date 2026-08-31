// Global setup. Browser suites require frontend + backend reachability;
// API-only suites can explicitly skip the frontend probe. We don't boot the
// stack ourselves — that's the developer's one-time `docker compose up -d`
// setup. Surfacing a clear error here is more useful than per-spec timeouts.

import { request } from "@playwright/test";

const FRONTEND = process.env.E2E_BASE_URL ?? "http://localhost:5173";
const BACKEND = process.env.E2E_API_URL ?? "http://localhost:4000";
const MAX_ATTEMPTS = 20;
const ATTEMPT_DELAY_MS = 500;

async function ping(url: string, label: string) {
  const ctx = await request.newContext();
  let lastErr: unknown;
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    try {
      const res = await ctx.get(url, { timeout: 2_000 });
      if (res.ok() || res.status() === 404) {
        await ctx.dispose();
        return;
      }
      lastErr = new Error(`${label} returned HTTP ${res.status()}`);
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, ATTEMPT_DELAY_MS));
  }
  await ctx.dispose();
  throw new Error(
    `E2E globalSetup: ${label} unreachable at ${url} after ${MAX_ATTEMPTS} attempts. ` +
      `Run \`docker compose up -d\` first. Last error: ${String(lastErr)}`,
  );
}

export default async function globalSetup() {
  const readinessChecks = [
    // /api/health is the unauthenticated liveness probe. Post-20-P3 the
    // previous target (/api/ai/validate-key) is auth-gated, so a 401 leaks
    // into the ping path and obscures actual connectivity failures.
    ping(`${BACKEND}/api/health`, "backend"),
  ];
  if (process.env.E2E_SKIP_FRONTEND_HEALTH !== "1") {
    readinessChecks.push(ping(FRONTEND, "frontend"));
  }
  await Promise.all(readinessChecks);

  if (!process.env.SUPABASE_URL) {
    throw new Error(
      "E2E globalSetup: SUPABASE_URL is required. Populate `../.env` " +
        "from `../.env.example` with your codetutor-dev project URL. See docs/DEVELOPMENT.md.",
    );
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "E2E globalSetup: SUPABASE_SERVICE_ROLE_KEY is required. " +
        "Populate `../.env` from `../.env.example` or inject via CI secret. " +
        "See e2e/fixtures/auth.ts.",
    );
  }

  if (process.env.E2E_REAL_OPENAI === "1" && !process.env.OPENAI_API_KEY) {
    throw new Error(
      "E2E_REAL_OPENAI=1 requires OPENAI_API_KEY in the environment. " +
        "Source .env or pass it inline: `OPENAI_API_KEY=sk-… npm run test:real`",
    );
  }
}
