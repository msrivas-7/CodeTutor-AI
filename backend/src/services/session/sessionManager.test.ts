import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

  it("requireOwnedSession throws 403 when another user's sessionId is used", async () => {
    const s = await startSession("user-a");
    expect(() => requireOwnedSession(s.id, "user-b")).toThrow(HttpError);
    try {
      requireOwnedSession(s.id, "user-b");
    } catch (err) {
      expect((err as HttpError).status).toBe(403);
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

  it("endSession rejects cross-user teardown with 403 and leaves the session intact", async () => {
    const s = await startSession("user-a");
    await expect(endSession(s.id, "user-b")).rejects.toThrow(HttpError);
    expect(getSession(s.id)).toBeDefined();
  });

  it("endSession lets the owner tear down", async () => {
    const s = await startSession("user-a");
    const ok = await endSession(s.id, "user-a");
    expect(ok).toBe(true);
    expect(getSession(s.id)).toBeUndefined();
  });

  it("getSessionStatus rejects cross-user reads with 403", async () => {
    const s = await startSession("user-a");
    await expect(getSessionStatus(s.id, "user-b")).rejects.toThrow(HttpError);
  });

  it("getSessionStatus reports { alive: false } for an unknown id without throwing", async () => {
    const status = await getSessionStatus("nonexistent", "user-a");
    expect(status).toEqual({ alive: false, containerAlive: false, lastSeen: 0 });
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
