// Allow-list-based localStorage snapshot/restore primitives. Used both by
// the end-user Export/Import Progress feature in Settings and by the
// (dev-only) profile switcher. Lives outside __dev__/ so the prod bundle
// keeps the user-facing import/export path.
//
// The allow-list is the safety contract: only keys under these prefixes are
// ever read or written, so a pasted/imported snapshot can't tamper with API
// keys, theme preference, UI size prefs, or the dev-mode flags.

const OWNED_PREFIXES = [
  "learner:v1:",
  "onboarding:v1:",
];

export function isOwnedKey(key: string): boolean {
  return OWNED_PREFIXES.some((p) => key.startsWith(p));
}

export function allOwnedKeys(): string[] {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && isOwnedKey(k)) keys.push(k);
  }
  return keys;
}

export function snapshotOwnedKeys(): Record<string, string> {
  const snap: Record<string, string> = {};
  for (const k of allOwnedKeys()) {
    const v = localStorage.getItem(k);
    if (v !== null) snap[k] = v;
  }
  return snap;
}

export function wipeOwnedKeys(): void {
  for (const k of allOwnedKeys()) {
    try {
      localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  }
}

export function writeSnapshot(snap: Record<string, string>): void {
  for (const [k, v] of Object.entries(snap)) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* ignore — quota banner surfaces this separately */
    }
  }
}

// Serialize the current owned-key state. Returns a prettified JSON blob
// suitable for download or clipboard copy.
export function currentSnapshotJson(): string {
  return JSON.stringify(snapshotOwnedKeys(), null, 2);
}

// Parse + apply a JSON snapshot. Throws on invalid JSON or non-owned keys.
// Does NOT reload the page — callers decide when to trigger the reload so
// they can wrap the call in a confirm dialog.
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
  for (const k of Object.keys(snap)) {
    if (!isOwnedKey(k)) {
      throw new Error(`snapshot contains non-owned key: ${k}`);
    }
  }
  wipeOwnedKeys();
  writeSnapshot(snap);
}
