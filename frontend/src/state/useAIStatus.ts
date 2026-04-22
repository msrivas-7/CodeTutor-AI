import { useCallback, useEffect, useState } from "react";
import { api, type AIStatusResponse } from "../api/client";
import { supabase } from "../auth/supabaseClient";

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

const subscribers = new Set<(v: AIStatusResponse | null) => void>();

function setGlobal(next: AIStatusResponse | null): void {
  if (next) cached = { at: Date.now(), value: next };
  for (const fn of subscribers) fn(next);
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
    setGlobal(value);
    return value;
  } catch {
    if (startEpoch !== epoch) return null;
    // Safe-fallback: BYOK-shaped response so UsageChip renders. Preserve
    // the last-known `hasShownPaidInterest` so a transient 500 can't
    // unhide the paid-interest CTA for a user who already clicked.
    const preservedInterest = cached?.value.hasShownPaidInterest ?? false;
    const fallback: AIStatusResponse = {
      source: "byok",
      remainingToday: null,
      capToday: null,
      resetAtUtc: null,
      hasShownPaidInterest: preservedInterest,
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

export function useAIStatus(): {
  status: AIStatusResponse | null;
  refetch: () => void;
} {
  const [status, setStatus] = useState<AIStatusResponse | null>(() => {
    if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
    return null;
  });

  useEffect(() => {
    subscribers.add(setStatus);
    if (!cached || Date.now() - cached.at >= TTL_MS) {
      void fetchFresh();
    }
    return () => {
      subscribers.delete(setStatus);
    };
  }, []);

  const refetch = useCallback(() => {
    // Bypass cache AND any stale in-flight request. Without nulling
    // `inflight`, two simultaneous refetch() calls could both piggyback on
    // a pre-invalidation fetch and get stale data.
    cached = null;
    inflight = null;
    void fetchFresh();
  }, []);

  return { status, refetch };
}
