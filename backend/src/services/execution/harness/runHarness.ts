import { config } from "../../../config.js";
import type {
  ExecutionBackend,
  SessionHandle,
} from "../backends/index.js";
import type {
  FunctionTest,
  HarnessBackend,
  RunTestsResult,
} from "./types.js";

export interface RunTestsOptions {
  handle: SessionHandle;
  tests: FunctionTest[];
  timeoutMs?: number;
}

/**
 * Language-agnostic harness runner. Writes the backend's temp files into the
 * workspace, execs the backend's command inside the session container, parses
 * stdout via the backend, and always cleans up the temp files afterward. The
 * 137 exit code from `timeout --signal=KILL` surfaces as an explicit
 * harnessError so the UI can say "timed out" rather than showing empty
 * results.
 */
export async function runTests(
  execBackend: ExecutionBackend,
  harness: HarnessBackend,
  opts: RunTestsOptions,
): Promise<RunTestsResult> {
  const { handle, tests } = opts;
  const timeoutMs = opts.timeoutMs ?? config.runner.execTimeoutMs;
  const files = harness.prepareFiles(tests);
  const filePaths = files.map((f) => f.name);

  try {
    await execBackend.writeFiles(
      handle,
      files.map((f) => ({ path: f.name, content: f.content })),
    );

    const exec = await execBackend.exec(
      handle,
      harness.execCommand(),
      timeoutMs,
      { stdin: "" },
    );

    const timedOut = exec.exitCode === 137;
    if (timedOut) {
      return {
        report: {
          results: [],
          harnessError: `Tests timed out after ${timeoutMs}ms. Check for infinite loops.`,
          cleanStdout: exec.stdout,
        },
        stderr: exec.stderr,
        exitCode: exec.exitCode,
        timedOut: true,
        durationMs: exec.durationMs,
      };
    }

    const report = harness.parseOutput(exec.stdout, exec.stderr);
    return {
      report,
      stderr: exec.stderr,
      exitCode: exec.exitCode,
      timedOut: false,
      durationMs: exec.durationMs,
    };
  } finally {
    await execBackend.removeFiles(handle, filePaths);
  }
}
