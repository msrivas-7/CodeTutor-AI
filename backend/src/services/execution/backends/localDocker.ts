import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Docker from "dockerode";
import { PassThrough } from "node:stream";
import { safeResolve } from "../../project/snapshot.js";
import type {
  ExecOptions,
  ExecResult,
  ExecutionBackend,
  RuntimeSpec,
  SessionHandle,
  WorkspaceFile,
} from "./types.js";

interface LocalDockerHandle extends SessionHandle {
  readonly __kind: "local-docker";
  readonly containerId: string;
  /** Backend-internal path (always Linux-shaped — backend runs in a Linux container). */
  readonly workspacePath: string;
  /** Host-side path used for Docker binds; OS-dependent format. */
  readonly hostWorkspacePath: string;
}

export interface LocalDockerBackendOptions {
  runnerImage: string;
  workspaceRoot: string;
  runner: {
    memoryBytes: number;
    nanoCpus: number;
  };
  /** Optional bare-metal-dev override; skips self-inspect discovery when set. */
  hostWorkspaceRootOverride?: string;
}

export class LocalDockerBackend implements ExecutionBackend {
  readonly kind = "local-docker";
  private docker: Docker;
  private hostWorkspaceRoot: string | null = null;

  constructor(private readonly opts: LocalDockerBackendOptions) {
    this.docker = new Docker();
  }

  async ensureReady(): Promise<void> {
    this.hostWorkspaceRoot = await this.resolveHostWorkspaceRoot();
    console.log(`[local-docker] host workspace root: ${this.hostWorkspaceRoot}`);

    try {
      await this.docker.getImage(this.opts.runnerImage).inspect();
      console.log(`[local-docker] runner image ready: ${this.opts.runnerImage}`);
    } catch {
      // Preserve prior behaviour: boot the backend anyway; surface the problem
      // when a session is actually created.
      console.warn(
        `[local-docker] runner image "${this.opts.runnerImage}" not found. ` +
          `Build it first: docker build -t ${this.opts.runnerImage} ./runner-image`,
      );
      console.warn(
        "[local-docker] backend will continue; session creation will fail until the image exists.",
      );
    }
  }

  async createSession(spec: RuntimeSpec): Promise<SessionHandle> {
    const root = this.requireHostRoot();
    const workspacePath = path.posix.join(this.opts.workspaceRoot, spec.sessionId);
    const hostWorkspacePath = joinHostPath(root, spec.sessionId);

    await fs.mkdir(workspacePath, { recursive: true });
    // Runner image runs as uid/gid 1100; allow it to write.
    await fs.chmod(workspacePath, 0o777).catch(() => {});

    const container = await this.docker.createContainer({
      Image: this.opts.runnerImage,
      name: `codetutor-ai-session-${spec.sessionId}`,
      Cmd: ["sleep", "infinity"],
      WorkingDir: "/workspace",
      User: "runner",
      Tty: false,
      AttachStdout: false,
      AttachStderr: false,
      NetworkDisabled: true,
      HostConfig: {
        AutoRemove: true,
        NetworkMode: "none",
        Memory: this.opts.runner.memoryBytes,
        NanoCpus: this.opts.runner.nanoCpus,
        PidsLimit: 256,
        Binds: [`${hostWorkspacePath}:/workspace`],
        SecurityOpt: ["no-new-privileges"],
      },
    });
    await container.start();

    const handle: LocalDockerHandle = {
      sessionId: spec.sessionId,
      __kind: "local-docker",
      containerId: container.id,
      workspacePath,
      hostWorkspacePath,
    };
    return handle;
  }

  async isAlive(handle: SessionHandle): Promise<boolean> {
    const h = this.cast(handle);
    try {
      const info = await this.docker.getContainer(h.containerId).inspect();
      return info.State.Running === true;
    } catch {
      return false;
    }
  }

  async destroy(handle: SessionHandle): Promise<void> {
    const h = this.cast(handle);
    try {
      const c = this.docker.getContainer(h.containerId);
      await c.stop({ t: 1 }).catch(() => {});
      // AutoRemove deletes it; force-remove only if it lingers.
      await c.remove({ force: true }).catch(() => {});
    } catch {
      /* already gone */
    }
    await removeWorkspaceDir(h.workspacePath);
  }

  async exec(
    handle: SessionHandle,
    command: string,
    timeoutMs: number,
    options: ExecOptions = {},
  ): Promise<ExecResult> {
    const h = this.cast(handle);
    const container = this.docker.getContainer(h.containerId);
    const timeoutSec = Math.max(1, Math.ceil(timeoutMs / 1000));
    const wrapped = `timeout --signal=KILL ${timeoutSec}s sh -c ${shellQuote(command)}`;
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
      stream.write(options.stdin ?? "");
      stream.end();
    }

    const stdoutBuf = new PassThrough();
    const stderrBuf = new PassThrough();
    this.docker.modem.demuxStream(stream, stdoutBuf, stderrBuf);

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
    // `timeout` exits 137 (128 + SIGKILL) when it kills the child.
    const timedOut = exitCode === 137;

    return {
      stdout: Buffer.concat(stdoutChunks).toString("utf8"),
      stderr: Buffer.concat(stderrChunks).toString("utf8"),
      exitCode,
      timedOut,
      durationMs: Date.now() - started,
    };
  }

  async writeFiles(
    handle: SessionHandle,
    files: WorkspaceFile[],
  ): Promise<void> {
    const h = this.cast(handle);
    for (const f of files) {
      const abs = safeResolve(h.workspacePath, f.path);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, f.content, "utf8");
      await fs.chmod(abs, 0o666).catch(() => {});
    }
  }

  async removeFiles(
    handle: SessionHandle,
    paths: string[],
  ): Promise<void> {
    const h = this.cast(handle);
    await Promise.all(
      paths.map(async (p) => {
        try {
          const abs = safeResolve(h.workspacePath, p);
          await fs.rm(abs, { force: true });
        } catch {
          /* invalid path or already gone — ignore */
        }
      }),
    );
  }

  async fileExists(
    handle: SessionHandle,
    relativePath: string,
  ): Promise<boolean> {
    const h = this.cast(handle);
    try {
      const abs = safeResolve(h.workspacePath, relativePath);
      await fs.access(abs);
      return true;
    } catch {
      return false;
    }
  }

  async replaceSnapshot(
    handle: SessionHandle,
    files: WorkspaceFile[],
  ): Promise<void> {
    const h = this.cast(handle);
    // Wipe workspace contents — but not the directory itself: the runner
    // container has a bind mount on this path and recreating the directory
    // would invalidate the mount's inode.
    await fs.mkdir(h.workspacePath, { recursive: true });
    await fs.chmod(h.workspacePath, 0o777).catch(() => {});
    const entries = await fs.readdir(h.workspacePath);
    await Promise.all(
      entries.map((name) =>
        fs.rm(path.join(h.workspacePath, name), { recursive: true, force: true }),
      ),
    );
    await this.writeFiles(handle, files);
  }

  // --- Host-path discovery (local-docker-specific) ------------------------

  private async resolveHostWorkspaceRoot(): Promise<string> {
    if (this.opts.hostWorkspaceRootOverride) {
      return this.opts.hostWorkspaceRootOverride;
    }

    const candidates = [os.hostname(), await readContainerIdFromCgroup()].filter(
      (id): id is string => typeof id === "string" && id.length > 0,
    );

    for (const id of candidates) {
      try {
        const info = await this.docker.getContainer(id).inspect();
        const mount = info.Mounts.find(
          (m) => m.Destination === this.opts.workspaceRoot && m.Type === "bind",
        );
        if (mount) return mount.Source;
      } catch {
        /* try next candidate */
      }
    }

    throw new Error(
      `Could not resolve host workspace path. Expected a bind mount at ` +
        `"${this.opts.workspaceRoot}" on the backend container. Check that ` +
        `docker-compose.yml mounts "./temp/sessions:${this.opts.workspaceRoot}", ` +
        `or set WORKSPACE_ROOT_HOST explicitly.`,
    );
  }

  private requireHostRoot(): string {
    if (!this.hostWorkspaceRoot) {
      throw new Error(
        "LocalDockerBackend.ensureReady() must run before any session is created.",
      );
    }
    return this.hostWorkspaceRoot;
  }

  private cast(handle: SessionHandle): LocalDockerHandle {
    if (handle.__kind !== "local-docker") {
      throw new Error(
        `LocalDockerBackend received a handle from a different backend: ${handle.__kind}`,
      );
    }
    return handle as LocalDockerHandle;
  }
}

// --- Free-standing helpers (exported for unit tests) -----------------------

/**
 * Join a session ID onto the host workspace root using whatever separator
 * the root itself uses. Docker Desktop on Windows returns backslash paths
 * (`C:\Users\…`) and expects backslashes back; macOS/Linux use forward
 * slashes. Preserve the caller's format instead of guessing from
 * `process.platform` — the backend always runs on Linux regardless of host OS.
 */
export function joinHostPath(root: string, segment: string): string {
  const sep = root.includes("\\") ? "\\" : "/";
  const trimmedRoot = root.replace(/[\\/]+$/, "");
  return `${trimmedRoot}${sep}${segment}`;
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

async function readContainerIdFromCgroup(): Promise<string | null> {
  try {
    const cgroup = await fs.readFile("/proc/self/cgroup", "utf8");
    const match = cgroup.match(/[0-9a-f]{64}/);
    if (match) return match[0];
  } catch {
    /* not running in a cgroup we can read */
  }
  try {
    const etc = (await fs.readFile("/etc/hostname", "utf8")).trim();
    if (etc) return etc;
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Best-effort workspace cleanup. On Windows, Defender and similar tools
 * occasionally hold file handles briefly, causing EBUSY/EPERM from fs.rm;
 * retry a couple of times before giving up silently.
 */
async function removeWorkspaceDir(dir: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
    }
  }
}
