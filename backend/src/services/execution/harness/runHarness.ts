import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../../../config.js";
import { execShell } from "../../docker/dockerExec.js";
import type {
  HarnessBackend,
  RunTestsOptions,
  RunTestsResult,
} from "./types.js";

/**
 * Language-agnostic harness runner. Writes the backend's temp files into the
 * workspace, execs the backend's command inside the session container, parses
 * stdout via the backend, and always cleans up the temp files afterward. The
 * 137 exit code from `timeout --signal=KILL` surfaces as an explicit
 * harnessError so the UI can say "timed out" rather than showing empty
 * results.
 */
export async function runTests(
  backend: HarnessBackend,
  opts: RunTestsOptions,
): Promise<RunTestsResult> {
  const { containerId, workspacePath, tests } = opts;
  const timeoutMs = opts.timeoutMs ?? config.runner.execTimeoutMs;
  const files = backend.prepareFiles(tests);
  const absolutePaths = files.map((f) => path.join(workspacePath, f.name));

  try {
    for (let i = 0; i < files.length; i++) {
      await fs.writeFile(absolutePaths[i], files[i].content, "utf8");
      await fs.chmod(absolutePaths[i], 0o666).catch(() => {});
    }

    const exec = await execShell(
      containerId,
      backend.execCommand(),
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

    const report = backend.parseOutput(exec.stdout, exec.stderr);
    return {
      report,
      stderr: exec.stderr,
      exitCode: exec.exitCode,
      timedOut: false,
      durationMs: exec.durationMs,
    };
  } finally {
    await Promise.all(
      absolutePaths.map((p) => fs.rm(p, { force: true }).catch(() => {})),
    );
  }
}
