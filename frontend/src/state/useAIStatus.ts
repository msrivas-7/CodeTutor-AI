import { useCallback, useEffect, useState } from "react";
import { api, type AIStatusResponse } from "../api/client";
import { supabase } from "../auth/supabaseClient";
import { hasAuthSession } from "../auth/hasAuthSession";
import { parseTutorError } from "../util/tutorErrors";

// Phase 20-P4: the UI reads /api/user/ai-status to decide how to render the
// tutor surface — which chip to show (UsageChip vs FreeTierPill), whether to
// replace the composer with an ExhaustionCard, and which copy TutorSetupWarning
// renders. Keep the poll cheap: a 30 s module-scoped cache dedupes the two
// panels (AssistantPanel + GuidedTutorPanel) that may be mounted at the same
// time, and a one-shot `refetch()` rehydrates after every assistant-message
// completion so the pill counter drops in near-real time.
//
// Round 5 hardening (post-review):
//   - Error fallback preserves last-known hasShownPaidInterest. A flaky
//     /ai-status must not re-show the paid-interest CTA to a user who has
//     already clicked (operator noise + UX churn).
//   - refetch() nulls both `cached` AND `inflight` so a stale fetch in
//     progress can't shadow the fresh one.
//   - Inflight requests are tagged with an epoch. Sign-out bumps the epoch;
//     a response landing with a stale epoch is dropped so User A's status
//     never leaks to User B's subscribers.

const TTL_MS = 30_000;

let cached: { at: number; value: AIStatusResponse } | null = null;
let inflight: Promise<AIStatusResponse> | null = null;
let epoch = 0;
let platformPauseLatch: AIStatusResponse | null = null;

const subscribers = new Set<(v: AIStatusResponse | null) => void>();

function setGlobal(next: AIStatusResponse | null): void {
  if (next) cached = { at: Date.now(), value: next };
  for (const fn of subscribers) fn(next);
}

function pauseLatchIsCurrent(now = Date.now()): boolean {
  if (!platformPauseLatch) return false;
  const resetAt = platformPauseLatch.resetAtUtc
    ? Date.parse(platformPauseLatch.resetAtUtc)
    : Number.NaN;
  if (Number.isFinite(resetAt) && now >= resetAt) {
    platformPauseLatch = null;
    return false;
  }
  return true;
}

function isPlatformSpendPause(
  reason: string | null | undefined,
): reason is
  | "daily_usd_per_user_hit"
  | "lifetime_usd_per_user_hit"
  | "usd_cap_hit" {
  return reason === "daily_usd_per_user_hit" ||
    reason === "lifetime_usd_per_user_hit" ||
    reason === "usd_cap_hit";
}

function reconcilePlatformPause(value: AIStatusResponse): AIStatusResponse {
  // BYOK is an explicit recovery path and an authoritative paused response is
  // more current than the local projection latch. Either may clear/replace it.
  if (value.source === "byok") {
    platformPauseLatch = null;
    return value;
  }
  if (value.source === "none") {
    platformPauseLatch = isPlatformSpendPause(value.reason) ? value : null;
    return value;
  }
  return pauseLatchIsCurrent() && platformPauseLatch
    ? platformPauseLatch
    : value;
}

/**
 * Lock every Tutor surface after the server refuses a platform reservation.
 * The status endpoint reports recorded spend, while reservation admission also
 * considers the projected turn cost. Near that boundary a fresh status can
 * truthfully still say `platform`; this latch prevents that lag from inviting
 * repeated requests that the reservation boundary will continue to reject.
 */
export function latchPlatformAIStatusPause(raw: string): boolean {
  const parsed = parseTutorError(raw);
  if (parsed.code?.toUpperCase() !== "PLATFORM_AI_PAUSED") return false;
  const reason = parsed.reason;
  if (!isPlatformSpendPause(reason)) return false;
  const previous = cached?.value;
  platformPauseLatch = {
    source: "none",
    reason,
    remainingToday: null,
    capToday: null,
    resetAtUtc: reason === "lifetime_usd_per_user_hit"
      ? null
      : previous?.resetAtUtc ?? null,
    hasShownPaidInterest: previous?.hasShownPaidInterest ?? false,
    contextualTutorEnabled: previous?.contextualTutorEnabled ?? false,
    contextualTutorModelEligible: false,
  };
  setGlobal(platformPauseLatch);
  return true;
}

async function fetchFresh(): Promise<AIStatusResponse | null> {
  if (inflight) return inflight;
  const startEpoch = epoch;
  inflight = api.getAIStatus().finally(() => {
    inflight = null;
  });
  try {
    const value = await inflight;
    // Drop stale responses from a pre-sign-out user; their data must not
    // surface on the next signed-in user's subscribers.
    if (startEpoch !== epoch) return null;
    const reconciled = reconcilePlatformPause(value);
    setGlobal(reconciled);
    return reconciled;
  } catch {
    if (startEpoch !== epoch) return null;
    // Preserve a spend denial across a transient 500. Otherwise use the
    // existing safe BYOK-shaped fallback so UsageChip renders, retaining the
    // last-known paid-interest signal.
    const preservedInterest = cached?.value.hasShownPaidInterest ?? false;
    const fallback: AIStatusResponse = pauseLatchIsCurrent() && platformPauseLatch
      ? platformPauseLatch
      : {
          source: "byok",
          remainingToday: null,
          capToday: null,
          resetAtUtc: null,
          hasShownPaidInterest: preservedInterest,
          contextualTutorEnabled: false,
          contextualTutorModelEligible: false,
        };
    // Don't cache the fallback (next tick should retry) but still broadcast.
    for (const fn of subscribers) fn(fallback);
    return fallback;
  }
}

// Reset on sign-out so the next user on the same tab doesn't inherit the
// previous user's status blob. Bumping `epoch` also orphans any inflight
// response issued for the signed-out user.
//
// QA-M9: also treat USER_UPDATED (e.g. email change, profile metadata) and
// TOKEN_REFRESHED as epoch-bumping events. The underlying user may be the
// same, but the backend's view of the JWT just changed — if a stale
// pre-refresh response is in flight when the refresh lands, we'd surface
// the old status against a token the server might reject. Bumping the
// epoch drops the stale response; re-fetching re-hydrates with the new
// token automatically via the axios interceptor.
supabase.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_OUT") {
    epoch++;
    cached = null;
    inflight = null;
    platformPauseLatch = null;
    for (const fn of subscribers) fn(null);
    return;
  }
  if (event === "USER_UPDATED" || event === "TOKEN_REFRESHED") {
    epoch++;
    cached = null;
    inflight = null;
    void fetchFresh();
  }
});

// Imperative invalidator for non-React callers (the preferences store calls
// this after saveOpenaiKey / forgetOpenaiKey so the panels immediately learn
// that the credential source has flipped — without this, a user who removes
// their BYOK key keeps seeing the "Connect your AI tutor" copy until the 30 s
// TTL lapses, because the cached `source: 'byok'` response shadows the fresh
// `source: 'platform'` one the backend would now return).
export function invalidateAIStatus(): void {
  cached = null;
  inflight = null;
  void fetchFresh();
}

// P-H6: optimistically decrement the cached remainingToday after a platform
// ask completes. Previously every panel unconditionally re-polled /ai-status
// after `asking` flipped false, which added a round-trip to the end of every
// turn. Because the backend counter is authoritative and cheap to re-verify
// on the NEXT 30 s cache expiry, we can safely mirror the -1 locally. If the
// user switches to BYOK / the ledger write fails, the next fresh fetch
// corrects us.
//
// Exception: when the decrement would cross into 0, skip the local mirror and
// refetch instead. The server is the only place that knows the full exhausted
// state shape (source:"none", reason:"free_exhausted", resetAtUtc), and the
// ExhaustionCard gates on `source === "none"` — a stale `{source:"platform",
// remainingToday:0}` would leave the composer on-screen until the 30 s TTL
// expires. This is the one turn per day where the round-trip is worth paying.
export function notePlatformQuestionConsumed(): void {
  if (!cached) return;
  const v = cached.value;
  if (v.source !== "platform") return;
  if (v.remainingToday === null) return;
  const next = Math.max(0, v.remainingToday - 1);
  if (next === v.remainingToday) return;
  if (next === 0) {
    cached = null;
    inflight = null;
    void fetchFresh();
    return;
  }
  setGlobal({ ...v, remainingToday: next });
}

export function useAIStatus(opts?: { skip?: boolean }): {
  status: AIStatusResponse | null;
  refetch: () => void;
} {
  // Phase 27-v2.1: anon callers (GuidedTutorPanel mounted under
  // mode="anon") pass {skip: true} so we don't fire GET /api/user/ai-status
  // on a tab with no JWT. The endpoint is authMiddleware-gated; calling
  // it without a session 401s, handle401() calls supabase.auth.signOut(),
  // and the SIGNED_OUT listener resets every store — wiping
  // workspaceCoachDone, aiStore history, etc., right under Maya's feet.
  //
  // Defense-in-depth: even if a caller forgets to pass skip, bail when
  // there's no auth session present. Found by audit pass 1 — an
  // unconditional useAIStatus() call inside EditorTabs (line 26)
  // mounted on /try/ and caused exactly this 401-signOut cascade.
  // Future callers in the LessonPage subtree can't accidentally
  // re-introduce the bug.
  const skip = !!opts?.skip || !hasAuthSession();
  const [status, setStatus] = useState<AIStatusResponse | null>(() => {
    if (skip) return null;
    if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
    return null;
  });

  useEffect(() => {
    if (skip) return;
    subscribers.add(setStatus);
    if (!cached || Date.now() - cached.at >= TTL_MS) {
      void fetchFresh();
    }
    return () => {
      subscribers.delete(setStatus);
    };
  }, [skip]);

  const refetch = useCallback(() => {
    if (skip) return;
    // Bypass cache AND any stale in-flight request. Without nulling
    // `inflight`, two simultaneous refetch() calls could both piggyback on
    // a pre-invalidation fetch and get stale data.
    cached = null;
    inflight = null;
    void fetchFresh();
  }, [skip]);

  return { status, refetch };
}
