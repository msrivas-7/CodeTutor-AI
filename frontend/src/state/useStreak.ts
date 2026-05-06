import { useCallback, useEffect, useState } from "react";
import { api, type UserStreakResponse } from "../api/client";
import { supabase } from "../auth/supabaseClient";
import { hasAuthSession } from "../auth/hasAuthSession";

// Phase 21B: learning streak hook.
//
// Module-scoped cache + subscriber set so every chip on screen
// (StartPage, LessonPage / EditorPage / CourseOverview /
// LearningDashboard toolbars, LessonCompletePanel) reads the same
// value without each one polling /streak. Pattern matches
// useAIStatus.ts.
//
// Iter-4 simplification: an earlier iteration tried to derive a
// `justExtended` flag (streak.current > previously-seen baseline)
// to drive a "value just changed" cinematic. That dance is dead now —
// the LessonCompletePanel celebrates the CURRENT streak unconditionally
// (rationale in that file). Dropping the baseline machinery removed
// two real bugs: (1) the localStorage baseline could be stale across
// TOKEN_REFRESHED events and re-fire the cinematic incorrectly, and
// (2) the post-mount acknowledge call could write the wrong value if
// streak refetched mid-cinematic.

const TTL_MS = 30_000;

let cached: { at: number; value: UserStreakResponse } | null = null;
let inflight: Promise<UserStreakResponse> | null = null;
let epoch = 0;

const subscribers = new Set<(v: UserStreakResponse | null) => void>();

function setGlobal(next: UserStreakResponse | null): void {
  if (next) cached = { at: Date.now(), value: next };
  for (const fn of subscribers) fn(next);
}

async function fetchFresh(): Promise<UserStreakResponse | null> {
  if (inflight) return inflight;
  const startEpoch = epoch;
  inflight = api.getUserStreak().finally(() => {
    inflight = null;
  });
  try {
    const value = await inflight;
    if (startEpoch !== epoch) return null;
    setGlobal(value);
    return value;
  } catch {
    if (startEpoch !== epoch) return null;
    // Streak read failures are non-fatal — the chip just doesn't render
    // (component returns null at current=0). No fallback shape needed.
    return null;
  }
}

/** Force a refetch — call after a qualifying action resolves. */
export function invalidateStreak(): void {
  cached = null;
  inflight = null;
  void fetchFresh();
}

// Sign-out epoch bump matches useAIStatus.ts so a stale fetch from a
// pre-sign-out user can't surface to the next signed-in user. Token
// refresh / user-update events also bump epoch so any in-flight
// response keyed to the old token is dropped.
supabase.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_OUT" || event === "USER_UPDATED" || event === "TOKEN_REFRESHED") {
    epoch++;
    cached = null;
    inflight = null;
    if (event === "SIGNED_OUT") {
      for (const fn of subscribers) fn(null);
    }
  }
});

export interface UseStreakResult {
  streak: UserStreakResponse | null;
  refetch: () => void;
}

export function useStreak(opts?: { skip?: boolean }): UseStreakResult {
  // Phase 27-v2.1: anon callers (LessonCompletePanel mounted under
  // mode="anon") pass {skip: true} so we don't fire GET /api/user/streak
  // on a tab with no JWT. The endpoint is auth-gated; calling it without
  // a session 401s in the network tab on Maya's celebration moment.
  //
  // Defense-in-depth (mirrors useAIStatus): also bail when there's no
  // auth session. Even if a future caller forgets to pass skip, an anon
  // mount won't 401 → handle401() → supabase.auth.signOut() → reset
  // cascade. Caught by the fresh-eyes pre-commit review as a parity gap
  // with useAIStatus.
  const skip = !!opts?.skip || !hasAuthSession();
  const [streak, setStreak] = useState<UserStreakResponse | null>(() => {
    if (skip) return null;
    if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
    return null;
  });

  useEffect(() => {
    if (skip) return;
    subscribers.add(setStreak);
    if (!cached || Date.now() - cached.at >= TTL_MS) {
      void fetchFresh();
    }
    return () => {
      subscribers.delete(setStreak);
    };
  }, [skip]);

  const refetch = useCallback(() => {
    if (skip) return;
    cached = null;
    inflight = null;
    void fetchFresh();
  }, [skip]);

  return { streak, refetch };
}
