// Phase 20-P5: project-wide configuration overrides (system_config table).
//
// Read path: cached 60s in-module. Write path: admin route handlers
// invalidate the cache after the DB write so the next AI call sees the
// fresh value. The cache is module-local and does NOT survive a process
// restart — operator who needs an immediate kill can restart the backend.

import { db } from "./client.js";

const CACHE_TTL_MS = 60_000;

// The well-known keys. The DB column is text + JSONB so we can add
// keys without a migration; this constant is the validated list at the
// admin-route layer (zod enum) so we can't write a typo'd key.
export const KNOWN_KEYS = [
  "free_tier_enabled",
  "free_tier_daily_questions",
  "free_tier_daily_usd_per_user",
  "free_tier_lifetime_usd_per_user",
  "free_tier_daily_usd_cap",
  // Phase 21C kill switches — admin-toggleable so an operator can
  // drain a viral-share melt or block render-side bugs without
  // SSH-ing the VM. Boolean flags; env vars are the safety-net
  // fallback when the DB is unreachable (see config.share.*).
  "share_public_disabled",
  "share_create_disabled",
  "share_render_disabled",
  // Phase 24B operational knobs — admin-toggleable so an operator can
  // turn ACI overflow off, raise/lower the daily cap, or shrink the
  // overflow ceiling at 2am during a spike WITHOUT a redeploy. The env
  // vars (config.aci.*) are the boot-time defaults + the fallback when
  // the DB is unreachable. Static infra config (subscription, subnet,
  // image, etc.) deliberately stays out of this list — those want
  // version control via the Key Vault refresh-env runbook, not a UI.
  "aci_overflow_enabled",
  "aci_daily_usd_cap",
  "aci_max_overflow",
  // Slice 8: warm-pool toggle — pre-spawn 1–2 ACI containers when local
  // capacity is close to its cap so the next overflow user gets a
  // sub-second handoff instead of 5–15s cold start. Default off; flip
  // on if cold-start latency surfaces post-launch. Capped at 2 warm
  // containers ever (~$2.54/day idle cost, bounded further by the
  // daily $-cap kill switch).
  "aci_warm_pool_enabled",
  // Phase 24B P2-2 (audit fix): warm-pool sizing knobs admin-editable
  // so the operator can tune hysteresis without a redeploy. Defaults
  // come from config.aci.warmPoolHighWatermark/etc; system_config
  // values override at runtime. Useful when post-launch data shows the
  // default 12/10/2 trio is wrong for actual traffic (e.g. spikes are
  // smaller and we want pool=1, low=8 instead of pool=2, low=10).
  "aci_warm_high_watermark",
  "aci_warm_low_watermark",
  "aci_warm_max_pool_size",
  // Phase 27-v2.2 Fix 7c — anon trial path kill switch. Mirrors
  // share_*_disabled in shape: boolean, admin-toggleable, env var
  // (ENABLE_ANON_LESSON) is the boot-time default and the fallback
  // when the DB is unreachable. Flipping FALSE here turns
  // /api/anon/* into 503 ANON_LESSON_DISABLED on the next request
  // — no redeploy. Pulled forward from Phase 28 so the operator
  // doesn't need to ssh in to drain abuse.
  "anon_lesson_enabled",
  // Phase A — A2: granular kill switch for the phone-graduation
  // magic-link handoff. Setting this TRUE causes POST /api/anon/laptop-
  // link to 503 cleanly (PhoneGraduationDialog falls back to the
  // existing SignupWallDialog flow). Separate from anon_lesson_enabled
  // so an operator can drain magic-link abuse — token enumeration,
  // email-enumeration, mail-relay misuse — without nuking the entire
  // /try/ surface. Default FALSE (handoff enabled).
  "anon_laptop_invite_disabled",
] as const;
export type SystemConfigKey = (typeof KNOWN_KEYS)[number];

// JSONB unwraps numbers as numbers, booleans as booleans, etc. Postgres
// `value` jsonb → JS `unknown`. Caller-side cast.
type SystemConfigValue = boolean | number | null;

interface SystemConfigRow {
  key: SystemConfigKey;
  value: SystemConfigValue;
  setBy: string | null;
  setAt: string;
  reason: string | null;
}

interface CacheEntry {
  row: SystemConfigRow | null;
  expiresAt: number;
}

const cache = new Map<SystemConfigKey, CacheEntry>();

export async function getSystemConfig(
  key: SystemConfigKey,
  opts: { bypassCache?: boolean } = {},
): Promise<SystemConfigRow | null> {
  const now = Date.now();
  if (!opts.bypassCache) {
    const hit = cache.get(key);
    if (hit && hit.expiresAt > now) return hit.row;
  }
  const sql = db();
  const rows = await sql<
    Array<{ key: string; value: unknown; set_by: string | null; set_at: Date; reason: string | null }>
  >`
    SELECT key, value, set_by, set_at, reason
      FROM public.system_config
     WHERE key = ${key}
  `;
  const row: SystemConfigRow | null = rows[0]
    ? {
        key: rows[0].key as SystemConfigKey,
        value: rows[0].value as SystemConfigValue,
        setBy: rows[0].set_by,
        setAt: rows[0].set_at.toISOString(),
        reason: rows[0].reason,
      }
    : null;
  cache.set(key, { row, expiresAt: now + CACHE_TTL_MS });
  return row;
}

export async function getAllSystemConfig(): Promise<
  Record<SystemConfigKey, SystemConfigRow | null>
> {
  // Bypass per-key cache for the admin dashboard read so the operator
  // sees the freshest state. One DB roundtrip; the table has ≤5 rows
  // so a full scan is cheaper than passing an array binding.
  const sql = db();
  const rows = await sql<
    Array<{ key: string; value: unknown; set_by: string | null; set_at: Date; reason: string | null }>
  >`
    SELECT key, value, set_by, set_at, reason
      FROM public.system_config
  `;
  const map = new Map(rows.map((r) => [r.key as SystemConfigKey, r]));
  const result = Object.fromEntries(
    KNOWN_KEYS.map((k) => {
      const r = map.get(k);
      return [
        k,
        r
          ? {
              key: r.key as SystemConfigKey,
              value: r.value as SystemConfigValue,
              setBy: r.set_by,
              setAt: r.set_at.toISOString(),
              reason: r.reason,
            }
          : null,
      ];
    }),
  ) as Record<SystemConfigKey, SystemConfigRow | null>;
  // Refresh per-key cache as a side effect so subsequent point reads hit.
  const now = Date.now();
  for (const k of KNOWN_KEYS) {
    cache.set(k, { row: result[k], expiresAt: now + CACHE_TTL_MS });
  }
  return result;
}

// P1-5 (second-audit fix): inner statement timeout + outer abort
// timeout. The Supabase transaction pooler holds a backend connection
// across the BEGIN/COMMIT span; without bounds, an admin's emergency
// kill switch at 2 a.m. can hang on a pool stall or vacuum-pinned row.
// The inner SET LOCAL statement_timeout aborts at the DB layer; the
// outer Promise.race guards against connection-acquire stalls before
// any statement gets to run. 5 s is generous for a single-row upsert.
const SYSTEM_CONFIG_WRITE_BUDGET_MS = 5_000;

async function withTimeout<T>(
  work: Promise<T>,
  budgetMs: number,
  evt: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () =>
        reject(
          Object.assign(new Error(`${evt}: exceeded ${budgetMs} ms budget`), {
            code: "SYSTEM_CONFIG_WRITE_TIMEOUT",
          }),
        ),
      budgetMs,
    );
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function setSystemConfig(args: {
  key: SystemConfigKey;
  value: SystemConfigValue;
  setBy: string;
  reason: string;
}): Promise<void> {
  const sql = db();
  // P1-1 (audit fix): the BEFORE trigger guard_system_config_writes
  // rejects any write that does NOT either come from a member of
  // app_system_config_writer OR set app.allow_system_config_write=true
  // for the current transaction. We use the second path (single-pool
  // deploy) — wrap the upsert in a transaction with SET LOCAL so the
  // GUC is scoped to this transaction only and cannot leak into a
  // pooled connection's next query.
  await withTimeout(
    sql.begin(async (tx) => {
      // P1-5: inner statement timeout. Each statement inside this
      // transaction self-aborts at 5 s if the DB is wedged.
      await tx`SET LOCAL statement_timeout = '5s'`;
      await tx`SELECT set_config('app.allow_system_config_write', 'true', true)`;
      await tx`
        INSERT INTO public.system_config (key, value, set_by, set_at, reason)
        VALUES (${args.key}, ${tx.json(args.value)}, ${args.setBy}, NOW(), ${args.reason})
        ON CONFLICT (key) DO UPDATE
          SET value  = EXCLUDED.value,
              set_by = EXCLUDED.set_by,
              set_at = EXCLUDED.set_at,
              reason = EXCLUDED.reason
      `;
    }),
    SYSTEM_CONFIG_WRITE_BUDGET_MS,
    "system_config_set_timeout",
  );
  cache.delete(args.key);
}

export async function clearSystemConfig(key: SystemConfigKey): Promise<void> {
  const sql = db();
  // P1-1: same admin-context opt-in as setSystemConfig.
  // P1-5: same outer + inner timeout as setSystemConfig.
  await withTimeout(
    sql.begin(async (tx) => {
      await tx`SET LOCAL statement_timeout = '5s'`;
      await tx`SELECT set_config('app.allow_system_config_write', 'true', true)`;
      await tx`DELETE FROM public.system_config WHERE key = ${key}`;
    }),
    SYSTEM_CONFIG_WRITE_BUDGET_MS,
    "system_config_clear_timeout",
  );
  cache.delete(key);
}

// Test-only.
export function __resetSystemConfigCacheForTests(): void {
  cache.clear();
}
