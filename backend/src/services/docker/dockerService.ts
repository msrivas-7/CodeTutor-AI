import fs from "node:fs/promises";
import os from "node:os";
import Docker from "dockerode";
import { config } from "../../config.js";

const docker = new Docker();

export interface CreatedContainer {
  id: string;
}

// --- Host-path discovery ------------------------------------------------
// The backend runs inside a Linux container on every host OS, but the Docker
// daemon on the HOST needs real host-side paths when we ask it to spawn a
// sibling runner container with a bind mount. Those paths look different on
// each OS (Linux: /home/…, macOS: /Users/…, Windows Docker Desktop:
// C:\Users\…). Instead of hard-coding any of that, we ask Docker itself what
// the source of our own /workspace-root mount is — that's guaranteed to be in
// whatever format Docker expects back for Binds on this host.

let cachedHostWorkspaceRoot: string | null = null;

/**
 * Read a Docker-assigned container ID from cgroup/hostname files. Used as a
 * fallback when `os.hostname()` has been overridden (e.g. by `docker run
 * --hostname=foo`).
 */
async function readContainerIdFromCgroup(): Promise<string | null> {
  try {
    const cgroup = await fs.readFile("/proc/self/cgroup", "utf8");
    const match = cgroup.match(/[0-9a-f]{64}/);
    if (match) return match[0];
  } catch { /* not running inside a cgroup we can read — skip */ }
  try {
    const etc = (await fs.readFile("/etc/hostname", "utf8")).trim();
    if (etc) return etc;
  } catch { /* ignore */ }
  return null;
}

async function findSelfMountSource(containerId: string): Promise<string | null> {
  const info = await docker.getContainer(containerId).inspect();
  const mount = info.Mounts.find(
    (m) => m.Destination === config.workspaceRoot && m.Type === "bind"
  );
  return mount ? mount.Source : null;
}

/**
 * Resolve the host-side path that corresponds to the backend's internal
 * `config.workspaceRoot`. Must be called once at startup, before any session
 * is created. Throws if no path can be determined.
 *
 * Precedence:
 *   1. `WORKSPACE_ROOT_HOST` env override (bare-metal dev escape hatch).
 *   2. Docker self-inspect via `os.hostname()` → Mounts[].Source.
 *   3. Docker self-inspect via cgroup/hostname file fallback.
 */
export async function resolveHostWorkspaceRoot(): Promise<string> {
  if (cachedHostWorkspaceRoot) return cachedHostWorkspaceRoot;

  if (config.hostWorkspaceRootOverride) {
    cachedHostWorkspaceRoot = config.hostWorkspaceRootOverride;
    return cachedHostWorkspaceRoot;
  }

  const candidates = [os.hostname(), await readContainerIdFromCgroup()].filter(
    (id): id is string => typeof id === "string" && id.length > 0
  );

  for (const id of candidates) {
    try {
      const source = await findSelfMountSource(id);
      if (source) {
        cachedHostWorkspaceRoot = source;
        return cachedHostWorkspaceRoot;
      }
    } catch { /* try next candidate */ }
  }

  throw new Error(
    `Could not resolve host workspace path. Expected a bind mount at ` +
      `"${config.workspaceRoot}" on the backend container. Check that ` +
      `docker-compose.yml mounts "./temp/sessions:${config.workspaceRoot}", ` +
      `or set WORKSPACE_ROOT_HOST explicitly.`
  );
}

export function getHostWorkspaceRoot(): string {
  if (!cachedHostWorkspaceRoot) {
    throw new Error(
      "Host workspace root not initialised — resolveHostWorkspaceRoot() must run before any session is created."
    );
  }
  return cachedHostWorkspaceRoot;
}

/**
 * Join a session ID onto the host workspace root using whatever separator
 * the root itself uses. Docker Desktop on Windows returns backslash paths
 * like `C:\Users\…\temp\sessions` and expects backslashes back; macOS/Linux
 * return forward-slash paths. We simply preserve the caller's format
 * instead of guessing from `process.platform` (which is wrong — the backend
 * always runs on Linux regardless of host OS).
 */
export function joinHostPath(root: string, segment: string): string {
  const sep = root.includes("\\") ? "\\" : "/";
  const trimmedRoot = root.replace(/[\\/]+$/, "");
  return `${trimmedRoot}${sep}${segment}`;
}

// --- Container lifecycle -----------------------------------------------

export async function ensureRunnerImage(): Promise<void> {
  try {
    await docker.getImage(config.runnerImage).inspect();
  } catch {
    throw new Error(
      `Runner image "${config.runnerImage}" not found. Build it first: ` +
        `docker build -t ${config.runnerImage} ./runner-image`
    );
  }
}

export async function createSessionContainer(
  sessionId: string,
  hostWorkspacePath: string
): Promise<CreatedContainer> {
  const container = await docker.createContainer({
    Image: config.runnerImage,
    name: `ai-code-editor-session-${sessionId}`,
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
      Memory: config.runner.memoryBytes,
      NanoCpus: config.runner.nanoCpus,
      PidsLimit: 256,
      Binds: [`${hostWorkspacePath}:/workspace`],
      SecurityOpt: ["no-new-privileges"],
    },
  });
  await container.start();
  return { id: container.id };
}

export async function destroyContainer(id: string): Promise<void> {
  try {
    const c = docker.getContainer(id);
    await c.stop({ t: 1 }).catch(() => {});
    // AutoRemove should delete it; force-remove if it lingers.
    await c.remove({ force: true }).catch(() => {});
  } catch {
    /* already gone */
  }
}

export async function isContainerAlive(id: string): Promise<boolean> {
  try {
    const info = await docker.getContainer(id).inspect();
    return info.State.Running === true;
  } catch {
    return false;
  }
}
