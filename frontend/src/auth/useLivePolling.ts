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

  const refresh = useCallback(async () => {
    try {
      const data = await fetcherRef.current();
      setState({ data, error: null, loading: false });
    } catch (err) {
      setState((prev) => ({
        data: prev.data,
        error: err instanceof Error ? err.message : String(err),
        loading: false,
      }));
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer: number | null = null;

    const tick = async () => {
      if (cancelled || document.hidden) return;
      try {
        const data = await fetcherRef.current();
        if (!cancelled) setState({ data, error: null, loading: false });
      } catch (err) {
        if (!cancelled) {
          setState((prev) => ({
            data: prev.data,
            error: err instanceof Error ? err.message : String(err),
            loading: false,
          }));
        }
      }
    };

    // Fire once immediately so the screen isn't blank for `intervalMs`.
    void tick();
    timer = window.setInterval(() => void tick(), intervalMs);

    // Pause on tab blur, resume + immediate-tick on tab focus.
    const onVisibility = () => {
      if (document.hidden) return;
      void tick();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      if (timer !== null) window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [intervalMs, enabled]);

  return { ...state, refresh };
}
