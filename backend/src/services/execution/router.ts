import { config } from "../../config.js";
import type {
  ExecutionBackend,
  SessionHandle,
} from "./backends/index.js";
import { commandFor, type Language } from "./commands.js";

export type ErrorType = "none" | "compile" | "runtime" | "timeout" | "system";

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  errorType: ErrorType;
  durationMs: number;
  stage: "compile" | "run" | "setup";
}

export interface RunOptions {
  handle: SessionHandle;
  language: Language;
  timeoutMs?: number;
  stdin?: string;
}

// Docker Desktop's bind-mounted workspace can briefly expose a freshly
// replaced source file before its readable mode has propagated into the
// runner. Go reports that host/runtime race as a learner-looking compile
// error (`open /workspace/main.go: permission denied`). A single bounded
// retry keeps that infrastructure transient inside the same visible Run
// operation; real compiler errors are never retried.
const WORKSPACE_PERMISSION_RETRY_DELAY_MS = 75;

export function isTransientWorkspacePermissionError(stderr: string): boolean {
  return /(?:open|read|stat)\s+\/workspace\/[^\n]*:\s*permission denied/i.test(stderr);
}

async function waitForWorkspacePermissionPropagation(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, WORKSPACE_PERMISSION_RETRY_DELAY_MS);
  });
}

export async function runProject(
  backend: ExecutionBackend,
  opts: RunOptions,
): Promise<RunResult> {
  const { handle, language, stdin } = opts;
  const timeoutMs = opts.timeoutMs ?? config.runner.execTimeoutMs;
  const cmd = commandFor(language);

  if (!(await backend.fileExists(handle, cmd.entrypoint))) {
    return {
      stdout: "",
      stderr: `Missing entrypoint: ${cmd.entrypoint}`,
      exitCode: -1,
      errorType: "system",
      durationMs: 0,
      stage: "setup",
    };
  }

  if (cmd.compile) {
    let compile = await backend.exec(handle, cmd.compile.shell, timeoutMs);
    if (
      !compile.timedOut &&
      compile.exitCode !== 0 &&
      isTransientWorkspacePermissionError(compile.stderr)
    ) {
      await waitForWorkspacePermissionPropagation();
      compile = await backend.exec(handle, cmd.compile.shell, timeoutMs);
    }
    if (compile.timedOut) {
      return {
        stdout: compile.stdout,
        stderr: compile.stderr + `\n[timed out after ${timeoutMs}ms]`,
        exitCode: compile.exitCode,
        errorType: "timeout",
        durationMs: compile.durationMs,
        stage: "compile",
      };
    }
    if (compile.exitCode !== 0) {
      const workspacePermissionFailure =
        isTransientWorkspacePermissionError(compile.stderr);
      return {
        stdout: compile.stdout,
        stderr: workspacePermissionFailure
          ? "The runner couldn't read the project files after retrying. Your code is still safe; run it again."
          : compile.stderr,
        exitCode: compile.exitCode,
        errorType: workspacePermissionFailure ? "system" : "compile",
        durationMs: compile.durationMs,
        stage: workspacePermissionFailure ? "setup" : "compile",
      };
    }
  }

  const run = await backend.exec(handle, cmd.run.shell, timeoutMs, { stdin });
  if (run.timedOut) {
    return {
      stdout: run.stdout,
      stderr: run.stderr + `\n[timed out after ${timeoutMs}ms]`,
      exitCode: run.exitCode,
      errorType: "timeout",
      durationMs: run.durationMs,
      stage: "run",
    };
  }
  return {
    stdout: run.stdout,
    stderr: run.stderr,
    exitCode: run.exitCode,
    errorType: run.exitCode === 0 ? "none" : "runtime",
    durationMs: run.durationMs,
    stage: "run",
  };
}
