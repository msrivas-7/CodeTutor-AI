// Phase 20-P5: user_roles lookups. Used by adminGuard as defense-in-depth
// against stale JWTs (a user demoted via DELETE FROM user_roles still
// carries `app_metadata.role = 'admin'` in their existing JWT for up to
// 1h until refresh — the table check closes that gap on the next admin
// route call).
//
// Phase 26 (audit H-1): cache TTL tightened from 30s → 5s. Admin
// demotion is the highest-leverage incident-response action — 30s of
// continued admin authority post-demote is too long when a compromised
// admin is actively writing. 5s of latency × 1 DB read/admin/5s is
// trivial cost (a single PK lookup). Combined with the new
// invalidateUserRoleCache() called from force-signout, the operator
// can synchronously confirm demotion took effect.

import { db } from "./client.js";

const CACHE_TTL_MS = 5_000;

interface CacheEntry {
  role: string | null;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

export async function getUserRole(
  userId: string,
  opts: { bypassCache?: boolean } = {},
): Promise<string | null> {
  const now = Date.now();
  if (!opts.bypassCache) {
    const hit = cache.get(userId);
    if (hit && hit.expiresAt > now) return hit.role;
  }
  const sql = db();
  const rows = await sql<Array<{ role: string }>>`
    SELECT role FROM public.user_roles WHERE user_id = ${userId}
  `;
  const role = rows[0]?.role ?? null;
  cache.set(userId, { role, expiresAt: now + CACHE_TTL_MS });
  return role;
}

export async function isAdmin(userId: string): Promise<boolean> {
  return (await getUserRole(userId)) === "admin";
}

// Phase 26: invalidate a single user's cached role. Called from the
// force-signout admin path so a demote-then-force-signout combo takes
// effect on the next admin request without waiting up to 5s for the
// cache to expire.
export function invalidateUserRoleCache(userId: string): void {
  cache.delete(userId);
}

// Test-only.
export function __resetUserRolesCacheForTests(): void {
  cache.clear();
}
