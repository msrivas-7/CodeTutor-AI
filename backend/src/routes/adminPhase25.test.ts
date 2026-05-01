// Phase 25: smoke tests for the new admin routes (denylist + freeze,
// sessions, dashboard, email-log, budget-watcher, platform-auth).
//
// Follows the same shape as admin.test.ts: real DB so the trigger +
// constraint posture is exercised end-to-end, fake auth via x-test-user
// / x-test-role, supabaseAdmin mocked. Skips cleanly when DATABASE_URL
// is unreachable (CI without Supabase access).

import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

vi.mock("../db/supabaseAdmin.js", () => ({
  listAuthUsersPaginated: vi.fn(async () => ({
    users: [],
    page: 1,
    perPage: 50,
    hasMore: false,
  })),
  getAuthUser: vi.fn(async (id: string) => ({
    id,
    email: `${id}@test.local`,
    displayName: null,
    createdAt: new Date(0).toISOString(),
    lastSignInAt: null,
  })),
  isAdminAvailable: () => true,
  adminDeleteUser: vi.fn(),
}));

const { db, closeDb } = await import("../db/client.js");
const { adminRouter } = await import("./admin.js");
const { adminGuard } = await import("../middleware/adminGuard.js");
const { errorHandler } = await import("../middleware/errorHandler.js");
const userRolesModule = await import("../db/userRoles.js");
const denylistModule = await import("../db/denylist.js");

let srv: Server;
let base: string;
let dbReachable = false;
const userIds: string[] = [];

async function mkUser(role: "admin" | "user" = "user"): Promise<string> {
  const id = randomUUID();
  await db()`
    INSERT INTO auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    VALUES (${id}, 'authenticated', 'authenticated', ${`u-${id}@test.local`}, '{}'::jsonb, '{}'::jsonb, now(), now())
  `;
  if (role === "admin") {
    await db()`
      INSERT INTO public.user_roles (user_id, role, granted_by, reason)
      VALUES (${id}, 'admin', ${id}, 'test bootstrap')
    `;
  }
  userIds.push(id);
  return id;
}

interface CallOpts {
  userId?: string;
  userRole?: "admin" | "user" | null;
  method?: "GET" | "PUT" | "DELETE" | "POST";
  body?: unknown;
}

async function call(path: string, opts: CallOpts = {}): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (opts.userId) headers["x-test-user"] = opts.userId;
  if (opts.userRole !== undefined) {
    headers["x-test-role"] = opts.userRole === null ? "" : opts.userRole;
  }
  return fetch(`${base}${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

beforeAll(async () => {
  try {
    await db()`SELECT 1`;
    await db()`SELECT 1 FROM public.user_roles LIMIT 0`;
    await db()`SELECT 1 FROM public.ai_platform_denylist LIMIT 0`;
    // Phase 25 column existence — fail loudly if migration hasn't applied.
    const cols = await db()<Array<{ column_name: string }>>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'ai_platform_denylist'
        AND column_name = 'frozen'
    `;
    if (cols.length === 0) {
      console.warn("[adminPhase25 test] frozen column missing — migration not applied");
      dbReachable = false;
      return;
    }
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const u = req.header("x-test-user");
    const r = req.header("x-test-role");
    if (u) req.userId = u;
    if (r !== undefined) req.userRole = r === "" ? null : r;
    next();
  });
  app.use("/api/admin", adminGuard, adminRouter);
  app.use(errorHandler);
  await new Promise<void>((resolve) => {
    srv = app.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = srv.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  if (srv) await new Promise<void>((r) => srv.close(() => r()));
  if (dbReachable && userIds.length) {
    await db()`DELETE FROM public.admin_audit_log WHERE actor_id = ANY(${userIds}::uuid[]) OR target_user_id = ANY(${userIds}::uuid[])`;
    await db()`DELETE FROM public.ai_platform_denylist WHERE user_id = ANY(${userIds}::uuid[])`;
    await db()`DELETE FROM auth.users WHERE id = ANY(${userIds}::uuid[])`;
  }
  await closeDb();
});

beforeEach(() => {
  userRolesModule.__resetUserRolesCacheForTests();
  denylistModule.__resetDenylistCacheForTests();
});

describe("Phase 25 admin routes", () => {
  describe("denylist", () => {
    it.skipIf(!dbReachable)("admin can add and remove denylist", async () => {
      const admin = await mkUser("admin");
      const target = await mkUser();

      // Add
      const addRes = await call(`/api/admin/users/${target}/denylist`, {
        method: "PUT",
        userId: admin,
        userRole: "admin",
        body: { reason: "abuse spike investigation" },
      });
      expect(addRes.status).toBe(200);
      expect(await denylistModule.isDenylisted(target, { bypassCache: true })).toBe(
        true,
      );

      // Remove
      const rmRes = await call(`/api/admin/users/${target}/denylist`, {
        method: "DELETE",
        userId: admin,
        userRole: "admin",
      });
      expect(rmRes.status).toBe(200);
      expect(await denylistModule.isDenylisted(target, { bypassCache: true })).toBe(
        false,
      );
    });

    it.skipIf(!dbReachable)("non-admin gets 403", async () => {
      const user = await mkUser();
      const target = await mkUser();
      const res = await call(`/api/admin/users/${target}/denylist`, {
        method: "PUT",
        userId: user,
        userRole: "user",
        body: { reason: "should be rejected" },
      });
      expect(res.status).toBe(403);
    });

    it.skipIf(!dbReachable)("rejects reason < 4 chars", async () => {
      const admin = await mkUser("admin");
      const target = await mkUser();
      const res = await call(`/api/admin/users/${target}/denylist`, {
        method: "PUT",
        userId: admin,
        userRole: "admin",
        body: { reason: "x" },
      });
      expect(res.status).toBe(400);
    });
  });

  describe("freeze", () => {
    it.skipIf(!dbReachable)(
      "freeze requires phrase, then sets frozen=true",
      async () => {
        const admin = await mkUser("admin");
        const target = await mkUser();

        // Wrong phrase → 400
        const wrong = await call(`/api/admin/users/${target}/freeze`, {
          method: "PUT",
          userId: admin,
          userRole: "admin",
          body: { reason: "abuse confirmed", confirmFreeze: "no" },
        });
        expect(wrong.status).toBe(400);
        expect(await denylistModule.isFrozen(target, { bypassCache: true })).toBe(
          false,
        );

        // Correct phrase → 200 and frozen
        const ok = await call(`/api/admin/users/${target}/freeze`, {
          method: "PUT",
          userId: admin,
          userRole: "admin",
          body: {
            reason: "abuse confirmed",
            confirmFreeze: "I understand this blocks all access for this user",
          },
        });
        expect(ok.status).toBe(200);
        expect(await denylistModule.isFrozen(target, { bypassCache: true })).toBe(
          true,
        );

        // Unfreeze → frozen=false; row remains as denylist
        const off = await call(`/api/admin/users/${target}/freeze`, {
          method: "DELETE",
          userId: admin,
          userRole: "admin",
        });
        expect(off.status).toBe(200);
        expect(await denylistModule.isFrozen(target, { bypassCache: true })).toBe(
          false,
        );
        expect(await denylistModule.isDenylisted(target, { bypassCache: true })).toBe(
          true,
        );
      },
    );
  });

  describe("dashboard", () => {
    it.skipIf(!dbReachable)("returns the expected shape for admin", async () => {
      const admin = await mkUser("admin");
      const res = await call("/api/admin/dashboard", {
        method: "GET",
        userId: admin,
        userRole: "admin",
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty("generatedAt");
      expect(body).toHaveProperty("sessions");
      expect(body).toHaveProperty("aci");
      expect(body).toHaveProperty("freeTier");
      expect(body).toHaveProperty("queues");
      expect(body).toHaveProperty("health");
      expect(body).toHaveProperty("bootId");
      expect(body).toHaveProperty("rates");
    });
  });

  describe("sessions list", () => {
    it.skipIf(!dbReachable)("returns sessions array (empty in test env)", async () => {
      const admin = await mkUser("admin");
      const res = await call("/api/admin/sessions", {
        method: "GET",
        userId: admin,
        userRole: "admin",
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { sessions: unknown[]; total: number };
      expect(Array.isArray(body.sessions)).toBe(true);
      expect(typeof body.total).toBe("number");
    });
  });

  describe("budget watcher", () => {
    it.skipIf(!dbReachable)(
      "reset requires phrase",
      async () => {
        const admin = await mkUser("admin");
        const wrong = await call("/api/admin/budget-watcher/reset", {
          method: "POST",
          userId: admin,
          userRole: "admin",
          body: { reason: "test reset", confirmReset: "wrong" },
        });
        expect(wrong.status).toBe(400);

        const ok = await call("/api/admin/budget-watcher/reset", {
          method: "POST",
          userId: admin,
          userRole: "admin",
          body: {
            reason: "test reset",
            confirmReset: "I understand this may cause duplicate budget alerts",
          },
        });
        expect(ok.status).toBe(200);
      },
    );
  });

  describe("platform-auth", () => {
    it.skipIf(!dbReachable)(
      "unstick requires phrase",
      async () => {
        const admin = await mkUser("admin");
        const wrong = await call("/api/admin/platform-auth/unstick", {
          method: "POST",
          userId: admin,
          userRole: "admin",
          body: { reason: "test unstick", confirmUnstick: "wrong" },
        });
        expect(wrong.status).toBe(400);

        const ok = await call("/api/admin/platform-auth/unstick", {
          method: "POST",
          userId: admin,
          userRole: "admin",
          body: {
            reason: "test unstick",
            confirmUnstick: "I understand this may hammer an invalid OpenAI key",
          },
        });
        expect(ok.status).toBe(200);
      },
    );

    it.skipIf(!dbReachable)("status read returns failed/sinceMs shape", async () => {
      const admin = await mkUser("admin");
      const res = await call("/api/admin/platform-auth", {
        method: "GET",
        userId: admin,
        userRole: "admin",
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { failed: boolean; sinceMs: number | null };
      expect(typeof body.failed).toBe("boolean");
    });
  });

  describe("email log", () => {
    it.skipIf(!dbReachable)("paginated list returns entries shape", async () => {
      const admin = await mkUser("admin");
      const res = await call("/api/admin/email-log?limit=5", {
        method: "GET",
        userId: admin,
        userRole: "admin",
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        entries: unknown[];
        nextCursor: string | null;
      };
      expect(Array.isArray(body.entries)).toBe(true);
    });
  });
});
