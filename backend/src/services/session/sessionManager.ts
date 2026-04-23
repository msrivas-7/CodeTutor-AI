import { nanoid } from "nanoid";
import { config } from "../../config.js";
import { HttpError } from "../../middleware/errorHandler.js";
import type {
  ExecutionBackend,
  SessionHandle,
} from "../execution/backends/index.js";

export interface SessionRecord {
  id: string;
  /**
   * Phase 18a: the Supabase user who created this session. Every mutating
   * route is gated on `record.userId === req.userId` — see
   * `requireOwnedSession`. A null userId is only produced by legacy callers
   * during tests; production code always threads the authenticated user.
   */
  userId: string;
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

/**
 * QA-L5: a per-process boot identifier. Included in every session route
 * response so the frontend can tell "my session was individually reaped"
 * (same bootId, 404 on ping) from "the whole process restarted and took
 * every session with it" (different bootId). Without the distinction the
 * frontend treats both as ordinary 404→rebind, which is fine for the first
 * ping but starts to loop if many tabs all race a cold backend — each tab's
 * rebind would compete for cap slots on a process that's still booting
 * dependencies. On a mismatch the frontend instead shows the replaced-
 * session modal and waits for the user to click Retry.
 */
export const BACKEND_BOOT_ID = nanoid();

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

function countPerUser(userId: string): number {
  let n = 0;
  for (const s of sessions.values()) if (s.userId === userId) n++;
  return n;
}

/**
 * Phase 20-P3: sweep sessions whose container is no longer running (OOM kill,
 * docker daemon restart, crash during cleanup) and purge the in-memory
 * record. Under the per-user / global caps, a dead container still occupies
 * a slot until the 45s sweeper tick notices idle — which locks the real
 * user out of their own account. We only call this in the cap-rejection
 * path, so inspect cost is bounded to that rare case.
 *
 * Ownership scope is caller-chosen:
 *   - `{ userId }`: only sessions for that user (per-user cap rescue)
 *   - `undefined`: every session (global cap rescue)
 */
// P-M3: single in-flight reap per scope. The cap-rejection path used to
// await a Promise.all of `docker.isAlive` across every candidate session,
// turning every rejected /session request into a fan-out of Docker syscalls
// on a host already at capacity. We now fire-and-forget a reap and return
// 429 Retry-After: 2 immediately — the reaper runs in the background, the
// next retry (2 s later per the header) finds the freed slot.
let reapInFlightGlobal: Promise<number> | null = null;
const reapInFlightPerUser = new Map<string, Promise<number>>();

function kickReap(scope?: { userId: string }): void {
  if (scope) {
    if (reapInFlightPerUser.has(scope.userId)) return;
    const p = reapDeadSessions(scope).finally(() => {
      reapInFlightPerUser.delete(scope.userId);
    });
    reapInFlightPerUser.set(scope.userId, p);
    return;
  }
  if (reapInFlightGlobal) return;
  reapInFlightGlobal = reapDeadSessions().finally(() => {
    reapInFlightGlobal = null;
  });
}

async function reapDeadSessions(
  scope?: { userId: string },
): Promise<number> {
  const b = requireBackend();
  const candidates = [...sessions.values()].filter(
    (s) => !scope || s.userId === scope.userId,
  );
  const deadness = await Promise.all(
    candidates.map(async (s) => {
      if (!s.handle) return s; // no handle → treat as dead
      const alive = await b.isAlive(s.handle).catch(() => false);
      return alive ? null : s;
    }),
  );
  let reaped = 0;
  for (const s of deadness) {
    if (!s) continue;
    sessions.delete(s.id);
    if (s.handle) await b.destroy(s.handle).catch(() => {});
    reaped++;
  }
  if (reaped) {
    console.log(
      `[session] reaped ${reaped} zombie session(s)` +
        (scope ? ` for user ${scope.userId}` : " globally"),
    );
  }
  return reaped;
}

export async function startSession(
  userId: string,
  requestedId?: string,
): Promise<SessionRecord> {
  // Phase 20-P3: cap enforcement before any container work. Per-user first
  // (the common abusive case — one learner spamming refresh), then global
  // (protects the VM even if caps bypass via many users). 429 lets the
  // frontend retry after a session is reaped by the sweeper; 503 signals
  // capacity exhaustion that won't resolve by retry. Both throw before we
  // touch Docker, so a rejected request is cheap.
  //
  // P-M3: fire-and-forget reap of dead zombies. An OOM-killed or crashed
  // container would otherwise occupy a cap slot until the 45s sweeper tick,
  // locking the real user out of their own account. The previous code did an
  // inline `await Promise.all(candidates.map(docker.isAlive))` on every
  // cap-rejection, which fanned out Docker syscalls on a host already at
  // capacity. We now kick the reap in the background and respond with
  // Retry-After: 2 — the next retry finds the freed slot.
  if (countPerUser(userId) >= config.session.maxPerUser) {
    kickReap({ userId });
    throw new HttpError(
      429,
      `session limit reached: max ${config.session.maxPerUser} per account`,
      { "Retry-After": "2" },
    );
  }
  if (sessions.size >= config.session.maxGlobal) {
    kickReap();
    throw new HttpError(
      503,
      "server at capacity, try again shortly",
      { "Retry-After": "5" },
    );
  }

  // If the frontend asks to reuse an ID (orphan recovery), honor it as long
  // as it's not already live — keeps logs coherent and the UI badge stable.
  const canReuse = requestedId && ID_RE.test(requestedId) && !sessions.has(requestedId);
  const id = canReuse ? requestedId! : nanoid(12);
  const handle = await requireBackend().createSession({ sessionId: id });
  const now = Date.now();
  const record: SessionRecord = {
    id,
    userId,
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
//
// Ownership: if a learner asks to rebind an id that is actually live under
// another user, we do NOT reveal that fact. Returning 403 would be an
// existence oracle (attacker learns the id is taken). Instead we silently
// mint a fresh nanoid, which is also what happens in the normal "not
// found" path after a container reap. The caller sees a brand-new id and
// moves on, and the real owner's session is untouched.
export async function rebindSession(
  id: string,
  userId: string,
): Promise<{ record: SessionRecord; reused: boolean }> {
  const existing = sessions.get(id);
  if (existing) {
    if (existing.userId !== userId) {
      // Mint a fresh id rather than leak existence of the other user's
      // session. `startSession` without a requestedId generates a new nanoid.
      const record = await startSession(userId);
      return { record, reused: false };
    }
    existing.lastSeen = Date.now();
    return { record: existing, reused: true };
  }
  const record = await startSession(userId, id);
  return { record, reused: false };
}

export function getSession(id: string): SessionRecord | undefined {
  return sessions.get(id);
}

/**
 * Canonical ownership check. Returns 404 for both unknown-session and
 * owner-mismatch to avoid an enumeration oracle (a 403 would let an
 * attacker bisect the ID space by distinguishing "exists, not mine" from
 * "does not exist"). A legitimate caller has their own sessionId and
 * never sees a 404 for one they own.
 */
export function requireOwnedSession(
  id: string,
  userId: string,
): SessionRecord {
  const s = sessions.get(id);
  if (!s || s.userId !== userId) throw new HttpError(404, "session not found");
  return s;
}

export function pingSession(id: string, userId: string): boolean {
  const s = sessions.get(id);
  if (!s) return false;
  if (s.userId !== userId) return false;
  s.lastSeen = Date.now();
  return true;
}

/**
 * Internal variant used by routes that have already executed the ownership
 * gate (e.g. after requireActiveSession). Skips the userId check because the
 * caller just proved ownership in the same request. Do NOT export beyond
 * this module's route layer.
 */
export function touchSession(id: string): void {
  const s = sessions.get(id);
  if (s) s.lastSeen = Date.now();
}

export async function endSession(id: string, userId: string): Promise<boolean> {
  const s = sessions.get(id);
  // Owner-mismatch collapses to the same "false" response as unknown-id so
  // callers can't distinguish the two (enumeration-oracle defense).
  if (!s || s.userId !== userId) return false;
  sessions.delete(id);
  if (s.handle) await requireBackend().destroy(s.handle);
  return true;
}

export async function getSessionStatus(id: string, userId: string) {
  const s = sessions.get(id);
  // Same rationale as endSession: return the "unknown" shape for both
  // unknown-id and cross-user reads so the caller can't tell the difference.
  if (!s || s.userId !== userId) return { alive: false, containerAlive: false, lastSeen: 0 };
  const containerAlive = s.handle ? await requireBackend().isAlive(s.handle) : false;
  if (!containerAlive) {
    // Phase 20-P3: the container died out from under us (OOM, docker
    // restart, crashed teardown). Purge the record now so the caller's
    // heartbeat triggers a clean rebind immediately, and the freed slot
    // isn't charged against the cap. Without this the learner can be
    // locked out of their own account for up to 2 minutes waiting for
    // the sweeper to notice idle.
    sessions.delete(id);
    if (s.handle) {
      await requireBackend().destroy(s.handle).catch(() => {});
    }
    return { alive: false, containerAlive: false, lastSeen: s.lastSeen };
  }
  return { alive: true, containerAlive, lastSeen: s.lastSeen };
}

export function listSessions(): SessionRecord[] {
  return [...sessions.values()];
}

export async function sweepStaleSessions(now = Date.now()): Promise<string[]> {
  const expired: SessionRecord[] = [];
  for (const s of sessions.values()) {
    if (now - s.lastSeen > config.session.idleTimeoutMs) expired.push(s);
  }
  // Internal sweep: we already know the record, so short-circuit the
  // ownership-aware endSession path and tear down directly.
  await Promise.all(
    expired.map(async (s) => {
      sessions.delete(s.id);
      if (s.handle) await requireBackend().destroy(s.handle);
    }),
  );
  return expired.map((s) => s.id);
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

// Phase 20-P0 #9: destroy every live session owned by a single user. Called
// from the delete-account path before we tell Supabase to remove the user,
// so there are no zombie runner containers charging us CPU minutes after
// the owning account is gone. Returns the list of destroyed session ids
// purely for logging.
export async function destroyUserSessions(userId: string): Promise<string[]> {
  const owned = [...sessions.values()].filter((s) => s.userId === userId);
  await Promise.all(
    owned.map(async (s) => {
      sessions.delete(s.id);
      if (s.handle) {
        try {
          await requireBackend().destroy(s.handle);
        } catch (err) {
          // Individual teardown failures shouldn't block account deletion —
          // the sweeper will reap any stragglers, and the row going away
          // from auth.users cascades the user's data regardless.
          console.error(`[session] destroy ${s.id} failed`, err);
        }
      }
    }),
  );
  return owned.map((s) => s.id);
}

const SHUTDOWN_DESTROY_TIMEOUT_MS = 5_000;

async function destroyWithTimeout(handle: unknown, sessionId: string): Promise<void> {
  // S-20 (bucket 7): one hung docker-destroy would block the whole shutdown
  // until systemd's TimeoutStopSec → SIGKILL → orphan container leak. Cap
  // each destroy at 5 s and let `purgeOrphanRunnerContainers` (startup-time
  // orphan sweeper) catch any left behind on the next boot.
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<void>((_resolve, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            `destroy timeout after ${SHUTDOWN_DESTROY_TIMEOUT_MS} ms for session ${sessionId}`,
          ),
        ),
      SHUTDOWN_DESTROY_TIMEOUT_MS,
    );
  });
  try {
    await Promise.race([requireBackend().destroy(handle as never), deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function shutdownAllSessions(): Promise<void> {
  if (sweeper) clearInterval(sweeper);
  sweeper = null;
  const ids = [...sessions.keys()];
  await Promise.allSettled(
    ids.map(async (id) => {
      const s = sessions.get(id);
      if (!s) return;
      sessions.delete(id);
      if (!s.handle) return;
      try {
        await destroyWithTimeout(s.handle, id);
      } catch (err) {
        console.error(`[shutdown] destroy ${id} failed`, err);
      }
    }),
  );
}
