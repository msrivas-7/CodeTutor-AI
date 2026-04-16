import Docker from "dockerode";
import { PassThrough } from "node:stream";

const docker = new Docker();

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  durationMs: number;
}

export interface ExecOptions {
  stdin?: string;
}

/**
 * Run a shell command inside the given container as the `runner` user, with a
 * hard wall-clock timeout enforced by `timeout --signal=KILL` from coreutils.
 */
export async function execShell(
  containerId: string,
  shellCommand: string,
  timeoutMs: number,
  options: ExecOptions = {}
): Promise<ExecResult> {
  const container = docker.getContainer(containerId);
  const timeoutSec = Math.max(1, Math.ceil(timeoutMs / 1000));
  const wrapped = `timeout --signal=KILL ${timeoutSec}s sh -c ${shellQuote(shellCommand)}`;
  const attachStdin = options.stdin !== undefined;

  const exec = await container.exec({
    Cmd: ["sh", "-c", wrapped],
    AttachStdin: attachStdin,
    AttachStdout: true,
    AttachStderr: true,
    WorkingDir: "/workspace",
    User: "runner",
    Tty: false,
  });

  const started = Date.now();
  const stream = await exec.start({ hijack: true, stdin: attachStdin });

  if (attachStdin) {
    // Write the provided stdin and half-close so the process sees EOF. The
    // server continues to push stdout/stderr back through the hijacked stream.
    stream.write(options.stdin ?? "");
    stream.end();
  }

  const stdoutBuf = new PassThrough();
  const stderrBuf = new PassThrough();
  docker.modem.demuxStream(stream, stdoutBuf, stderrBuf);

  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  stdoutBuf.on("data", (c: Buffer) => stdoutChunks.push(c));
  stderrBuf.on("data", (c: Buffer) => stderrChunks.push(c));

  await new Promise<void>((resolve) => {
    stream.on("end", () => resolve());
    stream.on("close", () => resolve());
  });

  const info = await exec.inspect();
  const exitCode = info.ExitCode ?? -1;
  // `timeout` exits with 137 (128 + SIGKILL) when it kills the child.
  const timedOut = exitCode === 137;

  return {
    stdout: Buffer.concat(stdoutChunks).toString("utf8"),
    stderr: Buffer.concat(stderrChunks).toString("utf8"),
    exitCode,
    timedOut,
    durationMs: Date.now() - started,
  };
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
