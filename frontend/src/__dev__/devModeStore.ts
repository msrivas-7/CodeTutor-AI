// Tiny zustand store exposing dev-mode state to the UI. Keeps the Settings
// Developer section in sync with the keyboard shortcut handler.
//
// Stripped from prod builds by import.meta.env.DEV dead-code elimination —
// all call sites are guarded before reaching this module.

import { create } from "zustand";
import {
  applyProfile,
  captureRealSnapshotOnce,
  clearEverything,
  disableDevMode as persistDisable,
  enableDevMode as persistEnable,
  exitProfile as persistExitProfile,
  getActiveProfileId,
  isDevModeEnabled,
  pasteSnapshot as persistPaste,
  reapplyCurrentProfile as persistReapply,
} from "./applyProfile";
import { profileById, type DevProfile } from "./profiles";

interface DevModeState {
  enabled: boolean;
  activeProfileId: string | null;

  toggleDevMode(): void;
  enable(): void;
  disable(): void;

  applyProfileById(id: string): void;
  reapplyCurrent(): void;
  exitActive(): void;
  clearAll(): void;
  pasteSnapshot(json: string): void;
}

// Triggers a hard reload after a localStorage mutation so zustand-backed
// stores re-hydrate from the new state. Without this, the apply would only
// take effect on the next manual refresh.
function reloadSoon(): void {
  // Defer so any pending UI update (toast etc) flushes first.
  setTimeout(() => window.location.reload(), 50);
}

export const useDevModeStore = create<DevModeState>()((set, get) => ({
  enabled: isDevModeEnabled(),
  activeProfileId: getActiveProfileId(),

  enable() {
    persistEnable();
    captureRealSnapshotOnce();
    set({ enabled: true });
  },

  disable() {
    persistDisable();
    set({ enabled: false, activeProfileId: null });
    reloadSoon();
  },

  toggleDevMode() {
    if (isDevModeEnabled()) {
      get().disable();
    } else {
      get().enable();
    }
  },

  applyProfileById(id: string) {
    const profile = profileById(id);
    if (!profile) return;
    applyProfile(profile);
    set({ activeProfileId: id });
    reloadSoon();
  },

  reapplyCurrent() {
    persistReapply();
    reloadSoon();
  },

  exitActive() {
    persistExitProfile();
    set({ activeProfileId: null });
    reloadSoon();
  },

  clearAll() {
    clearEverything();
    set({ activeProfileId: null });
    reloadSoon();
  },

  pasteSnapshot(json: string) {
    persistPaste(json);
    reloadSoon();
  },
}));

export function profileForId(id: string | null): DevProfile | null {
  return id ? profileById(id) : null;
}

// Selector-only hook for consumers that just need to know whether the
// Developer tab should be shown. Keeps SettingsPanel out of the rest of
// the dev store API.
export function useDevModeEnabled(): boolean {
  return useDevModeStore((s) => s.enabled);
}
