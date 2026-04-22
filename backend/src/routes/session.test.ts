// Phase 20-P2: route-level coverage for /api/session, with the rebind
// cross-user collision as the centerpiece. sessionManager.test.ts already
// exercises the collision path at the manager level — this file pins the
// same guarantee at the HTTP boundary, where a regression would silently
// leak the real owner's session id to an attacker.
//
// No DB or Docker: a fake ExecutionBackend stands in for the socket layer,
// and x-test-user headers take the place of the JWKS auth middleware.

import express from "express";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import {
  initSessionManager,
  shutdownAllSessions,
} from "../services/session/sessionManager.js";
import type {
  ExecutionBackend,
  SessionHandle,
} from "../services/execution/backends/index.js";
import { sessionRouter } from "./session.js";
import { errorHandler } from "../middleware/errorHandler.js";

function makeFakeBackend(): ExecutionBackend {
  const handles = new Map<string, SessionHandle>();
  return {
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
}

let srv: Server;
let base: string;

function req(userId: string, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("x-test-user", userId);
  headers.set("content-type", "application/json");
  return fetch(`${base}${path}`, { ...init, headers });
}

beforeAll(async () => {
  initSessionManager(makeFakeBackend());
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const u = req.header("x-test-user");
    if (u) req.userId = u;
    next();
  });
  app.use("/api/session", sessionRouter);
  app.use(errorHandler);
  await new Promise<void>((resolve) => {
    srv = app.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = srv.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  if (srv) await new Promise<void>((r) => srv.close(() => r()));
  await shutdownAllSessions();
});

afterEach(async () => {
  // Wipe between specs so a collision test doesn't see a session left over
  // from a prior it(). The module-level Map is process-wide.
  await shutdownAllSessions();
});

describe("POST /api/session", () => {
  it("creates a session scoped to the authenticated user", async () => {
    const res = await req("u-1", "/api/session", { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sessionId: string; createdAt: number };
    expect(body.sessionId).toMatch(/^[A-Za-z0-9_-]{8,32}$/);
    expect(body.createdAt).toBeGreaterThan(0);
  });
});

describe("POST /api/session/rebind — cross-user collision", () => {
  it("silently mints a fresh id when the requested id belongs to another user", async () => {
    // Owner creates a session first. Attacker then tries to rebind the
    // same id — must NOT be told it exists (that would be an existence
    // oracle) and must NOT get the owner's handle. Instead a brand-new
    // nanoid is returned.
    const ownerRes = await req("u-owner", "/api/session", { method: "POST" });
    const owner = (await ownerRes.json()) as { sessionId: string };

    const attackerRes = await req("u-attacker", "/api/session/rebind", {
      method: "POST",
      body: JSON.stringify({ sessionId: owner.sessionId }),
    });
    expect(attackerRes.status).toBe(200);
    const attacker = (await attackerRes.json()) as { sessionId: string; reused: boolean };
    expect(attacker.sessionId).not.toBe(owner.sessionId);
    expect(attacker.reused).toBe(false);

    // The owner can still reach their original session, proving it wasn't
    // stolen by the rebind.
    const pingRes = await req("u-owner", "/api/session/ping", {
      method: "POST",
      body: JSON.stringify({ sessionId: owner.sessionId }),
    });
    expect(pingRes.status).toBe(200);
  });

  it("reuses the same id when the owner rebinds their own live session", async () => {
    const ownerRes = await req("u-owner", "/api/session", { method: "POST" });
    const owner = (await ownerRes.json()) as { sessionId: string };

    const rebindRes = await req("u-owner", "/api/session/rebind", {
      method: "POST",
      body: JSON.stringify({ sessionId: owner.sessionId }),
    });
    expect(rebindRes.status).toBe(200);
    const rebind = (await rebindRes.json()) as { sessionId: string; reused: boolean };
    expect(rebind.sessionId).toBe(owner.sessionId);
    expect(rebind.reused).toBe(true);
  });

  it("provisions a fresh session under the requested id when nothing is live", async () => {
    // Orphan-recovery path: UI held a nanoid from a prior session, backend
    // reaped it. Rebind reuses the id verbatim so the learner's URL / log
    // prefix stays stable.
    const wanted = "abcDEF123456";
    const res = await req("u-1", "/api/session/rebind", {
      method: "POST",
      body: JSON.stringify({ sessionId: wanted }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sessionId: string; reused: boolean };
    expect(body.sessionId).toBe(wanted);
    expect(body.reused).toBe(false);
  });

  it("returns 400 when sessionId is missing from the body", async () => {
    const res = await req("u-1", "/api/session/rebind", {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/session/ping — ownership", () => {
  it("returns 404 when a non-owner tries to ping someone else's session", async () => {
    const ownerRes = await req("u-owner", "/api/session", { method: "POST" });
    const owner = (await ownerRes.json()) as { sessionId: string };

    // 404, not 403 — same code as "session doesn't exist" so a cross-user
    // probe can't tell ownership from existence.
    const res = await req("u-attacker", "/api/session/ping", {
      method: "POST",
      body: JSON.stringify({ sessionId: owner.sessionId }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 404 for a completely unknown session id", async () => {
    const res = await req("u-1", "/api/session/ping", {
      method: "POST",
      body: JSON.stringify({ sessionId: "does-not-exist-xyz" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("GET /api/session/:id/status — ownership", () => {
  it("returns alive=false (not 403) when another user queries an existing session's status", async () => {
    // Parity with endSession / requireOwnedSession: cross-user lookups return
    // the unknown-session shape so an attacker can't distinguish "exists,
    // not mine" from "does not exist".
    const ownerRes = await req("u-owner", "/api/session", { method: "POST" });
    const owner = (await ownerRes.json()) as { sessionId: string };

    const res = await req("u-attacker", `/api/session/${owner.sessionId}/status`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { alive: boolean };
    expect(body.alive).toBe(false);
  });

  it("returns alive=false for an unknown session id", async () => {
    const res = await req("u-1", `/api/session/does-not-exist-xyz/status`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { alive: boolean };
    expect(body.alive).toBe(false);
  });
});
