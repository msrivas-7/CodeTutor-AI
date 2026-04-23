import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  destroyUserSessions,
  endSession,
  getSession,
  getSessionStatus,
  initSessionManager,
  listSessions,
  pingSession,
  rebindSession,
  requireOwnedSession,
  shutdownAllSessions,
  startSession,
} from "./sessionManager.js";
import { HttpError } from "../../middleware/errorHandler.js";
import type {
  ExecutionBackend,
  SessionHandle,
} from "../execution/backends/index.js";

// Phase 18a / M-A5: every session lookup is a candidate cross-user leak.
// We stand up a fake ExecutionBackend (no Docker) and assert the ownership
// gates around rebind / ping / end / status / requireOwnedSession.

function makeFakeBackend(): ExecutionBackend {
  const handles = new Map<string, SessionHandle>();
  const backend: ExecutionBackend = {
    kind: "test-fake",
    async ensureReady() {},
    async ping() {},
    async createSession(spec) {
      const h: SessionHandle = { sessionId: spec.sessionId, __kind: "fake" };
      handles.set(spec.sessionId, h);
      return h;
    },
    async isAlive(h) {
      return handles.has(h.sessionId);
    },
    async destroy(h) {
      handles.delete(h.sessionId);
    },
    async exec() {
      return { stdout: "", stderr: "", exitCode: 0, timedOut: false, durationMs: 0 };
    },
    async writeFiles() {},
    async removeFiles() {},
    async fileExists() {
      return false;
    },
    async replaceSnapshot() {},
  };
  return backend;
}

beforeEach(() => {
  initSessionManager(makeFakeBackend());
});

afterEach(async () => {
  await shutdownAllSessions();
});

describe("sessionManager ownership", () => {
  it("startSession records the creating userId on the session", async () => {
    const s = await startSession("user-a");
    expect(s.userId).toBe("user-a");
    expect(getSession(s.id)?.userId).toBe("user-a");
  });

  it("requireOwnedSession returns the record when userId matches", async () => {
    const s = await startSession("user-a");
    const got = requireOwnedSession(s.id, "user-a");
    expect(got.id).toBe(s.id);
  });

  it("requireOwnedSession throws 404 for unknown sessionId", () => {
    expect(() => requireOwnedSession("nonexistent", "user-a")).toThrow(HttpError);
    try {
      requireOwnedSession("nonexistent", "user-a");
    } catch (err) {
      expect((err as HttpError).status).toBe(404);
    }
  });

  it("requireOwnedSession throws 404 (not 403) when another user's sessionId is used", async () => {
    // Owner-mismatch collapses to 404 so the route can't be used to enumerate
    // session ids. Legitimate owners never see this path.
    const s = await startSession("user-a");
    expect(() => requireOwnedSession(s.id, "user-b")).toThrow(HttpError);
    try {
      requireOwnedSession(s.id, "user-b");
    } catch (err) {
      expect((err as HttpError).status).toBe(404);
    }
  });

  it("pingSession refuses cross-user pings (returns false, does not touch lastSeen)", async () => {
    const s = await startSession("user-a");
    const originalSeen = getSession(s.id)!.lastSeen;
    // Wait one tick so Date.now() would change if the ping leaked through.
    await new Promise((r) => setTimeout(r, 2));
    const ok = pingSession(s.id, "user-b");
    expect(ok).toBe(false);
    expect(getSession(s.id)!.lastSeen).toBe(originalSeen);
  });

  it("pingSession accepts the owner and updates lastSeen", async () => {
    const s = await startSession("user-a");
    const originalSeen = getSession(s.id)!.lastSeen;
    await new Promise((r) => setTimeout(r, 2));
    const ok = pingSession(s.id, "user-a");
    expect(ok).toBe(true);
    expect(getSession(s.id)!.lastSeen).toBeGreaterThan(originalSeen);
  });

  it("rebindSession reuses the session for its owner", async () => {
    const s = await startSession("user-a");
    const r = await rebindSession(s.id, "user-a");
    expect(r.reused).toBe(true);
    expect(r.record.id).toBe(s.id);
  });

  it("rebindSession mints a fresh id when another user owns the requested id (no existence oracle)", async () => {
    const a = await startSession("user-a");
    const r = await rebindSession(a.id, "user-b");
    expect(r.reused).toBe(false);
    expect(r.record.id).not.toBe(a.id);
    expect(r.record.userId).toBe("user-b");
    // Original owner's record untouched.
    expect(getSession(a.id)!.userId).toBe("user-a");
  });

  it("rebindSession creates a fresh session under user-b when the id is unknown", async () => {
    const r = await rebindSession("brand-new-id-x12", "user-b");
    expect(r.reused).toBe(false);
    expect(r.record.userId).toBe("user-b");
  });

  it("endSession treats cross-user teardown as an unknown session (returns false, session intact)", async () => {
    // Owner-mismatch is indistinguishable from unknown-id to defeat an
    // enumeration oracle. The caller gets `false`; the real owner's session
    // stays intact.
    const s = await startSession("user-a");
    const ok = await endSession(s.id, "user-b");
    expect(ok).toBe(false);
    expect(getSession(s.id)).toBeDefined();
  });

  it("endSession lets the owner tear down", async () => {
    const s = await startSession("user-a");
    const ok = await endSession(s.id, "user-a");
    expect(ok).toBe(true);
    expect(getSession(s.id)).toBeUndefined();
  });

  it("getSessionStatus returns the unknown-session shape on cross-user reads", async () => {
    const s = await startSession("user-a");
    const status = await getSessionStatus(s.id, "user-b");
    expect(status).toEqual({ alive: false, containerAlive: false, lastSeen: 0 });
  });

  it("getSessionStatus reports { alive: false } for an unknown id without throwing", async () => {
    const status = await getSessionStatus("nonexistent", "user-a");
    expect(status).toEqual({ alive: false, containerAlive: false, lastSeen: 0 });
  });
});

describe("session caps (Phase 20-P3)", () => {
  it("rejects the 3rd session per user with 429 and a Retry-After header", async () => {
    // Default MAX_SESSIONS_PER_USER=2 in config.ts.
    await startSession("heavy-user");
    await startSession("heavy-user");
    await expect(startSession("heavy-user")).rejects.toMatchObject({
      status: 429,
      headers: { "Retry-After": "2" },
    });
  });

  it("lets the same user start again after one of their sessions ends", async () => {
    const s1 = await startSession("heavy-user");
    await startSession("heavy-user");
    // 3rd rejected...
    await expect(startSession("heavy-user")).rejects.toMatchObject({
      status: 429,
    });
    // ...but if we free a slot, the next call succeeds.
    await endSession(s1.id, "heavy-user");
    const s3 = await startSession("heavy-user");
    expect(s3.userId).toBe("heavy-user");
  });

  it("does not charge one user's cap against another user's sessions", async () => {
    await startSession("user-a");
    await startSession("user-a");
    // user-a at cap — but user-b is independent.
    const b = await startSession("user-b");
    expect(b.userId).toBe("user-b");
  });
});

describe("destroyUserSessions (Phase 20-P0 #9)", () => {
  it("tears down every session owned by the given user and leaves other users' sessions alone", async () => {
    const a1 = await startSession("user-a");
    const a2 = await startSession("user-a");
    const b1 = await startSession("user-b");

    const killed = await destroyUserSessions("user-a");
    expect(killed.sort()).toEqual([a1.id, a2.id].sort());

    expect(getSession(a1.id)).toBeUndefined();
    expect(getSession(a2.id)).toBeUndefined();
    expect(getSession(b1.id)).toBeDefined();

    const remaining = listSessions().map((s) => s.userId);
    expect(remaining).toEqual(["user-b"]);
  });

  it("is a no-op (empty return) for a user with no live sessions", async () => {
    await startSession("user-a");
    const killed = await destroyUserSessions("user-with-none");
    expect(killed).toEqual([]);
  });

  it("still removes the session map entry even if the backend destroy throws", async () => {
    // Rewire the backend so destroy() rejects. The map removal is what
    // keeps the delete-account path idempotent against Docker hiccups —
    // the sweeper would catch any orphan handle anyway, but we must not
    // leave a ghost entry in the in-memory map that future routes would
    // hit as "live".
    const flaky: ExecutionBackend = {
      ...makeFakeBackend(),
      async destroy() {
        throw new Error("simulated docker hiccup");
      },
    };
    initSessionManager(flaky);

    const s = await startSession("user-flaky");
    const killed = await destroyUserSessions("user-flaky");
    expect(killed).toEqual([s.id]);
    expect(getSession(s.id)).toBeUndefined();
  });
});

// Phase 20-P3: a dead/zombie container (OOM-kill, docker crash, daemon
// restart) still occupies a session record until the 45s sweeper tick —
// which under the per-user cap of 2 can lock a real user out of their own
// account for up to 2 minutes. These specs lock in that we self-heal by
// inspecting `isAlive` on the cap-rejection path and on getSessionStatus.
describe("zombie session reaping (Phase 20-P3)", () => {
  // A fake backend whose container liveness is script-controllable, so a
  // test can "kill" a handle without touching Docker.
  function makeControlledBackend() {
    const live = new Set<string>();
    const destroyed = new Set<string>();
    const backend: ExecutionBackend = {
      kind: "test-fake",
      async ensureReady() {},
      async ping() {},
      async createSession(spec) {
        live.add(spec.sessionId);
        return { sessionId: spec.sessionId, __kind: "fake" } as SessionHandle;
      },
      async isAlive(h) {
        return live.has(h.sessionId);
      },
      async destroy(h) {
        live.delete(h.sessionId);
        destroyed.add(h.sessionId);
      },
      async exec() {
        return { stdout: "", stderr: "", exitCode: 0, timedOut: false, durationMs: 0 };
      },
      async writeFiles() {},
      async removeFiles() {},
      async fileExists() {
        return false;
      },
      async replaceSnapshot() {},
    };
    return { backend, live, destroyed };
  }

  it("cap-rejection fires a background reap; the next retry succeeds once the zombie is purged", async () => {
    // P-M3: the reap no longer blocks the cap-rejection response. The first
    // hit returns 429 immediately, a background reap kicks off, and the
    // next retry (from the frontend, after Retry-After: 2) finds the
    // zombie purged.
    const { backend, live, destroyed } = makeControlledBackend();
    initSessionManager(backend);

    const s1 = await startSession("victim");
    const s2 = await startSession("victim");
    live.delete(s1.id); // container for s1 dies out of band

    // First attempt after the cap was already hit — 429, reap is fire-and-
    // forget so the zombie is still briefly in the map.
    await expect(startSession("victim")).rejects.toMatchObject({ status: 429 });

    // Wait for the background reap to complete (microtask + one async tick
    // is enough because isAlive/destroy on the fake backend are synchronous).
    await new Promise((r) => setTimeout(r, 0));

    // Zombie is gone; s2 (still live) is untouched; next attempt succeeds.
    expect(destroyed.has(s1.id)).toBe(true);
    expect(getSession(s1.id)).toBeUndefined();
    expect(getSession(s2.id)?.userId).toBe("victim");
    const s3 = await startSession("victim");
    expect(s3.userId).toBe("victim");
  });

  it("startSession still throws 429 if all of the user's sessions are alive", async () => {
    const { backend } = makeControlledBackend();
    initSessionManager(backend);
    await startSession("heavy");
    await startSession("heavy");
    // Both alive → reaper frees nothing → retry still 429 after tick.
    await expect(startSession("heavy")).rejects.toMatchObject({ status: 429 });
    await new Promise((r) => setTimeout(r, 0));
    await expect(startSession("heavy")).rejects.toMatchObject({ status: 429 });
  });

  it("coalesces concurrent cap-rejections into a single in-flight reap", async () => {
    // P-M3 guardrail: 100 simultaneous retries on the cap-rejection path
    // must not fan out 100 docker.isAlive calls. The reap promise should
    // be shared — only one reap runs until it resolves.
    const { backend } = makeControlledBackend();
    let isAliveCalls = 0;
    const wrapped: ExecutionBackend = {
      ...backend,
      async isAlive(h) {
        isAliveCalls++;
        return backend.isAlive(h);
      },
    };
    initSessionManager(wrapped);
    await startSession("victim");
    await startSession("victim");

    // Fire 20 concurrent rejected calls. Without coalescing this would be
    // 20×2 = 40 isAlive calls; with coalescing it's 2 (one per live session
    // in the first reap) and later retries short-circuit while it's running.
    await Promise.all(
      Array.from({ length: 20 }, () =>
        startSession("victim").catch((e) => e),
      ),
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(isAliveCalls).toBeLessThanOrEqual(2);
  });

  it("getSessionStatus purges the record when the container is dead", async () => {
    const { backend, live, destroyed } = makeControlledBackend();
    initSessionManager(backend);

    const s = await startSession("alice");
    live.delete(s.id); // container dies out of band

    const status = await getSessionStatus(s.id, "alice");
    expect(status).toEqual({
      alive: false,
      containerAlive: false,
      lastSeen: expect.any(Number),
    });
    // Record is gone — a subsequent rebind will mint a fresh container
    // under the same id without waiting for the sweeper.
    expect(getSession(s.id)).toBeUndefined();
    expect(destroyed.has(s.id)).toBe(true);
  });

  it("getSessionStatus does not purge a record whose container is still alive", async () => {
    const { backend } = makeControlledBackend();
    initSessionManager(backend);
    const s = await startSession("alice");
    const status = await getSessionStatus(s.id, "alice");
    expect(status.containerAlive).toBe(true);
    expect(getSession(s.id)).toBeDefined();
  });

  it("rebind after a zombie status check mints a fresh session under the same id", async () => {
    const { backend, live } = makeControlledBackend();
    initSessionManager(backend);

    const s = await startSession("alice");
    live.delete(s.id);
    await getSessionStatus(s.id, "alice"); // purges the zombie

    // The frontend retries with the same id — rebind should succeed and
    // (because startSession honors requestedId when free) keep the same id.
    const { record, reused } = await rebindSession(s.id, "alice");
    expect(reused).toBe(false);
    expect(record.id).toBe(s.id);
    expect(record.userId).toBe("alice");
  });
});

// S-20 (bucket 7): shutdownAllSessions wraps each backend.destroy in a
// Promise.race against a 5 s deadline so one hung container can't block
// the whole shutdown. This test asserts a hung destroy doesn't wedge the
// fanout, and the session map still gets cleaned up. Uses fake timers so
// the 5 s deadline fires instantly instead of blocking CI.
describe("shutdownAllSessions timeout (S-20)", () => {
  it("returns even when a destroy hangs, and clears the session map", async () => {
    const destroyCalls: string[] = [];
    const hangingBackend: ExecutionBackend = {
      kind: "test-hanging",
      async ensureReady() {},
      async ping() {},
      async createSession(spec) {
        return { sessionId: spec.sessionId, __kind: "hanging" } as SessionHandle;
      },
      async isAlive() {
        return true;
      },
      async destroy(h) {
        destroyCalls.push(h.sessionId);
        await new Promise(() => {}); // never resolves — simulates hung docker rm
      },
      async exec() {
        return { stdout: "", stderr: "", exitCode: 0, timedOut: false, durationMs: 0 };
      },
      async writeFiles() {},
      async removeFiles() {},
      async fileExists() {
        return false;
      },
      async replaceSnapshot() {},
    };
    initSessionManager(hangingBackend);

    const a = await startSession("u1");
    const b = await startSession("u2");

    vi.useFakeTimers();
    try {
      const shutdownPromise = shutdownAllSessions();
      // Fire the 5 s destroy-timeout instantly. runAllTimersAsync also
      // flushes microtasks between timer fires, which is what lets the
      // Promise.race rejection propagate through allSettled.
      await vi.runAllTimersAsync();
      await shutdownPromise;
    } finally {
      vi.useRealTimers();
    }

    expect(getSession(a.id)).toBeUndefined();
    expect(getSession(b.id)).toBeUndefined();
    expect(destroyCalls).toEqual(expect.arrayContaining([a.id, b.id]));
  });
});
