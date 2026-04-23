// S-13 (bucket 7): module-level registry of in-flight AbortControllers so
// SIGTERM can trigger a clean abort on every streaming handler and give
// each one a short grace window to flush its ledger row before the process
// exits. Without this, `process.exit` on SIGTERM races with the openai
// stream mid-delta — the `onDone` / abort-fallback ledger writes never run,
// tokens are consumed but not billed.
//
// Registration is hot-path; the Set lookup is O(1) per add/remove. At
// steady-state we expect <50 concurrent streams on a B2s, so memory is
// negligible.

const controllers = new Set<AbortController>();

export function registerAbortController(c: AbortController): void {
  controllers.add(c);
}

export function unregisterAbortController(c: AbortController): void {
  controllers.delete(c);
}

export function abortAllInFlight(reason: string): number {
  const count = controllers.size;
  for (const c of controllers) {
    if (!c.signal.aborted) {
      try {
        c.abort(new Error(reason));
      } catch {
        // AbortController.abort() does not normally throw — guard anyway so
        // one misbehaving controller can't stop shutdown fanout.
      }
    }
  }
  return count;
}

export function inFlightCount(): number {
  return controllers.size;
}

// Test-only: drop every entry without firing abort. Exposed so unit tests
// can reset state between cases without importing the Set directly.
export function _resetAbortRegistryForTest(): void {
  controllers.clear();
}
