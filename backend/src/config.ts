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
} as const;
