import { describe, expect, it, vi } from "vitest";
import type {
  ExecResult,
  ExecutionBackend,
  SessionHandle,
} from "./backends/types.js";
import {
  isTransientWorkspacePermissionError,
  runProject,
} from "./router.js";

const handle: SessionHandle = {
  sessionId: "session-1",
  __kind: "test",
};

function execResult(overrides: Partial<ExecResult> = {}): ExecResult {
  return {
    stdout: "",
    stderr: "",
    exitCode: 0,
    timedOut: false,
    durationMs: 1,
    ...overrides,
  };
}

function makeBackend(results: ExecResult[]): ExecutionBackend {
  return {
    kind: "test",
    ensureReady: vi.fn(async () => {}),
    ping: vi.fn(async () => {}),
    createSession: vi.fn(async () => handle),
    isAlive: vi.fn(async () => true),
    destroy: vi.fn(async () => {}),
    exec: vi.fn(async () => results.shift() ?? execResult()),
    cancel: vi.fn(async () => {}),
    writeFiles: vi.fn(async () => {}),
    removeFiles: vi.fn(async () => {}),
    fileExists: vi.fn(async () => true),
    replaceSnapshot: vi.fn(async () => {}),
    queueDepth: () => ({ inFlight: 0, queued: 0 }),
  };
}

describe("runProject workspace readiness", () => {
  it("returns Python parser failures as server-owned compile diagnostics", async () => {
    const backend = makeBackend([
      execResult({
        stderr: "File \"main.py\", line 1\nSyntaxError: '(' was never closed",
        exitCode: 1,
      }),
    ]);

    const result = await runProject(backend, {
      handle,
      language: "python",
      timeoutMs: 1_000,
    });

    expect(backend.exec).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      exitCode: 1,
      errorType: "compile",
      stage: "compile",
    });
  });

  it("keeps learner-authored stderr in the runtime stage after parsing succeeds", async () => {
    const forged = "File \"main.py\", line 1\nSyntaxError: '(' was never closed";
    const backend = makeBackend([
      execResult(),
      execResult({ stderr: forged, exitCode: 1 }),
    ]);

    const result = await runProject(backend, {
      handle,
      language: "python",
      timeoutMs: 1_000,
    });

    expect(backend.exec).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      stderr: forged,
      exitCode: 1,
      errorType: "runtime",
      stage: "run",
    });
  });

  it("recognizes only runner workspace permission transients", () => {
    expect(
      isTransientWorkspacePermissionError(
        "open /workspace/main.go: permission denied",
      ),
    ).toBe(true);
    expect(isTransientWorkspacePermissionError("main.go:4: syntax error")).toBe(
      false,
    );
    expect(isTransientWorkspacePermissionError("permission denied")).toBe(false);
  });

  it("retries a transient compile permission failure within the same run", async () => {
    const backend = makeBackend([
      execResult({
        stderr: "open /workspace/main.go: permission denied",
        exitCode: 1,
      }),
      execResult(),
      execResult({ stdout: "ready\n" }),
    ]);

    const result = await runProject(backend, {
      handle,
      language: "go",
      timeoutMs: 1_000,
    });

    expect(backend.exec).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({
      stdout: "ready\n",
      exitCode: 0,
      errorType: "none",
      stage: "run",
    });
  });

  it("classifies a repeated workspace permission failure as infrastructure", async () => {
    const denied = execResult({
      stderr: "open /workspace/main.go: permission denied",
      exitCode: 1,
    });
    const backend = makeBackend([denied, denied]);

    const result = await runProject(backend, {
      handle,
      language: "go",
      timeoutMs: 1_000,
    });

    expect(backend.exec).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      exitCode: 1,
      errorType: "system",
      stage: "setup",
    });
    expect(result.stderr).toContain("Your code is still safe");
  });
});
