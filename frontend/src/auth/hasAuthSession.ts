import { supabase } from "./supabaseClient";

// Phase 27-v2.1 — synchronous "is there a Supabase session?" check that
// can be called from low-level utilities (preferencesStore.setUiLayoutValue,
// for instance) without creating an import cycle through authStore.
//
// authStore is the higher-level wrapper that fans the auth state out to
// preferencesStore + aiStore + projectStore + runStore on SIGNED_IN /
// SIGNED_OUT. preferencesStore can't depend on authStore (authStore
// already depends on preferencesStore for the SIGNED_OUT reset cascade),
// so this module is the cycle-break: it owns its OWN small auth listener
// and exposes a sync getter.
//
// Default `false` means: callers who want to skip auth-required work
// when there's no session will bail until the session listener has a
// chance to fire (i.e., during the very first paint after sign-in).
// That window is small in practice — getSession() resolves from the
// supabase-js cache near-instantly — and the "skip on no session"
// failure mode is correct (we'd rather skip a PATCH than 401).

let cachedHasSession = false;

void supabase.auth.getSession().then(({ data }) => {
  cachedHasSession = !!data.session;
});

supabase.auth.onAuthStateChange((_event, session) => {
  cachedHasSession = !!session;
});

export function hasAuthSession(): boolean {
  return cachedHasSession;
}
