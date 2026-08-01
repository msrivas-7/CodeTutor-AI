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
    | "share_preview_disabled"
    | "anon_lesson_enabled"
    | "anon_laptop_invite_disabled"
    | "ai_eval_sampling_enabled",
  envFallback: boolean,
): Promise<boolean> {
  try {
    const row = await getSystemConfig(key);
    if (row && typeof row.value === "boolean") return row.value;
    // DB read succeeded, no override row exists → env default applies.
    return envFallback;
  } catch {
    // DB read THREW. For share_*_disabled keys, env default is false
    // (kill OFF, feature accessible) — same fail-closed-on-disable
    // semantic as the share routes assume. For anon_lesson_enabled,
    // env default is TRUE so falling through to envFallback would
    // RE-OPEN the trial path during a DB outage even when an admin
    // had explicitly disabled it. (Phase 27-v2.2 audit fix C1 —
    // staff-security + staff-sre convergence.) Fail CLOSED on the
    // anon switch: assume the trial is disabled until the DB recovers.
    if (key === "anon_lesson_enabled" || key === "ai_eval_sampling_enabled") return false;
    // Phase A — A2: anon_laptop_invite_disabled defaults FALSE (handoff
    // enabled). DB outage → fall through to envFallback (false) → invite
    // path stays open. The handoff is a graceful-fallback feature: a
    // failure here just falls back to the existing wall flow, which is
    // the conservative behavior during a DB outage.
    return envFallback;
  }
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

/** Release 0A: drain only crawler/unfurl metadata traffic. Human public
 * share reads remain available through `share_public_disabled=false`. */
export function isSharePreviewDisabled(): Promise<boolean> {
  return readBool("share_preview_disabled", config.share.previewDisabled);
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

// Phase A — A2: granular kill for the magic-link graduation handoff.
// When TRUE, POST /api/anon/laptop-link returns 503 cleanly and the
// PhoneGraduationDialog falls back to the existing wall flow.
// Separate from anon_lesson_enabled so an operator can drain magic-
// link abuse (token enumeration, mail-relay misuse) without nuking
// the rest of the trial path. Env-fallback is FALSE (handoff
// enabled) — the handoff is a graceful-fallback feature.
export function isAnonLaptopInviteDisabled(): Promise<boolean> {
  return readBool("anon_laptop_invite_disabled", false);
}

/** B8 sampling is independently drainable. A DB read failure fails closed so
 * an unavailable governance store never causes silent sampling. */
export function isAiEvalSamplingEnabled(): Promise<boolean> {
  return readBool("ai_eval_sampling_enabled", true);
}
