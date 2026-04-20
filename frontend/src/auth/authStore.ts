import { create } from "zustand";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "./supabaseClient";
import { useSessionStore } from "../state/sessionStore";
import { usePreferencesStore } from "../state/preferencesStore";
import { useProjectStore } from "../state/projectStore";
import {
  clearSessionStarts,
  useProgressStore,
} from "../features/learning/stores/progressStore";
import { bumpGen } from "./generation";

// Zustand store mirroring Supabase's auth state. We subscribe once at
// bootstrap via `initAuth()` below and push every change through the store
// so React components can read `useAuthStore(s => s.user)` without each
// one wiring its own `onAuthStateChange` handler.
//
// Phase 18a scope — only email/password + magic-link + OAuth (Google / GitHub
// via Supabase dashboard config). Per-user settings / account deletion are
// 18b concerns.

interface AuthState {
  user: User | null;
  session: Session | null;
  /**
   * `loading` is true only during the initial session-hydration call
   * (supabase.auth.getSession) on first page load. After that, every state
   * change is synchronous from the store's perspective — components should
   * gate on `loading` for the first render and ignore it afterwards.
   */
  loading: boolean;
  /**
   * Error surface for the most recent auth action. Cleared at the start of
   * each new action so the UI shows errors only as long as they're
   * current. Components should call `clearError()` when unmounting or on
   * input change if they want to hide stale messages sooner.
   */
  error: string | null;

  signInWithPassword: (email: string, password: string) => Promise<void>;
  signUpWithPassword: (email: string, password: string) => Promise<void>;
  signInWithMagicLink: (email: string) => Promise<void>;
  signInWithOAuth: (provider: "google" | "github") => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  updatePassword: (newPassword: string) => Promise<void>;
  signOut: () => Promise<void>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  session: null,
  loading: true,
  error: null,

  signInWithPassword: async (email, password) => {
    set({ error: null });
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      set({ error: error.message });
      throw error;
    }
    // onAuthStateChange will push the new user/session into the store.
  },

  signUpWithPassword: async (email, password) => {
    set({ error: null });
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        // Send learners back to the app after they click the email link.
        // This is what Supabase appends `?code=...` to for the PKCE exchange.
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) {
      set({ error: error.message });
      throw error;
    }
  },

  signInWithMagicLink: async (email) => {
    set({ error: null });
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) {
      set({ error: error.message });
      throw error;
    }
  },

  signInWithOAuth: async (provider) => {
    set({ error: null });
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) {
      set({ error: error.message });
      throw error;
    }
    // Browser will redirect to the provider; we don't reach here normally.
  },

  sendPasswordReset: async (email) => {
    set({ error: null });
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) {
      set({ error: error.message });
      throw error;
    }
  },

  updatePassword: async (newPassword) => {
    set({ error: null });
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      set({ error: error.message });
      throw error;
    }
  },

  signOut: async () => {
    set({ error: null });
    const { error } = await supabase.auth.signOut();
    if (error) {
      set({ error: error.message });
      throw error;
    }
    // The SIGNED_OUT branch of `onAuthStateChange` wipes progress and
    // resets identity — don't duplicate it here.
  },

  clearError: () => set({ error: null }),
}));

/**
 * Bootstrap the store from Supabase's persisted session, then subscribe to
 * changes. Idempotent — subsequent calls are no-ops. Safe to call from
 * main.tsx synchronously; the async hydration flips `loading` off when done.
 */
let initialized = false;
export function initAuth(): void {
  if (initialized) return;
  initialized = true;

  // Initial session hydration. On first load, the SDK reads from
  // localStorage and (if present) refreshes the access token. `.catch` so a
  // transient network failure on refresh doesn't leave us stuck in
  // `loading: true` forever — the user will be shown the login page and a
  // later attempt can retry.
  void supabase.auth
    .getSession()
    .then(({ data }) => {
      const u = data.session?.user ?? null;
      if (u) {
        // Persisted session on boot — pull the user's preferences + progress
        // + editor project from the server so every UI read is synchronous
        // thereafter. Fire-and-forget; errors are already logged inside each
        // store's hydrate(). Each hydrate() is tagged with the current auth
        // generation so a late response after a subsequent sign-out can be
        // discarded.
        const g = bumpGen();
        void usePreferencesStore.getState().hydrate(g);
        void useProgressStore.getState().hydrate(g);
        void useProjectStore.getState().hydrateEditor(g);
      }
      useAuthStore.setState({
        user: u,
        session: data.session,
        loading: false,
      });
    })
    .catch((err) => {
      console.error("[auth] initial getSession failed:", (err as Error).message);
      useAuthStore.setState({ loading: false });
    });

  // Wire all subsequent changes (login / logout / token refresh / user
  // update) into the store. Supabase fires this for every mutation.
  //
  // We only hydrate on SIGNED_IN (and USER_UPDATED if the id somehow changed,
  // which shouldn't happen but is cheap to guard). TOKEN_REFRESHED would
  // otherwise cause a redundant hydrate every hour.
  let lastUserId: string | null = null;
  supabase.auth.onAuthStateChange((event, session) => {
    const u = session?.user ?? null;

    const userChanged = u !== null && u.id !== lastUserId;
    if (u && (event === "SIGNED_IN" || userChanged)) {
      // Pull fresh server state for the signed-in user. If we switched
      // users (userChanged), the prior user's state was already reset on
      // their SIGNED_OUT; on a first sign-in we just load. Tag each fetch
      // with the current generation so a fast sign-out immediately after
      // sign-in invalidates the in-flight response.
      const g = bumpGen();
      void usePreferencesStore.getState().hydrate(g);
      void useProgressStore.getState().hydrate(g);
      void useProjectStore.getState().hydrateEditor(g);
    }
    if (event === "SIGNED_OUT") {
      bumpGen();
      // Drop any lingering sessionId. The container behind it is either
      // already gone (auth-driven signout hits the app while the session
      // is still active) or will be reaped by the backend sweeper; either
      // way, we don't want the next user to inherit it via persisted UI.
      useSessionStore.getState().clear();
      // Wipe cached server data so the next user doesn't see a flash of
      // the previous user's progress before hydrate() finishes.
      usePreferencesStore.getState().reset();
      useProgressStore.getState().reset();
      useProjectStore.getState().resetEditorHydration();
      clearSessionStarts();
    }
    lastUserId = u?.id ?? null;

    useAuthStore.setState({
      user: u,
      session,
      loading: false,
    });
  });
}
