import fs from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import { config } from "../../config.js";
import {
  createSessionContainer,
  destroyContainer,
  getHostWorkspaceRoot,
  isContainerAlive,
  joinHostPath,
} from "../docker/dockerService.js";

export interface SessionRecord {
  id: string;
  containerId: string | null;
  // Backend-internal path used for fs.* I/O (always a Linux path, since the
  // backend runs in a Linux container on every host OS).
  workspacePath: string;
  // Host-side path passed to the Docker daemon when spawning sibling
  // runner containers. Format depends on host OS — stored verbatim from
  // Docker's own self-inspect response. Do not conflate with workspacePath.
  hostWorkspacePath: string;
  lastSeen: number;
  createdAt: number;
  selectedModel: string | null;
}

const sessions = new Map<string, SessionRecord>();

async function ensureWorkspaceDir(sessionId: string): Promise<string> {
  const dir = path.posix.join(config.workspaceRoot, sessionId);
  await fs.mkdir(dir, { recursive: true });
  // Runner container runs as uid/gid 1100; allow it to write.
  await fs.chmod(dir, 0o777).catch(() => {});
  return dir;
}

/**
 * Best-effort workspace cleanup. On Windows, Defender and other scanners
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

// Only accept IDs the same shape nanoid produces — prevents a client from
// pushing a path-traversal string into the workspace path.
const ID_RE = /^[A-Za-z0-9_-]{8,32}$/;

export async function startSession(requestedId?: string): Promise<SessionRecord> {
  // If the frontend asks to reuse an ID (orphan recovery), we honor it as long
  // as it's not already live — keeps logs coherent and the UI badge stable.
  const canReuse = requestedId && ID_RE.test(requestedId) && !sessions.has(requestedId);
  const id = canReuse ? requestedId! : nanoid(12);
  const workspacePath = await ensureWorkspaceDir(id);
  const hostWorkspacePath = joinHostPath(getHostWorkspaceRoot(), id);
  const { id: containerId } = await createSessionContainer(id, hostWorkspacePath);
  const now = Date.now();
  const record: SessionRecord = {
    id,
    containerId,
    workspacePath,
    hostWorkspacePath,
    lastSeen: now,
    createdAt: now,
    selectedModel: null,
  };
  sessions.set(id, record);
  return record;
}

// Called by the frontend when its heartbeat discovers the session is gone.
// If the requested ID is still live (false alarm), we return it untouched and
// flag `reused=true`. Otherwise we provision a fresh container under the same
// ID so the UI badge and log prefixes don't change.
export async function rebindSession(id: string): Promise<{ record: SessionRecord; reused: boolean }> {
  const existing = sessions.get(id);
  if (existing) {
    existing.lastSeen = Date.now();
    return { record: existing, reused: true };
  }
  const record = await startSession(id);
  return { record, reused: false };
}

export function getSession(id: string): SessionRecord | undefined {
  return sessions.get(id);
}

export function pingSession(id: string): boolean {
  const s = sessions.get(id);
  if (!s) return false;
  s.lastSeen = Date.now();
  return true;
}

export async function endSession(id: string): Promise<boolean> {
  const s = sessions.get(id);
  if (!s) return false;
  sessions.delete(id);
  if (s.containerId) await destroyContainer(s.containerId);
  await removeWorkspaceDir(s.workspacePath);
  return true;
}

export async function getSessionStatus(id: string) {
  const s = sessions.get(id);
  if (!s) return { alive: false, containerAlive: false, lastSeen: 0 };
  const containerAlive = s.containerId ? await isContainerAlive(s.containerId) : false;
  return { alive: true, containerAlive, lastSeen: s.lastSeen };
}

export function listSessions(): SessionRecord[] {
  return [...sessions.values()];
}

export async function sweepStaleSessions(now = Date.now()): Promise<string[]> {
  const expired: string[] = [];
  for (const s of sessions.values()) {
    if (now - s.lastSeen > config.session.idleTimeoutMs) expired.push(s.id);
  }
  await Promise.all(expired.map(endSession));
  return expired;
}

let sweeper: NodeJS.Timeout | null = null;

export function startSweeper(): void {
  if (sweeper) return;
  sweeper = setInterval(async () => {
    try {
      const killed = await sweepStaleSessions();
      if (killed.length) {
        console.log(`[session-sweeper] reaped ${killed.length}: ${killed.join(", ")}`);
      }
    } catch (err) {
      console.error("[session-sweeper] error", err);
    }
  }, config.session.sweepIntervalMs);
}

export async function shutdownAllSessions(): Promise<void> {
  if (sweeper) clearInterval(sweeper);
  sweeper = null;
  const ids = [...sessions.keys()];
  await Promise.all(ids.map(endSession));
}
