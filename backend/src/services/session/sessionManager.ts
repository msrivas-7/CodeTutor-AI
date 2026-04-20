import { nanoid } from "nanoid";
import { config } from "../../config.js";
import type {
  ExecutionBackend,
  SessionHandle,
} from "../execution/backends/index.js";

export interface SessionRecord {
  id: string;
  /**
   * Opaque runtime reference returned by the ExecutionBackend. Null only
   * during teardown. Callers that need to run code against the session MUST
   * go through `requireActiveSession` which narrows this to non-null.
   */
  handle: SessionHandle | null;
  lastSeen: number;
  createdAt: number;
  selectedModel: string | null;
}

const sessions = new Map<string, SessionRecord>();

let backend: ExecutionBackend | null = null;

/**
 * Inject the ExecutionBackend used for all session lifecycle. Must be called
 * once from the app bootstrap before any route handler runs.
 */
export function initSessionManager(b: ExecutionBackend): void {
  backend = b;
}

function requireBackend(): ExecutionBackend {
  if (!backend) {
    throw new Error(
      "session manager used before initSessionManager() — bootstrap order bug",
    );
  }
  return backend;
}

// Only accept IDs the same shape nanoid produces — prevents a client from
// pushing a path-traversal string into the workspace path.
const ID_RE = /^[A-Za-z0-9_-]{8,32}$/;

export async function startSession(requestedId?: string): Promise<SessionRecord> {
  // If the frontend asks to reuse an ID (orphan recovery), honor it as long
  // as it's not already live — keeps logs coherent and the UI badge stable.
  const canReuse = requestedId && ID_RE.test(requestedId) && !sessions.has(requestedId);
  const id = canReuse ? requestedId! : nanoid(12);
  const handle = await requireBackend().createSession({ sessionId: id });
  const now = Date.now();
  const record: SessionRecord = {
    id,
    handle,
    lastSeen: now,
    createdAt: now,
    selectedModel: null,
  };
  sessions.set(id, record);
  return record;
}

// Called by the frontend when its heartbeat discovers the session is gone.
// If the requested ID is still live (false alarm), return it untouched and
// flag `reused=true`. Otherwise provision a fresh container under the same
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
  if (s.handle) await requireBackend().destroy(s.handle);
  return true;
}

export async function getSessionStatus(id: string) {
  const s = sessions.get(id);
  if (!s) return { alive: false, containerAlive: false, lastSeen: 0 };
  const containerAlive = s.handle ? await requireBackend().isAlive(s.handle) : false;
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
