// Pre-hydration bootstrap. Imported synchronously as the VERY FIRST thing
// in main.tsx so it runs before any store (aiStore, progressStore, themeStore)
// reads localStorage at module-eval time.
//
// Responsibility: if dev mode is on and an active frozen profile exists,
// re-apply its seed so React renders from a clean canned state. Sandbox
// profiles are left alone (their persisted state is whatever's in localStorage).
//
// Stripped from prod builds by import.meta.env.DEV dead-code elimination.

import { DEV_KEYS, __testing__ } from "./applyProfile";
import { profileById } from "./profiles";

if (import.meta.env.DEV) {
  try {
    const enabled = localStorage.getItem(DEV_KEYS.enabled) === "1";
    if (enabled) {
      const activeId = localStorage.getItem(DEV_KEYS.activeProfileId);
      if (activeId) {
        const profile = profileById(activeId);
        if (profile && profile.frozen) {
          // Re-apply the frozen seed. We don't touch sandbox snapshots here;
          // sandbox reloads happen via the normal localStorage state.
          __testing__.wipeOwnedKeys();
          __testing__.writeSnapshot(profile.seedStorage());
        }
      }
    }
  } catch {
    // localStorage unavailable or corrupted — noop. App loads normally.
  }
}
