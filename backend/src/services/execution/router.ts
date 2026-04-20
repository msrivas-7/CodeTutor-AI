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
    const compile = await backend.exec(handle, cmd.compile.shell, timeoutMs);
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
      return {
        stdout: compile.stdout,
        stderr: compile.stderr,
        exitCode: compile.exitCode,
        errorType: "compile",
        durationMs: compile.durationMs,
        stage: "compile",
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
