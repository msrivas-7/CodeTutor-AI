import { config } from "../../config.js";
import { getSystemConfig } from "../../db/systemConfig.js";

// Phase 21C kill switches — DB-first, env-fallback. Admin can flip these
// via the Settings panel (`system_config` table); on-call can also flip
// the env var as a safety net when the DB is degraded. The DB read is
// served from a 60s in-process cache (see db/systemConfig.ts), so the
// hot-path cost on every share request is a Map lookup, not a query.
//
// Three independent switches so an operator can target the exact
// failure mode without wider blast radius:
//   - publicDisabled  → 503s the public GET (drain a viral share melt)
//   - createDisabled  → 503s POST (block new creates while existing
//                       shares stay viewable)
//   - renderDisabled  → row gets created but image render+upload skipped
//                       (URL still works; dialog shows the link, falls
//                        back gracefully). Pair with the rerender
//                        endpoint to catch up after flipping back off.

async function readBool(
  key:
    | "share_public_disabled"
    | "share_create_disabled"
    | "share_render_disabled"
    | "anon_lesson_enabled",
  envFallback: boolean,
): Promise<boolean> {
  try {
    const row = await getSystemConfig(key);
    if (row && typeof row.value === "boolean") return row.value;
  } catch {
    /* DB unreachable — env wins so prod doesn't open up by accident */
  }
  return envFallback;
}

export function isSharePublicDisabled(): Promise<boolean> {
  return readBool("share_public_disabled", config.share.publicDisabled);
}

export function isShareCreateDisabled(): Promise<boolean> {
  return readBool("share_create_disabled", config.share.createDisabled);
}

export function isShareRenderDisabled(): Promise<boolean> {
  return readBool("share_render_disabled", config.share.renderDisabled);
}

// Phase 27-v2.2 Fix 7c — anon trial path kill switch in system_config.
// `anon_lesson_enabled=false` makes /api/anon/* return 503 on the next
// request (after the 60s system_config cache TTL, or instantly for an
// admin who just flipped it because the write invalidates the cache).
// Env (ENABLE_ANON_LESSON) is the boot-time default + DB-unreachable
// fallback. Same pattern as the share kill switches.
export function isAnonLessonEnabled(): Promise<boolean> {
  return readBool("anon_lesson_enabled", config.anonLessonEnabled);
}
