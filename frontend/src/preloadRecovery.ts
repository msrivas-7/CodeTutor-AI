const RECOVERY_STORAGE_KEY = "codetutor:preload-recovery";
const RECOVERY_WINDOW_MS = 5 * 60 * 1000;

type PreloadErrorEvent = Event & { payload?: unknown };

type PreloadRecoveryHost = Pick<Window, "addEventListener" | "removeEventListener"> & {
  location: Pick<Location, "href" | "reload">;
  sessionStorage: Pick<Storage, "getItem" | "setItem">;
};

type RecoveryMarker = {
  signature: string;
  recordedAt: number;
};

function errorSignature(event: PreloadErrorEvent, href: string) {
  const payload = event.payload;
  if (payload instanceof Error) return payload.message || payload.name;
  if (typeof payload === "string" && payload) return payload;
  return `unknown-preload-error:${href}`;
}

function readMarker(storage: PreloadRecoveryHost["sessionStorage"]) {
  const stored = storage.getItem(RECOVERY_STORAGE_KEY);
  if (!stored) return null;
  try {
    const marker = JSON.parse(stored) as Partial<RecoveryMarker>;
    return typeof marker.signature === "string" &&
      typeof marker.recordedAt === "number"
      ? (marker as RecoveryMarker)
      : null;
  } catch {
    return null;
  }
}

/**
 * Recover a tab whose pre-deployment bundle requests a removed lazy chunk.
 *
 * Vite emits `vite:preloadError` for this exact deployment-skew case. Reload
 * once per failed asset signature so a current document can take over, while
 * retaining the original error if the same request fails again.
 */
export function installPreloadErrorRecovery(
  host: PreloadRecoveryHost = window,
  now: () => number = Date.now,
) {
  const onPreloadError: EventListener = (rawEvent) => {
    const event = rawEvent as PreloadErrorEvent;
    const signature = errorSignature(event, host.location.href);
    let previous: RecoveryMarker | null;

    try {
      previous = readMarker(host.sessionStorage);
    } catch {
      // If storage is unavailable, keep Vite's normal error path rather than
      // risking an unbounded reload loop.
      return;
    }

    const timestamp = now();
    if (
      previous?.signature === signature &&
      timestamp - previous.recordedAt < RECOVERY_WINDOW_MS
    ) {
      return;
    }

    try {
      host.sessionStorage.setItem(
        RECOVERY_STORAGE_KEY,
        JSON.stringify({ signature, recordedAt: timestamp }),
      );
    } catch {
      return;
    }

    event.preventDefault();
    host.location.reload();
  };

  host.addEventListener("vite:preloadError", onPreloadError);
  return () => host.removeEventListener("vite:preloadError", onPreloadError);
}
