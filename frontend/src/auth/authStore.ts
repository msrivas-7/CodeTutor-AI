import { create } from "zustand";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "./supabaseClient";
import { useSessionStore } from "../state/sessionStore";
import { usePreferencesStore } from "../state/preferencesStore";
import { useProjectStore } from "../state/projectStore";
import { useAIStore } from "../state/aiStore";
import { useRunStore } from "../state/runStore";
import {
  clearSessionStarts,
  useProgressStore,
} from "../features/learning/stores/progressStore";
import { bumpGen } from "./generation";
import { callbackUrl, rememberReturnTarget } from "./returnTarget";

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
  /**
   * Set only when an established signed-in tab loses its session without the
   * learner choosing Sign out. RequireAuth carries this into Login so the
   * interruption is explained instead of looking like a random redirect.
   */
  sessionEndedUnexpectedly: boolean;

  signInWithPassword: (email: string, password: string) => Promise<void>;
  signUpWithPassword: (
    email: string,
    password: string,
    meta?: { firstName: string },
    returnTo?: string,
  ) => Promise<void>;
  signInWithMagicLink: (email: string, returnTo?: string) => Promise<void>;
  signInWithOAuth: (provider: "google" | "github", returnTo?: string) => Promise<void>;
  // Phase 20-P1: re-send the signup confirmation email. Supabase treats
  // this as a no-op if the user is already confirmed — safe to offer
  // unconditionally from the "check your inbox" screen.
  resendSignupConfirmation: (email: string, returnTo?: string) => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  updatePassword: (newPassword: string) => Promise<void>;
  updateDisplayName: (firstName: string, lastName?: string) => Promise<void>;
  signOut: () => Promise<void>;
  clearError: () => void;
  // Phase 20-P5: read role from JWT app_metadata.role. The Supabase
  // Custom Access Token hook (public.attach_role_claim) injects this
  // on every JWT issue. app_metadata is service-role-only writeable,
  // so the user can't grant themselves admin via auth.updateUser.
  isAdmin: () => boolean;
}

export function shouldExplainSessionEnd(
  previousUser: User | null,
  explicitSignOutRequested: boolean,
): boolean {
  return previousUser !== null && !explicitSignOutRequested;
}

// Supabase emits SIGNED_OUT while the explicit signOut promise is resolving.
// Keep a short-lived marker rather than treating that expected event as an
// expired-session interruption. A timestamp is robust to the callback landing
// just after the promise resolves.
let explicitSignOutUntil = 0;

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  session: null,
  loading: true,
  error: null,
  sessionEndedUnexpectedly: false,

  signInWithPassword: async (email, password) => {
    set({ error: null });
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      set({ error: error.message });
      throw error;
    }
    // onAuthStateChange will push the new user/session into the store.
  },

  signUpWithPassword: async (email, password, meta, returnTo = "/start") => {
    set({ error: null });
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        // Send learners back to the app after they click the email link.
        // This is what Supabase appends `?code=...` to for the PKCE exchange.
        emailRedirectTo: callbackUrl(returnTo),
        // Display name lives in `auth.users.raw_user_meta_data` — Supabase
        // stores this jsonb alongside the user row, no DB schema change
        // needed. We read it back as `user.user_metadata.first_name` to
        // drive the avatar initials and the menu greeting.
        // Phase 22B: lastName dropped from the password signup path; the
        // cinematic onboarding only uses firstName, and lastName never
        // appeared elsewhere in the experience. Existing accounts keep
        // their `last_name` metadata harmlessly until they re-edit it.
        data: meta ? { first_name: meta.firstName } : undefined,
      },
    });
    if (error) {
      set({ error: error.message });
      throw error;
    }
  },

  signInWithMagicLink: async (email, returnTo = "/start") => {
    set({ error: null });
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: callbackUrl(returnTo),
      },
    });
    if (error) {
      set({ error: error.message });
      throw error;
    }
  },

  signInWithOAuth: async (provider, returnTo = "/start") => {
    set({ error: null });
    rememberReturnTarget(returnTo);
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: callbackUrl(returnTo),
      },
    });
    if (error) {
      set({ error: error.message });
      throw error;
    }
    // Browser will redirect to the provider; we don't reach here normally.
  },

  resendSignupConfirmation: async (email, returnTo = "/start") => {
    set({ error: null });
    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
      options: {
        emailRedirectTo: callbackUrl(returnTo),
      },
    });
    if (error) {
      set({ error: error.message });
      throw error;
    }
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

  updateDisplayName: async (firstName, lastName) => {
    set({ error: null });
    // Phase 22B: lastName is now OPTIONAL at the API surface. The
    // settings UI only passes `lastName` when the user actually typed
    // one — `undefined` means "leave existing last_name untouched in
    // raw_user_meta_data" (Supabase merges shallow-keys, so a missing
    // key is preserved). This way users who never had a last_name keep
    // not having one, users who had one keep it on every save, and
    // users who want to add one for the first time can just type it.
    const data: Record<string, string> = { first_name: firstName };
    if (lastName !== undefined) data.last_name = lastName;
    const { error } = await supabase.auth.updateUser({ data });
    if (error) {
      set({ error: error.message });
      throw error;
    }
    // onAuthStateChange fires USER_UPDATED with the refreshed user object;
    // subscribers (UserMenu, SettingsPanel) re-render automatically.
  },

  signOut: async () => {
    set({ error: null });
    explicitSignOutUntil = Date.now() + 5_000;
    const { error } = await supabase.auth.signOut();
    if (error) {
      explicitSignOutUntil = 0;
      set({ error: error.message });
      throw error;
    }
    // The SIGNED_OUT branch of `onAuthStateChange` wipes progress and
    // resets identity — don't duplicate it here.
  },

  clearError: () => set({ error: null }),

  isAdmin: () => {
    // Custom Access Token hooks only inject claims into the JWT, not
    // into auth.users.raw_app_meta_data — so user.app_metadata.role
    // stays undefined even when the JWT carries role=admin. Decode
    // the access token instead. Backend's adminGuard re-validates
    // against user_roles on every admin call so a forged token can't
    // grant access; this selector is for UI visibility only.
    const session = useAuthStore.getState().session;
    const token = session?.access_token;
    if (!token) return false;
    const parts = token.split(".");
    if (parts.length !== 3) return false;
    try {
      const padded = parts[1] + "=".repeat((4 - (parts[1].length % 4)) % 4);
      const payload = JSON.parse(
        atob(padded.replace(/-/g, "+").replace(/_/g, "/")),
      ) as { app_metadata?: { role?: unknown } };
      return payload.app_metadata?.role === "admin";
    } catch {
      return false;
    }
  },
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
    const previousUser = useAuthStore.getState().user;
    const sessionEndedUnexpectedly = event === "SIGNED_OUT"
      ? shouldExplainSessionEnd(previousUser, Date.now() <= explicitSignOutUntil)
      : false;
    if (event === "SIGNED_OUT" || event === "SIGNED_IN") {
      explicitSignOutUntil = 0;
    }

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
      // Drop in-memory tutor threads (chatCache + history) and the per-device
      // BYOK key, plus the per-lesson run output cache. These module-scoped
      // Maps otherwise leak across sign-in boundaries on the same tab.
      useAIStore.getState().reset();
      useRunStore.getState().reset();
      clearSessionStarts();
    }
    lastUserId = u?.id ?? null;

    useAuthStore.setState({
      user: u,
      session,
      loading: false,
      sessionEndedUnexpectedly:
        event === "SIGNED_OUT" && previousUser === null
          ? useAuthStore.getState().sessionEndedUnexpectedly
          : sessionEndedUnexpectedly,
    });
  });
}
