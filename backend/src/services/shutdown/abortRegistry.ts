// S-13 (bucket 7): module-level registry of in-flight AbortControllers so
// SIGTERM can trigger a clean abort on every streaming handler and give
// each one a short grace window to flush its ledger row before the process
// exits. Without this, `process.exit` on SIGTERM races with the openai
// stream mid-delta — the `onDone` / abort-fallback ledger writes never run,
// tokens are consumed but not billed.
//
// Phase 26 (audit H-6): registry now keyed by userId so admin freeze can
// fan-abort just that user's in-flight streams without taking down
// everyone else's. Unkeyed registrations (background jobs, unauth'd
// paths) use a sentinel `null` userId — `abortAllForUser(null)` is a
// no-op so unkeyed entries can't be accidentally targeted.
//
// Registration is hot-path; the Set lookup is O(1) per add/remove. At
// steady-state we expect <50 concurrent streams on a B2s, so memory is
// negligible.

interface RegistryEntry {
  controller: AbortController;
  userId: string | null;
}

const entries = new Set<RegistryEntry>();

export function registerAbortController(
  c: AbortController,
  userId: string | null = null,
): RegistryEntry {
  const entry: RegistryEntry = { controller: c, userId };
  entries.add(entry);
  return entry;
}

export function unregisterAbortController(
  c: AbortController | RegistryEntry,
): void {
  // Backwards-compat: callers passing the bare controller still work; we
  // walk the Set to find the matching entry. New callers should pass the
  // RegistryEntry returned from registerAbortController for O(1) removal.
  if ("controller" in c) {
    entries.delete(c);
    return;
  }
  for (const entry of entries) {
    if (entry.controller === c) {
      entries.delete(entry);
      return;
    }
  }
}

export function abortAllInFlight(reason: string): number {
  const count = entries.size;
  for (const entry of entries) {
    if (!entry.controller.signal.aborted) {
      try {
        entry.controller.abort(new Error(reason));
      } catch {
        // AbortController.abort() does not normally throw — guard anyway so
        // one misbehaving controller can't stop shutdown fanout.
      }
    }
  }
  return count;
}

// Phase 26 (audit H-6): fan-abort every in-flight controller registered
// for a specific user. Used by the admin freeze flow to interrupt SSE
// streams that already passed the credential-resolution gate (denylist
// cache invalidation only stops NEW requests; existing streams have to
// be interrupted via their AbortController).
export function abortAllForUser(userId: string, reason: string): number {
  if (!userId) return 0; // safety net; null sentinel must not match
  let count = 0;
  for (const entry of entries) {
    if (entry.userId !== userId) continue;
    if (entry.controller.signal.aborted) continue;
    try {
      entry.controller.abort(new Error(reason));
      count++;
    } catch {
      // Same guard as abortAllInFlight.
    }
  }
  return count;
}

export function inFlightCount(): number {
  return entries.size;
}

// Test-only: drop every entry without firing abort. Exposed so unit tests
// can reset state between cases without importing the Set directly.
export function _resetAbortRegistryForTest(): void {
  entries.clear();
}
