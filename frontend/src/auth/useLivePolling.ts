import { useCallback, useEffect, useRef, useState } from "react";

// Phase 25: generic polling hook for the admin dashboard / sessions /
// email-log live views. Pauses while the document is hidden so a
// background tab doesn't keep hitting the backend. Manual refresh
// button supported via the returned `refresh` callback.

interface PollingState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

interface UseLivePollingOpts {
  // Set false to disable auto-poll without remounting. Manual refresh
  // still works.
  enabled?: boolean;
}

interface PollSchedulerEnvironment {
  isHidden: () => boolean;
  setTimer: (callback: () => void, delayMs: number) => number;
  clearTimer: (timer: number) => void;
}

/** A small deterministic core for the browser-facing hook below. */
export function createSequentialPollScheduler(
  run: () => Promise<void>,
  intervalMs: number,
  environment: PollSchedulerEnvironment,
) {
  let stopped = false;
  let timer: number | null = null;
  let ticking = false;

  const schedule = () => {
    if (stopped || timer !== null) return;
    timer = environment.setTimer(() => {
      timer = null;
      void tick();
    }, intervalMs);
  };

  const tick = async () => {
    if (stopped || environment.isHidden() || ticking) return;
    ticking = true;
    try {
      await run();
    } finally {
      ticking = false;
      schedule();
    }
  };

  const visibilityChanged = () => {
    if (timer !== null) {
      environment.clearTimer(timer);
      timer = null;
    }
    if (!environment.isHidden()) void tick();
  };

  const stop = () => {
    stopped = true;
    if (timer !== null) environment.clearTimer(timer);
    timer = null;
  };

  return { start: () => void tick(), visibilityChanged, stop };
}

export function useLivePolling<T>(
  fetcher: () => Promise<T>,
  intervalMs: number,
  opts: UseLivePollingOpts = {},
): PollingState<T> & { refresh: () => Promise<void> } {
  const { enabled = true } = opts;
  const [state, setState] = useState<PollingState<T>>({
    data: null,
    error: null,
    loading: true,
  });
  // Keep the latest fetcher in a ref so the polling loop doesn't re-create
  // its setInterval every time the parent passes a fresh closure (which
  // happens every render unless callers wrap in useCallback). The ref is
  // read inside the interval callback.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const mountedRef = useRef(true);
  const inFlightRef = useRef<Promise<void> | null>(null);

  const refresh = useCallback(async () => {
    if (inFlightRef.current) return inFlightRef.current;
    const request = (async () => {
      try {
        const data = await fetcherRef.current();
        if (mountedRef.current) setState({ data, error: null, loading: false });
      } catch (err) {
        if (mountedRef.current) {
          setState((prev) => ({
            data: prev.data,
            error: err instanceof Error ? err.message : String(err),
            loading: false,
          }));
        }
      } finally {
        inFlightRef.current = null;
      }
    })();
    inFlightRef.current = request;
    return request;
  }, []);

  useEffect(() => {
    if (!enabled) return;
    mountedRef.current = true;
    const scheduler = createSequentialPollScheduler(refresh, intervalMs, {
      isHidden: () => document.hidden,
      setTimer: (callback, delayMs) => window.setTimeout(callback, delayMs),
      clearTimer: (timer) => window.clearTimeout(timer),
    });

    // Fire once immediately so the screen isn't blank for `intervalMs`.
    scheduler.start();

    // Pause on tab blur, resume + immediate-tick on tab focus.
    const onVisibility = scheduler.visibilityChanged;
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      mountedRef.current = false;
      scheduler.stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [intervalMs, enabled, refresh]);

  return { ...state, refresh };
}
