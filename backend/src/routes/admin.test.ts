// Phase 20-P5: admin route tests. Same pattern as feedback.test.ts —
// real DB so the RLS + constraint + cache-invalidation posture is
// exercised end-to-end, fake auth via x-test-user / x-test-role
// headers. Skips cleanly when DATABASE_URL is unreachable.
//
// Coverage:
//   • Auth gate: admin claim → 200, non-admin claim → 403
//   • PUT/DELETE per-user override + audit row
//   • PUT/DELETE system-config + audit row
//   • GET audit-log
//   • Safety guards: bounds, reason length, confirmDisable phrase,
//     confirmReduction phrase, rejected attempts also audited

import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

// Mock the Supabase Admin REST wrapper. Test env doesn't have the
// service role key, and we don't need it: route logic is what we're
// testing, not the REST hop. Stub returns fake `email` + `displayName`
// shaped like real responses; tests that care about the user's identity
// pass through the userId in the URL path.
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
const { adminRouter, adminStatusRouter } = await import("./admin.js");
const { adminGuard } = await import("../middleware/adminGuard.js");
const { errorHandler } = await import("../middleware/errorHandler.js");
const userRolesModule = await import("../db/userRoles.js");
const overridesModule = await import("../db/aiFreeTierOverrides.js");
const systemConfigModule = await import("../db/systemConfig.js");

let srv: Server;
let base: string;
let dbReachable = false;
const userIds: string[] = [];
const auditIds: string[] = [];

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
    await db()`SELECT 1 FROM public.system_config LIMIT 0`;
    await db()`SELECT 1 FROM public.ai_free_tier_overrides LIMIT 0`;
    await db()`SELECT 1 FROM public.admin_audit_log LIMIT 0`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const app = express();
  app.use(express.json());
  // Fake auth: copy x-test-user → req.userId, x-test-role → req.userRole.
  app.use((req, _res, next) => {
    const u = req.header("x-test-user");
    const r = req.header("x-test-role");
    if (u) req.userId = u;
    if (r !== undefined) req.userRole = r === "" ? null : r;
    next();
  });
  // /admin-status is unguarded (returns isAdmin=false for non-admins).
  app.use("/api/user", adminStatusRouter);
  // /admin/* is adminGuard'd.
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
  if (dbReachable) {
    if (auditIds.length) {
      await db()`DELETE FROM public.admin_audit_log WHERE id = ANY(${auditIds}::uuid[])`;
    }
    if (userIds.length) {
      // CASCADE drops user_roles, ai_free_tier_overrides, and audit log
      // rows that reference these users. system_config rows have set_by
      // SET NULL, so they survive — sweep them by reason.
      await db()`DELETE FROM public.admin_audit_log WHERE actor_id = ANY(${userIds}::uuid[]) OR target_user_id = ANY(${userIds}::uuid[])`;
      // P1-1: system_config writes need the per-transaction admin opt-in
      // because of the guard_system_config_writes BEFORE trigger.
      await db().begin(async (tx) => {
        await tx`SELECT set_config('app.allow_system_config_write', 'true', true)`;
        await tx`DELETE FROM public.system_config WHERE reason LIKE 'admin route test%'`;
      });
      await db()`DELETE FROM auth.users WHERE id = ANY(${userIds}::uuid[])`;
    }
  }
  await closeDb();
});

beforeEach(() => {
  // Clear in-module caches so a previous test's override or DB state
  // doesn't leak into the next.
  userRolesModule.__resetUserRolesCacheForTests();
  overridesModule.__resetOverrideCacheForTests();
  systemConfigModule.__resetSystemConfigCacheForTests();
});

describe("admin auth gate", () => {
  it("non-admin: GET /admin/users → 403", async () => {
    if (!dbReachable) return;
    const u = await mkUser("user");
    const res = await call("/api/admin/users", { userId: u, userRole: null });
    expect(res.status).toBe(403);
  });

  it("admin: GET /admin/users → 200", async () => {
    if (!dbReachable) return;
    const a = await mkUser("admin");
    const res = await call("/api/admin/users", {
      userId: a,
      userRole: "admin",
    });
    expect(res.status).toBe(200);
  });

  it("admin claim but DB row missing: 403 (stale-JWT defense)", async () => {
    if (!dbReachable) return;
    const a = await mkUser("user"); // user_roles row NOT inserted
    const res = await call("/api/admin/users", {
      userId: a,
      userRole: "admin", // claim says admin, but DB disagrees
    });
    expect(res.status).toBe(403);
  });
});

describe("/api/user/admin-status (unguarded)", () => {
  it("returns isAdmin: false for non-admins", async () => {
    if (!dbReachable) return;
    const u = await mkUser("user");
    const res = await call("/api/user/admin-status", {
      userId: u,
      userRole: null,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { isAdmin: boolean };
    expect(body.isAdmin).toBe(false);
  });

  it("returns isAdmin: true for admins", async () => {
    if (!dbReachable) return;
    const a = await mkUser("admin");
    const res = await call("/api/user/admin-status", {
      userId: a,
      userRole: "admin",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { isAdmin: boolean };
    expect(body.isAdmin).toBe(true);
  });
});

describe("PUT /api/admin/users/:id/override", () => {
  it("admin sets per-user override → 200, audit row written", async () => {
    if (!dbReachable) return;
    const admin = await mkUser("admin");
    const target = await mkUser("user");
    const res = await call(`/api/admin/users/${target}/override`, {
      userId: admin,
      userRole: "admin",
      method: "PUT",
      body: {
        dailyQuestionsCap: 200,
        dailyUsdCap: null,
        lifetimeUsdCap: null,
        reason: "beta tester for launch week",
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      override: { dailyQuestionsCap: number };
    };
    expect(body.override.dailyQuestionsCap).toBe(200);
    // Audit row exists for this admin's action.
    const rows = await db()<Array<{ event_type: string; reason: string | null }>>`
      SELECT event_type, reason
        FROM public.admin_audit_log
       WHERE actor_id = ${admin}
         AND target_user_id = ${target}
         AND event_type = 'user_override_set'
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0].reason).toBe("beta tester for launch week");
  });

  it("rejects out-of-bounds dailyQuestionsCap (99999) with 400 + audit", async () => {
    if (!dbReachable) return;
    const admin = await mkUser("admin");
    const target = await mkUser("user");
    const res = await call(`/api/admin/users/${target}/override`, {
      userId: admin,
      userRole: "admin",
      method: "PUT",
      body: {
        dailyQuestionsCap: 99999,
        dailyUsdCap: null,
        lifetimeUsdCap: null,
        reason: "test bounds",
      },
    });
    expect(res.status).toBe(400);
    const rejected = await db()<Array<{ event_type: string }>>`
      SELECT event_type FROM public.admin_audit_log
       WHERE actor_id = ${admin} AND target_user_id = ${target}
         AND event_type = 'rejected_attempt'
    `;
    expect(rejected).toHaveLength(1);
  });

  it("rejects empty/short reason with 400", async () => {
    if (!dbReachable) return;
    const admin = await mkUser("admin");
    const target = await mkUser("user");
    const res = await call(`/api/admin/users/${target}/override`, {
      userId: admin,
      userRole: "admin",
      method: "PUT",
      body: {
        dailyQuestionsCap: 100,
        dailyUsdCap: null,
        lifetimeUsdCap: null,
        reason: "x", // too short
      },
    });
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/admin/users/:id/override", () => {
  it("clears the override + audit row", async () => {
    if (!dbReachable) return;
    const admin = await mkUser("admin");
    const target = await mkUser("user");
    // Seed an override.
    await call(`/api/admin/users/${target}/override`, {
      userId: admin,
      userRole: "admin",
      method: "PUT",
      body: {
        dailyQuestionsCap: 100,
        dailyUsdCap: null,
        lifetimeUsdCap: null,
        reason: "seed for delete test",
      },
    });
    const res = await call(`/api/admin/users/${target}/override`, {
      userId: admin,
      userRole: "admin",
      method: "DELETE",
    });
    expect(res.status).toBe(200);
    const rows = await db()<Array<{ count: number }>>`
      SELECT count(*)::int AS count FROM public.ai_free_tier_overrides
       WHERE user_id = ${target}
    `;
    expect(rows[0].count).toBe(0);
  });
});

describe("system-config", () => {
  it("GET returns env defaults when no rows exist", async () => {
    if (!dbReachable) return;
    const admin = await mkUser("admin");
    // Sweep any leftover rows. P1-1: same per-transaction admin opt-in
    // as the global cleanup hook above — system_config DELETE is gated.
    await db().begin(async (tx) => {
      await tx`SELECT set_config('app.allow_system_config_write', 'true', true)`;
      await tx`DELETE FROM public.system_config`;
    });
    systemConfigModule.__resetSystemConfigCacheForTests();
    const res = await call("/api/admin/system-config", {
      userId: admin,
      userRole: "admin",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      config: Record<string, { source: string; value: unknown }>;
    };
    expect(body.config.free_tier_daily_questions.source).toBe("env");
    // Env value either matches process.env.FREE_TIER_DAILY_QUESTIONS or
    // the default 30; we don't assert the specific number to keep the
    // test independent of test-env config.
    expect(typeof body.config.free_tier_daily_questions.value).toBe("number");
  });

  it("PUT sets a number cap + audit row", async () => {
    if (!dbReachable) return;
    const admin = await mkUser("admin");
    const res = await call("/api/admin/system-config/free_tier_daily_questions", {
      userId: admin,
      userRole: "admin",
      method: "PUT",
      body: { value: 100, reason: "admin route test — set cap" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { value: number };
    expect(body.value).toBe(100);
    const rows = await db()<Array<{ event_type: string }>>`
      SELECT event_type FROM public.admin_audit_log
       WHERE actor_id = ${admin}
         AND target_key = 'free_tier_daily_questions'
         AND event_type = 'system_config_set'
    `;
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it("DELETE reverts to env default + audit", async () => {
    if (!dbReachable) return;
    const admin = await mkUser("admin");
    // Seed.
    await call("/api/admin/system-config/free_tier_daily_questions", {
      userId: admin,
      userRole: "admin",
      method: "PUT",
      body: { value: 200, reason: "admin route test — seed for delete" },
    });
    const res = await call(
      "/api/admin/system-config/free_tier_daily_questions",
      {
        userId: admin,
        userRole: "admin",
        method: "DELETE",
      },
    );
    expect(res.status).toBe(200);
    const rows = await db()<Array<{ count: number }>>`
      SELECT count(*)::int AS count FROM public.system_config
       WHERE key = 'free_tier_daily_questions'
    `;
    expect(rows[0].count).toBe(0);
  });

  it("rejects unknown key with 400", async () => {
    if (!dbReachable) return;
    const admin = await mkUser("admin");
    const res = await call("/api/admin/system-config/free_tier_pancakes", {
      userId: admin,
      userRole: "admin",
      method: "PUT",
      body: { value: 1, reason: "test unknown key" },
    });
    expect(res.status).toBe(400);
  });
});

describe("safety guards", () => {
  it("PUT free_tier_enabled=false WITHOUT confirmDisable → 400 + audit", async () => {
    if (!dbReachable) return;
    const admin = await mkUser("admin");
    const res = await call("/api/admin/system-config/free_tier_enabled", {
      userId: admin,
      userRole: "admin",
      method: "PUT",
      body: { value: false, reason: "admin route test — disable attempt" },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { requiredPhrase?: string };
    expect(body.requiredPhrase).toBe(
      "I understand this stops free AI for everyone",
    );
    const rejected = await db()<Array<{ event_type: string }>>`
      SELECT event_type FROM public.admin_audit_log
       WHERE actor_id = ${admin}
         AND target_key = 'free_tier_enabled'
         AND event_type = 'rejected_attempt'
    `;
    expect(rejected.length).toBeGreaterThanOrEqual(1);
  });

  it("PUT free_tier_enabled=false WITH wrong phrase → 400", async () => {
    if (!dbReachable) return;
    const admin = await mkUser("admin");
    const res = await call("/api/admin/system-config/free_tier_enabled", {
      userId: admin,
      userRole: "admin",
      method: "PUT",
      body: {
        value: false,
        reason: "admin route test — wrong phrase",
        confirmDisable: "I understand", // close but not exact
      },
    });
    expect(res.status).toBe(400);
  });

  it("PUT free_tier_enabled=false WITH exact phrase → 200", async () => {
    if (!dbReachable) return;
    const admin = await mkUser("admin");
    const res = await call("/api/admin/system-config/free_tier_enabled", {
      userId: admin,
      userRole: "admin",
      method: "PUT",
      body: {
        value: false,
        reason: "admin route test — kill switch",
        confirmDisable: "I understand this stops free AI for everyone",
      },
    });
    expect(res.status).toBe(200);
    // Cleanup: re-enable so subsequent tests aren't affected by env-or-DB.
    await call("/api/admin/system-config/free_tier_enabled", {
      userId: admin,
      userRole: "admin",
      method: "DELETE",
    });
  });

  it("PUT free_tier_daily_usd_cap from $2 → $0.40 (>75% drop) requires confirmReduction", async () => {
    if (!dbReachable) return;
    const admin = await mkUser("admin");
    // Seed at $2 first (regardless of env).
    await call("/api/admin/system-config/free_tier_daily_usd_cap", {
      userId: admin,
      userRole: "admin",
      method: "PUT",
      body: { value: 2.0, reason: "admin route test — seed at $2" },
    });
    const res = await call("/api/admin/system-config/free_tier_daily_usd_cap", {
      userId: admin,
      userRole: "admin",
      method: "PUT",
      body: { value: 0.40, reason: "admin route test — sharp drop" },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { requiredPhrase?: string };
    expect(body.requiredPhrase).toBe(
      "I understand this may exhaust free tier today",
    );
    // With the phrase, it lands.
    const okRes = await call(
      "/api/admin/system-config/free_tier_daily_usd_cap",
      {
        userId: admin,
        userRole: "admin",
        method: "PUT",
        body: {
          value: 0.40,
          reason: "admin route test — sharp drop with phrase",
          confirmReduction: "I understand this may exhaust free tier today",
        },
      },
    );
    expect(okRes.status).toBe(200);
    // Cleanup.
    await call("/api/admin/system-config/free_tier_daily_usd_cap", {
      userId: admin,
      userRole: "admin",
      method: "DELETE",
    });
  });
});

describe("GET /api/admin/audit-log", () => {
  it("returns recent entries, paginated", async () => {
    if (!dbReachable) return;
    const admin = await mkUser("admin");
    // Make sure there's at least one entry — write one.
    await call("/api/admin/system-config/free_tier_daily_questions", {
      userId: admin,
      userRole: "admin",
      method: "PUT",
      body: { value: 50, reason: "admin route test — for audit log read" },
    });
    const res = await call("/api/admin/audit-log?limit=5", {
      userId: admin,
      userRole: "admin",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      entries: Array<{ eventType: string }>;
      nextCursor: string | null;
    };
    expect(body.entries.length).toBeGreaterThanOrEqual(1);
    expect(typeof body.nextCursor === "string" || body.nextCursor === null).toBe(
      true,
    );
    // Cleanup.
    await call("/api/admin/system-config/free_tier_daily_questions", {
      userId: admin,
      userRole: "admin",
      method: "DELETE",
    });
  });
});
