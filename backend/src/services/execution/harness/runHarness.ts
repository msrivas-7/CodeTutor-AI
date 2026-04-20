import crypto from "node:crypto";
import { config } from "../../../config.js";
import type {
  ExecutionBackend,
  SessionHandle,
} from "../backends/index.js";
import { parseSignedEnvelope } from "./envelope.js";
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
 * a signed stdout envelope, and always cleans up the temp files afterward.
 *
 * Phase 17 trust model: the parent generates a per-run nonce and writes it
 * into the harness's stdin (not env). The harness reads stdin to EOF,
 * closes it, and signs its result body with HMAC-SHA256 under the nonce.
 *
 * Why stdin beats env: the kernel keeps the env region (mm_struct.env_start
 * .. env_end) in process memory and exposes it via /proc/<pid>/environ. libc
 * `unsetenv` rewrites environ[] but does not zero that region, so a user-code
 * child subprocess could open /proc/<ppid>/environ and recover a nonce that
 * had only been "deleted" from os.environ / process.env. Stdin is a pipe —
 * once drained and closed, /proc/<pid>/fd/0 points at a closed pipe and the
 * data is unrecoverable. Every child subprocess the harness spawns gets
 * stdin=DEVNULL (python) / stdio:['ignore', ...] (node), so it cannot read
 * the parent's pipe even while it is still open.
 *
 * A missing or forged envelope fails closed as a generic "Test run failed"
 * error — no leak of which failure mode it was.
 *
 * The 137 exit code from `timeout --signal=KILL` surfaces as an explicit
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

  const nonce = crypto.randomBytes(32).toString("hex");
  // Give each child subprocess enough time for a golden solution's slowest
  // test but leave headroom under the wall-clock cap so the parent's own
  // envelope-emit has time to run.
  const perTestTimeoutMs = Math.max(1000, Math.floor(timeoutMs * 0.8));

  try {
    await execBackend.writeFiles(
      handle,
      files.map((f) => ({ path: f.name, content: f.content })),
    );

    const exec = await execBackend.exec(
      handle,
      harness.execCommand(),
      timeoutMs,
      {
        // Nonce goes on stdin (Phase 17): the harness reads to EOF and closes
        // stdin before spawning any user code, so the nonce never touches
        // /proc/<pid>/environ. The per-test timeout is not secret and stays
        // in env for ergonomics.
        stdin: `${nonce}\n`,
        env: {
          HARNESS_PER_TEST_TIMEOUT_MS: String(perTestTimeoutMs),
        },
      },
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

    const report = parseSignedEnvelope(exec.stdout, exec.stderr, nonce);
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
