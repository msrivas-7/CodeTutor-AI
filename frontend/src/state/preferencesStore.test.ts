import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserPreferences } from "../api/client";

const {
  getPreferences,
  patchPreferences,
  saveOpenAIKey,
  deleteOpenAIKey,
  getAIStatus,
} = vi.hoisted(() => ({
  getPreferences: vi.fn(),
  patchPreferences: vi.fn(),
  saveOpenAIKey: vi.fn(),
  deleteOpenAIKey: vi.fn(),
  getAIStatus: vi.fn(),
}));

vi.mock("../api/client", () => ({
  api: {
    getPreferences,
    patchPreferences,
    saveOpenAIKey,
    deleteOpenAIKey,
    getAIStatus,
  },
}));

// Phase 27-v2.1 audit pass 1 fix #5 added a `hasAuthSession()` short-
// circuit inside setUiLayoutValue's debounced flush — anon callers
// (LessonPage mode="anon") must NOT PATCH /api/user/preferences (it
// 401s and cascades into supabase.auth.signOut, wiping the
// preferencesStore mid-lesson). Unit tests run with no auth session,
// so without this mock the debounce flush short-circuits and the
// patch spy never fires. Force-true to test the authed path.
vi.mock("../auth/hasAuthSession", () => ({
  hasAuthSession: () => true,
}));

import { usePreferencesStore, setTheme, setPersona, setUiLayoutValue } from "./preferencesStore";

function defaultServer(): UserPreferences {
  return {
    persona: "intermediate" as const,
    openaiModel: null,
    theme: "dark" as const,
    welcomeDone: false,
    workspaceCoachDone: false,
    editorCoachDone: false,
    uiLayout: {},
    hasOpenaiKey: false,
    lastWelcomeBackAt: null,
    emailOptIn: true,
    disableStreaks: false,
    accountFrozen: false,
    updatedAt: "now",
  };
}

beforeEach(() => {
  usePreferencesStore.setState({
    hydrated: false,
    persona: "intermediate",
    openaiModel: null,
    theme: "dark",
    welcomeDone: false,
    workspaceCoachDone: false,
    editorCoachDone: false,
    uiLayout: {},
    hasOpenaiKey: false,
    lastWelcomeBackAt: null,
    emailOptIn: true,
    disableStreaks: false,
    accountFrozen: false,
  });
  getPreferences.mockReset();
  patchPreferences.mockReset();
  saveOpenAIKey.mockReset();
  deleteOpenAIKey.mockReset();
  getAIStatus.mockReset();
  getAIStatus.mockResolvedValue({ source: "byok" });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("preferencesStore.hydrate", () => {
  it("pulls the server row and flips hydrated=true", async () => {
    getPreferences.mockResolvedValueOnce({
      ...defaultServer(),
      theme: "light",
      welcomeDone: true,
      uiLayout: { "ui:leftW": 320 },
    });
    await usePreferencesStore.getState().hydrate();
    const s = usePreferencesStore.getState();
    expect(s.hydrated).toBe(true);
    expect(s.theme).toBe("light");
    expect(s.welcomeDone).toBe(true);
    expect(s.uiLayout).toEqual({ "ui:leftW": 320 });
  });

  it("leaves hydrated=false and exposes hydrateError on fetch failure", async () => {
    getPreferences.mockRejectedValueOnce(new Error("boom"));
    await usePreferencesStore.getState().hydrate();
    const s = usePreferencesStore.getState();
    expect(s.hydrated).toBe(false);
    expect(s.hydrateError).toBe("boom");
    expect(s.theme).toBe("dark");
  });

  it("does not let a stale hydration overwrite a newer preference mutation", async () => {
    let resolveHydrate!: (value: ReturnType<typeof defaultServer>) => void;
    getPreferences.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveHydrate = resolve;
      }),
    );
    patchPreferences.mockResolvedValueOnce({
      ...defaultServer(),
      disableStreaks: true,
    });

    const hydration = usePreferencesStore.getState().hydrate();
    await usePreferencesStore.getState().patch({ disableStreaks: true });
    resolveHydrate({ ...defaultServer(), disableStreaks: false });
    await hydration;

    expect(usePreferencesStore.getState().disableStreaks).toBe(true);
  });

  it("only applies the newest overlapping hydration response", async () => {
    let resolveFirst!: (value: ReturnType<typeof defaultServer>) => void;
    let resolveSecond!: (value: ReturnType<typeof defaultServer>) => void;
    getPreferences
      .mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve; }))
      .mockReturnValueOnce(new Promise((resolve) => { resolveSecond = resolve; }));

    const first = usePreferencesStore.getState().hydrate();
    const second = usePreferencesStore.getState().hydrate();
    resolveSecond({ ...defaultServer(), theme: "light" });
    await second;
    resolveFirst({ ...defaultServer(), theme: "dark" });
    await first;

    expect(usePreferencesStore.getState().theme).toBe("light");
  });
});

describe("preferencesStore.patch (optimistic)", () => {
  it("applies the patch locally before the server replies", async () => {
    let resolveServer!: (v: unknown) => void;
    patchPreferences.mockReturnValue(new Promise((r) => { resolveServer = r; }));

    const p = usePreferencesStore.getState().patch({ theme: "light" });
    // Optimistic update should be visible synchronously.
    expect(usePreferencesStore.getState().theme).toBe("light");

    resolveServer({ ...defaultServer(), theme: "light" });
    await p;
    expect(usePreferencesStore.getState().theme).toBe("light");
  });

  it("rolls back on server failure", async () => {
    patchPreferences.mockRejectedValueOnce(new Error("nope"));
    await expect(
      usePreferencesStore.getState().patch({ theme: "light" }),
    ).rejects.toThrow();
    expect(usePreferencesStore.getState().theme).toBe("dark");
  });

  it("does not let an older PATCH response overwrite a newer mutation", async () => {
    let resolveFirst!: (value: ReturnType<typeof defaultServer>) => void;
    patchPreferences
      .mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce({ ...defaultServer(), theme: "dark" });

    const first = usePreferencesStore.getState().patch({ theme: "light" });
    const second = usePreferencesStore.getState().patch({ theme: "dark" });
    await second;
    resolveFirst({ ...defaultServer(), theme: "light" });
    await first;

    expect(usePreferencesStore.getState().theme).toBe("dark");
  });

  it("reconciles only fields owned by a PATCH response", async () => {
    usePreferencesStore.setState({ hasOpenaiKey: true });
    patchPreferences.mockResolvedValueOnce({
      ...defaultServer(),
      openaiModel: "gpt-4o-mini",
      hasOpenaiKey: false,
    });

    await usePreferencesStore.getState().patch({
      openaiModel: "gpt-4o-mini",
    });

    expect(usePreferencesStore.getState().openaiModel).toBe("gpt-4o-mini");
    expect(usePreferencesStore.getState().hasOpenaiKey).toBe(true);
  });
});

describe("preferencesStore API key persistence", () => {
  it("does not expose a connected key until the server write commits", async () => {
    let resolveSave!: () => void;
    saveOpenAIKey.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveSave = resolve;
      }),
    );

    const saving = usePreferencesStore.getState().saveOpenaiKey("sk-test");
    expect(usePreferencesStore.getState().hasOpenaiKey).toBe(false);

    resolveSave();
    await saving;
    expect(usePreferencesStore.getState().hasOpenaiKey).toBe(true);
  });
});

describe("preferencesStore helper setters", () => {
  it("setTheme sends the theme key", async () => {
    patchPreferences.mockResolvedValue({ ...defaultServer(), theme: "light" });
    await setTheme("light");
    expect(patchPreferences).toHaveBeenCalledWith({ theme: "light" });
  });

  it("setPersona sends the persona key", async () => {
    patchPreferences.mockResolvedValue({ ...defaultServer(), persona: "beginner" });
    await setPersona("beginner");
    expect(patchPreferences).toHaveBeenCalledWith({ persona: "beginner" });
  });

  it("setUiLayoutValue updates the store immediately and flushes once on the debounce", async () => {
    vi.useFakeTimers();
    try {
      usePreferencesStore.setState({ uiLayout: { "ui:a": 1 } });
      patchPreferences.mockResolvedValue(defaultServer());
      // Two rapid writes (e.g. two splitter drags within the same frame) must
      // (a) both land in the store synchronously, and (b) coalesce into a
      // single debounced server flush — we don't want 60 PATCHes/sec during
      // a pointer drag.
      setUiLayoutValue("ui:b", 2);
      setUiLayoutValue("ui:c", 3);
      expect(usePreferencesStore.getState().uiLayout).toEqual({
        "ui:a": 1,
        "ui:b": 2,
        "ui:c": 3,
      });
      expect(patchPreferences).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(300);
      expect(patchPreferences).toHaveBeenCalledTimes(1);
      expect(patchPreferences).toHaveBeenCalledWith({
        uiLayout: { "ui:a": 1, "ui:b": 2, "ui:c": 3 },
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
