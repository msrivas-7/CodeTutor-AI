import { create } from "zustand";
import { api, type UserPreferences, type UserPreferencesPatch } from "../api/client";
import { currentGen } from "../auth/generation";
import { invalidateAIStatus } from "./useAIStatus";

// Phase 18b: single source of truth for every per-user preference that used
// to live in localStorage — persona, OpenAI model id, theme, onboarding
// flags, and the free-form uiLayout bucket (panel widths, collapse flags).
//
// Hydrates from `GET /api/user/preferences` once at sign-in. Writes go
// through `PATCH /api/user/preferences` with optimistic in-memory update:
// every UI read is synchronous against the local snapshot, and the network
// round-trip happens in the background. A failure rolls back the
// optimistic write so the UI doesn't silently drift from the server.
//
// Why one store for every preference (instead of one per concern): the
// server exposes a single row per user, so splitting in the client just
// fans out bookkeeping for no benefit. Accessor helpers below (`useTheme`,
// `useUiLayout`, etc.) keep component call sites as narrow as they were
// when these lived in separate modules.

export type Persona = "beginner" | "intermediate" | "advanced";
export type ThemePref = "system" | "light" | "dark";

interface PreferencesState {
  // Hydration gate: components should treat `hydrated:false` as "still
  // loading defaults" — render a spinner rather than trusting the defaults
  // below, because those defaults would otherwise tick across the UI for
  // a frame before the real row lands and cause layout thrash.
  hydrated: boolean;
  hydrateError: string | null;
  persona: Persona;
  openaiModel: string | null;
  theme: ThemePref;
  welcomeDone: boolean;
  workspaceCoachDone: boolean;
  editorCoachDone: boolean;
  uiLayout: Record<string, unknown>;
  hasOpenaiKey: boolean;
  // First-run cinematic: ISO timestamp of the most recent welcome-back
  // overlay shown. Null = never shown since account creation. Written
  // via patch() on every dismissal — same contract as welcomeDone &c.
  lastWelcomeBackAt: string | null;

  hydrate: (gen?: number) => Promise<void>;
  reset: () => void;
  patch: (body: UserPreferencesPatch) => Promise<void>;
  saveOpenaiKey: (key: string) => Promise<void>;
  forgetOpenaiKey: () => Promise<void>;
}

const DEFAULTS: Omit<
  PreferencesState,
  | "hydrate"
  | "reset"
  | "patch"
  | "saveOpenaiKey"
  | "forgetOpenaiKey"
  | "hydrated"
  | "hydrateError"
> = {
  persona: "intermediate",
  openaiModel: null,
  theme: "dark",
  welcomeDone: false,
  workspaceCoachDone: false,
  editorCoachDone: false,
  uiLayout: {},
  hasOpenaiKey: false,
  lastWelcomeBackAt: null,
};

function applyServer(prefs: UserPreferences): Partial<PreferencesState> {
  return {
    persona: prefs.persona,
    openaiModel: prefs.openaiModel,
    theme: prefs.theme,
    welcomeDone: prefs.welcomeDone,
    workspaceCoachDone: prefs.workspaceCoachDone,
    editorCoachDone: prefs.editorCoachDone,
    uiLayout: prefs.uiLayout ?? {},
    hasOpenaiKey: prefs.hasOpenaiKey,
    lastWelcomeBackAt: prefs.lastWelcomeBackAt,
    hydrated: true,
  };
}

export const usePreferencesStore = create<PreferencesState>()((set, get) => ({
  hydrated: false,
  hydrateError: null,
  ...DEFAULTS,

  hydrate: async (gen) => {
    // Auth-generation guard: if the auth identity has advanced since this
    // hydrate was kicked off (fast sign-out-then-sign-in, or sign-in then
    // sign-out before the fetch returned), the response is from a prior user
    // and must not mutate the current user's store.
    const myGen = gen;
    set({ hydrateError: null });
    try {
      const prefs = await api.getPreferences();
      if (myGen !== undefined && myGen !== currentGen()) return;
      set(applyServer(prefs));
    } catch (err) {
      if (myGen !== undefined && myGen !== currentGen()) return;
      // Keep `hydrated: false` — the HydrationGate offers the user a Retry
      // / Sign-out escape hatch rather than silently dropping them onto a
      // defaults screen that would then silently overwrite their server row
      // on the first mutation.
      const msg = (err as Error).message;
      console.error("[preferences] hydrate failed:", msg);
      set({ hydrateError: msg });
    }
  },

  reset: () => {
    set({ hydrated: false, hydrateError: null, ...DEFAULTS });
  },

  patch: async (body) => {
    // Optimistic update — snapshot prior state so we can roll back on
    // network failure.
    const prior = get();
    const optimistic: Partial<PreferencesState> = {};
    if (body.persona !== undefined) optimistic.persona = body.persona;
    if (body.openaiModel !== undefined) optimistic.openaiModel = body.openaiModel;
    if (body.theme !== undefined) optimistic.theme = body.theme;
    if (body.welcomeDone !== undefined) optimistic.welcomeDone = body.welcomeDone;
    if (body.workspaceCoachDone !== undefined)
      optimistic.workspaceCoachDone = body.workspaceCoachDone;
    if (body.editorCoachDone !== undefined)
      optimistic.editorCoachDone = body.editorCoachDone;
    if (body.uiLayout !== undefined) optimistic.uiLayout = body.uiLayout;
    if (body.lastWelcomeBackAt !== undefined)
      optimistic.lastWelcomeBackAt = body.lastWelcomeBackAt;
    set(optimistic);

    try {
      const prefs = await api.patchPreferences(body);
      set(applyServer(prefs));
    } catch (err) {
      console.error("[preferences] patch failed:", (err as Error).message);
      set({
        persona: prior.persona,
        openaiModel: prior.openaiModel,
        theme: prior.theme,
        welcomeDone: prior.welcomeDone,
        workspaceCoachDone: prior.workspaceCoachDone,
        editorCoachDone: prior.editorCoachDone,
        uiLayout: prior.uiLayout,
        lastWelcomeBackAt: prior.lastWelcomeBackAt,
      });
      throw err;
    }
  },

  // Phase 18e: server-backed BYOK key. The plaintext never lands in the
  // store — only the `hasOpenaiKey` flag does. Optimistic flip-then-rollback
  // so the Settings UI reflects the change immediately.
  saveOpenaiKey: async (key) => {
    const prior = get().hasOpenaiKey;
    set({ hasOpenaiKey: true });
    try {
      await api.saveOpenAIKey(key);
      invalidateAIStatus();
    } catch (err) {
      set({ hasOpenaiKey: prior });
      throw err;
    }
  },
  forgetOpenaiKey: async () => {
    const prior = get().hasOpenaiKey;
    set({ hasOpenaiKey: false });
    try {
      await api.deleteOpenAIKey();
      invalidateAIStatus();
    } catch (err) {
      set({ hasOpenaiKey: prior });
      throw err;
    }
  },
}));

// ── Narrow selectors + setters — component call sites stay tight ─────────

export function useTheme(): ThemePref {
  return usePreferencesStore((s) => s.theme);
}

export async function setTheme(theme: ThemePref): Promise<void> {
  await usePreferencesStore.getState().patch({ theme });
}

export function usePersona(): Persona {
  return usePreferencesStore((s) => s.persona);
}

export async function setPersona(persona: Persona): Promise<void> {
  await usePreferencesStore.getState().patch({ persona });
}

export function useOpenAIModel(): string | null {
  return usePreferencesStore((s) => s.openaiModel);
}

export async function setOpenAIModel(model: string | null): Promise<void> {
  await usePreferencesStore.getState().patch({ openaiModel: model });
}

export function useUiLayoutValue<T>(path: string, fallback: T): T {
  return usePreferencesStore((s) => {
    const v = s.uiLayout[path];
    return v === undefined ? fallback : (v as T);
  });
}

/**
 * Write a single path into uiLayout. Local commit is synchronous so the UI
 * tracks the user's pointer 1:1 on splitter drags (~60Hz); the server flush
 * is debounced and the response is NOT merged back — otherwise a late echo
 * of an older drag snaps the splitter backward while the user is still
 * dragging. Fire-and-forget; failures log but don't error-banner the user.
 */
let uiLayoutFlushTimer: ReturnType<typeof setTimeout> | null = null;
const UI_LAYOUT_FLUSH_MS = 300;

export function setUiLayoutValue(path: string, value: unknown): void {
  usePreferencesStore.setState((s) => ({
    uiLayout: { ...s.uiLayout, [path]: value },
  }));
  if (uiLayoutFlushTimer) clearTimeout(uiLayoutFlushTimer);
  uiLayoutFlushTimer = setTimeout(() => {
    uiLayoutFlushTimer = null;
    const { uiLayout } = usePreferencesStore.getState();
    void api.patchPreferences({ uiLayout }).catch((err) => {
      console.error(
        "[preferences] uiLayout flush failed:",
        (err as Error).message,
      );
    });
  }, UI_LAYOUT_FLUSH_MS);
}

export function useOnboardingDone(
  flag: "welcomeDone" | "workspaceCoachDone" | "editorCoachDone",
): boolean {
  return usePreferencesStore((s) => s[flag]);
}

export function markOnboardingDone(
  flag: "welcomeDone" | "workspaceCoachDone" | "editorCoachDone",
): void {
  void usePreferencesStore.getState().patch({ [flag]: true }).catch(() => {
    /* already logged */
  });
}

// Completing the first-run cinematic should count as "being welcomed"
// for the day — otherwise the WelcomeBackOverlay fires on the very
// next dashboard visit (lastWelcomeBackAt is still null), which reads
// as two welcomes stacked back-to-back. Stamping the timestamp here
// suppresses the overlay for the next 6h / until the next calendar
// day — exactly the same rule a real welcome-back dismissal follows.
//
// Returns the patch promise so callers that navigate immediately
// afterward can `await` it. Without the await, a quick reload right
// after a skip/complete lands the hydration fetch before the server
// has the write — the overlay then fires against stale server state
// and covers the UI on the next route.
export function markFirstRunComplete(): Promise<void> {
  return usePreferencesStore
    .getState()
    .patch({
      welcomeDone: true,
      lastWelcomeBackAt: new Date().toISOString(),
    })
    .catch(() => {
      /* already logged */
    });
}
