import { useEffect, useSyncExternalStore } from "react";

interface MarketingAuthSnapshot {
  isLoggedIn: boolean;
  loading: boolean;
}

function hasPersistedSessionHint(): boolean {
  try {
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (!key) continue;
      const isProjectKey = key === "codetutor-auth";
      const isSupabaseDefaultKey =
        key.startsWith("sb-") && key.endsWith("-auth-token");
      if (!isProjectKey && !isSupabaseDefaultKey) continue;
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as { access_token?: unknown };
      if (typeof parsed.access_token === "string" && parsed.access_token.length > 0) {
        return true;
      }
    }
  } catch {
    // Storage can be unavailable in hardened/private contexts. The eventual
    // Supabase hydration remains authoritative; this is only a paint-time hint.
  }
  return false;
}

let snapshot: MarketingAuthSnapshot = {
  isLoggedIn: hasPersistedSessionHint(),
  loading: true,
};
const listeners = new Set<() => void>();
let bootstrapStarted = false;

function publish(next: MarketingAuthSnapshot) {
  if (
    next.isLoggedIn === snapshot.isLoggedIn &&
    next.loading === snapshot.loading
  ) {
    return;
  }
  snapshot = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function beginDeferredAuthBootstrap() {
  if (bootstrapStarted) return;
  bootstrapStarted = true;

  // Auth-aware marketing copy is useful, but full session verification is
  // not allowed to compete with the first public screen.
  setTimeout(() => {
    void import("../../auth/authStore").then(({ initAuth, useAuthStore }) => {
      initAuth();
      const sync = () => {
        const state = useAuthStore.getState();
        publish({ isLoggedIn: Boolean(state.user), loading: state.loading });
      };
      sync();
      useAuthStore.subscribe(sync);
    });
  }, 5000);
}

export function useMarketingAuth(): MarketingAuthSnapshot {
  useEffect(() => {
    beginDeferredAuthBootstrap();
  }, []);

  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
}
