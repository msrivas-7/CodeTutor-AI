/**
 * ExecutionBackend — the abstraction layer between backend business logic and
 * wherever learner code actually runs. Locally this is a sibling Docker
 * container spawned via the socket. In a future cloud build it will be an ECS
 * task / AKS Pod / ACI container group spun up through the provider's
 * constrained API. Callers should depend on this interface alone and never
 * reach for dockerode (or any cloud SDK) directly.
 */

export interface RuntimeSpec {
  sessionId: string;
}

/**
 * Opaque per-session reference produced by `createSession`. Callers pass it
 * through to `exec` / `writeFiles` / etc. and must not inspect its fields;
 * concrete backends narrow the type internally with a `__kind` discriminator.
 */
export interface SessionHandle {
  readonly sessionId: string;
  readonly __kind: string;
}

export interface WorkspaceFile {
  /** Relative path within the session workspace. No leading slash, no `..`. */
  path: string;
  content: string;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  durationMs: number;
}

export interface ExecOptions {
  stdin?: string;
  /**
   * Per-exec env overlay. Merged on top of the container's image + create-time
   * env. Used by the function-test harness for non-secret settings like the
   * per-test timeout. Secrets (e.g. the HMAC nonce) travel via `stdin`
   * instead — /proc/<pid>/environ leaks env even after `unsetenv`, so env is
   * not a safe channel for anything user-code children must not see.
   */
  env?: Record<string, string>;
}

export interface ExecutionBackend {
  /** Stable identifier for this impl (e.g. "local-docker"). */
  readonly kind: string;

  /**
   * Blocking startup preparation. Throws only on fatal failure (impl cannot
   * serve sessions at all). Non-fatal runtime issues (e.g. image missing on a
   * dev box) are logged and swallowed — session creation will surface them.
   */
  ensureReady(): Promise<void>;

  /**
   * Liveness probe. Throws if the backend cannot talk to its runtime (for
   * local-docker: the docker socket / socket-proxy is unreachable). Used by
   * `/api/health/deep` so alerting can fire when the VM has lost docker
   * before learners see a session-create 500.
   */
  ping(): Promise<void>;

  createSession(spec: RuntimeSpec): Promise<SessionHandle>;
  isAlive(handle: SessionHandle): Promise<boolean>;
  destroy(handle: SessionHandle): Promise<void>;

  exec(
    handle: SessionHandle,
    command: string,
    timeoutMs: number,
    opts?: ExecOptions,
  ): Promise<ExecResult>;

  /** Overlay-write files into the session workspace. Creates parent dirs. */
  writeFiles(handle: SessionHandle, files: WorkspaceFile[]): Promise<void>;

  /** Delete named files from the workspace. Missing files are ignored. */
  removeFiles(handle: SessionHandle, paths: string[]): Promise<void>;

  fileExists(handle: SessionHandle, relativePath: string): Promise<boolean>;

  /**
   * Wipe the workspace contents (not the root dir itself — local impl has a
   * bind mount on it whose inode must not change) and write `files` fresh.
   * Used by `/api/project/snapshot` where the frontend sends the learner's
   * full project state on each sync.
   */
  replaceSnapshot(
    handle: SessionHandle,
    files: WorkspaceFile[],
  ): Promise<void>;
}
