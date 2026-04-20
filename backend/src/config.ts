const num = (v: string | undefined, d: number) => (v ? Number(v) : d);

export const config = {
  port: num(process.env.PORT, 4000),
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",

  // Which ExecutionBackend implementation to load. Only "local-docker" is
  // implemented today; cloud variants ("ecs-fargate", "aks", "aci") are the
  // future drop-in slots — see services/execution/backends/index.ts.
  executionBackend: process.env.EXECUTION_BACKEND ?? "local-docker",

  runnerImage: process.env.RUNNER_IMAGE ?? "codetutor-ai-runner:latest",

  // Backend-internal path where per-session workspaces live (always a Linux
  // path because the backend runs inside a Linux container on every host).
  // The corresponding HOST path is discovered at startup by self-inspecting
  // the backend container — see resolveHostWorkspaceRoot() in
  // services/execution/backends/localDocker.ts. Keeping these two paths
  // separate is what lets the same code run on macOS, Linux, and Windows hosts.
  workspaceRoot: process.env.WORKSPACE_ROOT ?? "/workspace-root",

  // Escape hatch for bare-metal dev (running the backend directly on a host
  // OS, outside docker compose). When set, overrides self-inspect discovery.
  // Leave unset in the normal compose flow.
  hostWorkspaceRootOverride: process.env.WORKSPACE_ROOT_HOST,

  session: {
    idleTimeoutMs: num(process.env.SESSION_IDLE_TIMEOUT_MS, 2 * 60 * 1000),
    sweepIntervalMs: num(process.env.SESSION_SWEEP_INTERVAL_MS, 45 * 1000),
  },

  runner: {
    memoryBytes: num(process.env.RUNNER_MEMORY_BYTES, 512 * 1024 * 1024),
    nanoCpus: num(process.env.RUNNER_NANO_CPUS, 1_000_000_000),
    execTimeoutMs: num(process.env.RUN_TIMEOUT_MS, 10_000),
  },

  // AI-route throttle. Applied per session id, IP-fallback for pre-session
  // endpoints. Defaults: 60 requests per rolling minute — plenty for
  // interactive learner use, tight enough that an abusive script is capped.
  aiRateLimit: {
    windowMs: num(process.env.AI_RATE_LIMIT_WINDOW_MS, 60_000),
    max: num(process.env.AI_RATE_LIMIT_MAX, 60),
  },

  // Phase 17 / H-A2: per-IP throttle on the mutating routes (session
  // lifecycle, snapshot, execute). Session creation is tighter because it's
  // the expensive op (spawns a container). The normal mutation bucket is
  // generous so per-keystroke snapshot sync / repeated run-code clicks
  // still feel instant.
  mutationRateLimit: {
    sessionCreateWindowMs: num(
      process.env.SESSION_CREATE_RATE_LIMIT_WINDOW_MS,
      60_000,
    ),
    sessionCreateMax: num(process.env.SESSION_CREATE_RATE_LIMIT_MAX, 30),
    mutationWindowMs: num(
      process.env.MUTATION_RATE_LIMIT_WINDOW_MS,
      60_000,
    ),
    mutationMax: num(process.env.MUTATION_RATE_LIMIT_MAX, 120),
  },

  // Phase 18a: Supabase Auth. `url` points at the Supabase API root (GoTrue
  // lives under /auth/v1). The backend does NOT use an anon/service-role
  // key — it only verifies access tokens coming from the browser, by
  // fetching the JWKS from the auth server. JWKS verification needs no
  // shared secret; it's asymmetric.
  //
  // 12-factor: no default. The value must come from env (.env / .env.production).
  // Missing env at boot is a deployment misconfig; assertConfigValid() fails
  // fast rather than silently pointing at a wrong URL.
  supabase: {
    url: process.env.SUPABASE_URL,
  },

  // Phase 18b: Postgres for per-user state (preferences, progress, editor
  // project). Points at the Supabase-managed Postgres for the current
  // environment (transaction pooler URL from Project Settings → Database).
  databaseUrl: process.env.DATABASE_URL,
} as const;

export function assertConfigValid(): void {
  if (!config.supabase.url || config.supabase.url.trim() === "") {
    throw new Error(
      "[config] SUPABASE_URL is required. Populate `.env` from `.env.example` " +
        "with your codetutor-dev / codetutor-prod project URL.",
    );
  }
  try {
    new URL(config.supabase.url);
  } catch {
    throw new Error(
      `[config] SUPABASE_URL is not a valid URL: ${config.supabase.url}`,
    );
  }
  if (!config.databaseUrl || config.databaseUrl.trim() === "") {
    throw new Error(
      "[config] DATABASE_URL is required. Populate `.env` from `.env.example` " +
        "with your project's transaction-pooler connection string.",
    );
  }
}
