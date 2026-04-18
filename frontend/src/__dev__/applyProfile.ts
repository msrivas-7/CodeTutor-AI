// Profile apply/exit/snapshot helpers. All operate on localStorage. Enforces
// an allow-list: OpenAI keys, theme, and UI size preferences are NEVER
// touched, so the dev's real config survives profile swaps.

import { profileById, type DevProfile } from "./profiles";

// Prefixes of localStorage keys that belong to CodeTutor *progress state*.
// These are wiped on profile apply and replaced by the seed. Any key not
// matching one of these prefixes is preserved.
const OWNED_PREFIXES = [
  "learner:v1:",
  "onboarding:v1:",
];

// Internal keys used by the dev-profile system itself. Never wiped by profile
// apply (they manage the profile system). Cleared only by an explicit
// "disable dev mode" action.
export const DEV_KEYS = {
  enabled: "__dev__:enabled",
  activeProfileId: "__dev__:activeProfileId",
  realSnapshot: "__dev__:realSnapshot",
  sandboxSnapshot: "__dev__:sandboxSnapshot",
} as const;

function isOwnedKey(key: string): boolean {
  return OWNED_PREFIXES.some((p) => key.startsWith(p));
}

function allOwnedKeys(): string[] {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && isOwnedKey(k)) keys.push(k);
  }
  return keys;
}

function snapshotOwnedKeys(): Record<string, string> {
  const snap: Record<string, string> = {};
  for (const k of allOwnedKeys()) {
    const v = localStorage.getItem(k);
    if (v !== null) snap[k] = v;
  }
  return snap;
}

function wipeOwnedKeys(): void {
  for (const k of allOwnedKeys()) {
    try {
      localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  }
}

function writeSnapshot(snap: Record<string, string>): void {
  for (const [k, v] of Object.entries(snap)) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* ignore */
    }
  }
}

// Called the first time dev mode is ever enabled — captures whatever state
// the developer had as a real user, so we can always restore it on exit.
// Idempotent: if a realSnapshot already exists, we don't overwrite it
// (otherwise toggling dev mode twice in a row would clobber the original).
export function captureRealSnapshotOnce(): void {
  if (localStorage.getItem(DEV_KEYS.realSnapshot)) return;
  const snap = snapshotOwnedKeys();
  localStorage.setItem(DEV_KEYS.realSnapshot, JSON.stringify(snap));
}

function restoreRealSnapshot(): void {
  const raw = localStorage.getItem(DEV_KEYS.realSnapshot);
  wipeOwnedKeys();
  if (!raw) return;
  try {
    const snap = JSON.parse(raw) as Record<string, string>;
    writeSnapshot(snap);
  } catch {
    /* corrupted snapshot — leave wiped */
  }
}

function saveSandboxSnapshot(): void {
  const snap = snapshotOwnedKeys();
  localStorage.setItem(DEV_KEYS.sandboxSnapshot, JSON.stringify(snap));
}

function loadSandboxSnapshot(): Record<string, string> | null {
  const raw = localStorage.getItem(DEV_KEYS.sandboxSnapshot);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return null;
  }
}

function getActiveProfile(): DevProfile | null {
  const id = localStorage.getItem(DEV_KEYS.activeProfileId);
  return id ? profileById(id) : null;
}

// Apply a profile. Handles all the state transitions:
//   - If we're currently in sandbox, save its snapshot before leaving so we
//     don't lose accumulated progress.
//   - Wipe owned keys.
//   - If the incoming profile is sandbox AND a saved sandbox snapshot exists,
//     restore from that. Otherwise apply the profile's fresh seed.
//   - Mark the new profile active.
//
// Caller is expected to trigger a page reload after this returns so zustand
// re-hydrates from the new state.
export function applyProfile(profile: DevProfile): void {
  const current = getActiveProfile();
  if (current && !current.frozen) {
    // Leaving sandbox → persist its state.
    saveSandboxSnapshot();
  }

  wipeOwnedKeys();

  if (!profile.frozen) {
    const saved = loadSandboxSnapshot();
    if (saved) {
      writeSnapshot(saved);
    } else {
      writeSnapshot(profile.seedStorage());
    }
  } else {
    writeSnapshot(profile.seedStorage());
  }

  localStorage.setItem(DEV_KEYS.activeProfileId, profile.id);
}

// Re-apply the current profile's seed in place (useful when a frozen profile
// got dirty mid-session). Does nothing if no profile active. For sandbox,
// resets to the seed AND clears the persistent sandbox snapshot — an explicit
// "start sandbox over" action.
export function reapplyCurrentProfile(): void {
  const profile = getActiveProfile();
  if (!profile) return;
  if (!profile.frozen) {
    localStorage.removeItem(DEV_KEYS.sandboxSnapshot);
  }
  wipeOwnedKeys();
  writeSnapshot(profile.seedStorage());
}

// Exit the active profile. Restores the real-user snapshot captured on first
// dev-mode enable. Does NOT disable dev mode itself — the Developer section
// stays visible so the dev can pick another profile.
export function exitProfile(): void {
  const current = getActiveProfile();
  if (current && !current.frozen) {
    saveSandboxSnapshot();
  }
  localStorage.removeItem(DEV_KEYS.activeProfileId);
  restoreRealSnapshot();
}

// Full "disable dev mode" flow. Exits any active profile, clears all dev
// keys, restores the real snapshot. After this, the app should look exactly
// as it did before dev mode was first enabled.
export function disableDevMode(): void {
  exitProfile();
  localStorage.removeItem(DEV_KEYS.enabled);
  localStorage.removeItem(DEV_KEYS.realSnapshot);
  localStorage.removeItem(DEV_KEYS.sandboxSnapshot);
}

// Turn dev mode on. Captures the real snapshot (once) so we have an exit
// point. Does not apply any profile yet — dev picks one from Settings.
export function enableDevMode(): void {
  captureRealSnapshotOnce();
  localStorage.setItem(DEV_KEYS.enabled, "1");
}

export function isDevModeEnabled(): boolean {
  return localStorage.getItem(DEV_KEYS.enabled) === "1";
}

export function getActiveProfileId(): string | null {
  return localStorage.getItem(DEV_KEYS.activeProfileId);
}

// Dump the current owned-key state as a prettified JSON blob. Used by the
// "Snapshot → clipboard" button so a dev can stash an interesting bug state
// and restore it later via pasteSnapshot().
export function currentSnapshotJson(): string {
  return JSON.stringify(snapshotOwnedKeys(), null, 2);
}

export function pasteSnapshot(json: string): void {
  let snap: Record<string, string>;
  try {
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    snap = parsed as Record<string, string>;
  } catch (e) {
    throw new Error(`invalid JSON: ${(e as Error).message}`);
  }
  // Reject payloads that would write non-owned keys — prevents a pasted
  // snapshot from tampering with API keys, theme, etc.
  for (const k of Object.keys(snap)) {
    if (!isOwnedKey(k)) {
      throw new Error(`snapshot contains non-owned key: ${k}`);
    }
  }
  wipeOwnedKeys();
  writeSnapshot(snap);
}

// Nuclear option — wipe everything owned, including any active profile
// marker. Leaves real-snapshot + dev flags intact so the dev can still exit
// cleanly.
export function clearEverything(): void {
  wipeOwnedKeys();
  localStorage.removeItem(DEV_KEYS.activeProfileId);
}

// Exposed for tests.
export const __testing__ = {
  snapshotOwnedKeys,
  wipeOwnedKeys,
  writeSnapshot,
  allOwnedKeys,
  isOwnedKey,
};
