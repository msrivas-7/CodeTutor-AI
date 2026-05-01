// Phase 20-P4 + Phase 25: ai_platform_denylist read + write helpers.
//
// READ path (Phase 20): one indexed PK read per credential resolution is
// cheap, but it's on the hot path of every AI request — a 60s in-memory
// cache collapses the QPS into ~1/min per user without making an
// operator's SQL INSERT wait longer than a minute to take effect. If
// they need an immediate kill, restart backend (the cache is module-
// local and does not survive process restart).
//
// WRITE path (Phase 25): the operator can now toggle denylist + freeze
// from the admin console (was psql-only). After every write we
// invalidate the cache for that user so the next AI request sees the
// new state immediately rather than waiting up to 60s.
//
// Freeze model:
//   - denylisted only          → block platform AI; sessions OK
//   - denylisted AND frozen    → block AI + block session creation
//                                + show "account suspended" banner
// The frozen flag lives on the same row as the denylist; setFreeze ensures
// a denylist row exists (and creates one with a synthetic reason if not).

import { db } from "./client.js";

const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  denied: boolean;
  frozen: boolean;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

export interface DenylistRow {
  userId: string;
  reason: string;
  deniedAt: string; // ISO
  frozen: boolean;
  frozenReason: string | null;
  frozenAt: string | null; // ISO or null
  frozenSetBy: string | null;
}

export async function isDenylisted(
  userId: string,
  opts: { bypassCache?: boolean } = {},
): Promise<boolean> {
  const entry = await getCachedStatus(userId, opts);
  return entry.denied;
}

export async function isFrozen(
  userId: string,
  opts: { bypassCache?: boolean } = {},
): Promise<boolean> {
  const entry = await getCachedStatus(userId, opts);
  return entry.frozen;
}

async function getCachedStatus(
  userId: string,
  opts: { bypassCache?: boolean },
): Promise<CacheEntry> {
  const now = Date.now();
  if (!opts.bypassCache) {
    const hit = cache.get(userId);
    if (hit && hit.expiresAt > now) return hit;
  }
  const sql = db();
  const rows = await sql<Array<{ frozen: boolean | null }>>`
    SELECT frozen
    FROM public.ai_platform_denylist
    WHERE user_id = ${userId}
  `;
  const row = rows[0];
  const entry: CacheEntry = {
    denied: !!row,
    frozen: row?.frozen === true,
    expiresAt: now + CACHE_TTL_MS,
  };
  cache.set(userId, entry);
  return entry;
}

export async function getDenylistRow(userId: string): Promise<DenylistRow | null> {
  const sql = db();
  const rows = await sql<
    Array<{
      user_id: string;
      reason: string;
      denied_at: string;
      frozen: boolean;
      frozen_reason: string | null;
      frozen_at: string | null;
      frozen_set_by: string | null;
    }>
  >`
    SELECT user_id, reason, denied_at, frozen, frozen_reason, frozen_at, frozen_set_by
    FROM public.ai_platform_denylist
    WHERE user_id = ${userId}
  `;
  const r = rows[0];
  if (!r) return null;
  return {
    userId: r.user_id,
    reason: r.reason,
    deniedAt: r.denied_at,
    frozen: r.frozen,
    frozenReason: r.frozen_reason,
    frozenAt: r.frozen_at,
    frozenSetBy: r.frozen_set_by,
  };
}

export async function addToDenylist(args: {
  userId: string;
  reason: string;
}): Promise<void> {
  const sql = db();
  await sql`
    INSERT INTO public.ai_platform_denylist (user_id, reason)
    VALUES (${args.userId}, ${args.reason})
    ON CONFLICT (user_id)
    DO UPDATE SET reason = EXCLUDED.reason, denied_at = now()
  `;
  cache.delete(args.userId);
}

export async function removeFromDenylist(userId: string): Promise<void> {
  // Removing the row clears any freeze state too — by design. Operator
  // who wants to lift the AI block but keep the freeze should clearFreeze
  // first, then leave denylist untouched.
  const sql = db();
  await sql`DELETE FROM public.ai_platform_denylist WHERE user_id = ${userId}`;
  cache.delete(userId);
}

export async function setFreeze(args: {
  userId: string;
  reason: string;
  setBy: string;
}): Promise<void> {
  const sql = db();
  // Single UPSERT: ensures a row exists (with the freeze reason as
  // denylist reason if the user wasn't already denylisted) AND sets
  // frozen=true with metadata. The row-level CHECK constraint guarantees
  // frozen + reason + at + set_by stay consistent.
  await sql`
    INSERT INTO public.ai_platform_denylist
      (user_id, reason, frozen, frozen_reason, frozen_at, frozen_set_by)
    VALUES
      (${args.userId}, ${args.reason}, true, ${args.reason}, now(), ${args.setBy})
    ON CONFLICT (user_id) DO UPDATE SET
      frozen        = true,
      frozen_reason = EXCLUDED.frozen_reason,
      frozen_at     = now(),
      frozen_set_by = EXCLUDED.frozen_set_by
  `;
  cache.delete(args.userId);
}

export async function clearFreeze(userId: string): Promise<void> {
  const sql = db();
  // Clearing freeze leaves the denylist row in place. Admin can
  // independently call removeFromDenylist if they want to fully reinstate
  // the user. The CHECK constraint requires all freeze metadata to be
  // NULL when frozen=false.
  await sql`
    UPDATE public.ai_platform_denylist
    SET frozen = false,
        frozen_reason = NULL,
        frozen_at = NULL,
        frozen_set_by = NULL
    WHERE user_id = ${userId}
  `;
  cache.delete(userId);
}

// Test-only: reset the cache between specs so one test's positive result
// doesn't leak into another's "user is clean" expectation.
export function __resetDenylistCacheForTests(): void {
  cache.clear();
}
