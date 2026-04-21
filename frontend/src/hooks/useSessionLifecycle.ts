import { useEffect, useRef } from "react";
import { api, API_BASE } from "../api/client";
import { useSessionStore } from "../state/sessionStore";
import { useAuthStore } from "../auth/authStore";

const HEARTBEAT_MS = 25_000;
// How many consecutive heartbeat failures before we stop saying "reconnecting"
// and surface a hard error. 3 failures × 25s = ~75s of silent retries before
// we bother the user.
const MAX_FAILURES = 3;

export function useSessionLifecycle() {
  const { sessionId, setSession, setPhase, setError, clear } = useSessionStore();
  // Phase 18a: don't start a session until Supabase has hydrated — the first
  // render sees `loading: true`, and `startSession` would otherwise fire
  // without an Authorization header and 401. Gate on `user` presence too so
  // RequireAuth bounces unauth'd users to /login before we try to start
  // a container for them.
  const authLoading = useAuthStore((s) => s.loading);
  const user = useAuthStore((s) => s.user);
  const started = useRef(false);
  const failures = useRef(0);
  const recovering = useRef(false);

  useEffect(() => {
    if (authLoading || !user) return;
    if (started.current) return;
    // sessionStore persists across page navigations; if the previous page
    // (Editor ⇄ Lesson) already started a session, reuse it instead of
    // leaking another container on the backend.
    if (sessionId) {
      started.current = true;
      return;
    }
    started.current = true;
    setPhase("starting");
    api
      .startSession()
      .then(({ sessionId: id }) => setSession(id))
      .catch((err: Error) => setError(err.message));
  }, [authLoading, user, sessionId, setSession, setPhase, setError]);

  useEffect(() => {
    if (!sessionId) return;
    failures.current = 0;
    const tick = async () => {
      const result = await api.pingSession(sessionId);
      if (result.ok) {
        // Recovered — reset counters and restore active badge if we were
        // showing "reconnecting" / "error".
        if (failures.current > 0) {
          failures.current = 0;
          setPhase("active");
          setError(null);
        }
        return;
      }
      // Backend says this session is gone (cleanup sweeper killed it, backend
      // restarted, etc). Try to rebind to the SAME id — this keeps the status
      // badge, logs, and workspace path stable across reconnects. Code isn't
      // in the workspace anyway (it lives in the frontend's projectStore and
      // gets re-snapshotted on each Run), but keeping the id is cleaner.
      if (result.status === 404 && !recovering.current) {
        recovering.current = true;
        setPhase("reconnecting");
        try {
          const rebound = await api.rebindSession(sessionId);
          setSession(rebound.sessionId);
        } catch (err) {
          setError(`session expired; reconnect failed: ${(err as Error).message}`);
        } finally {
          recovering.current = false;
        }
        return;
      }
      failures.current += 1;
      if (failures.current < MAX_FAILURES) {
        setPhase("reconnecting");
      } else {
        setError(result.error || "heartbeat failed");
      }
    };
    const timer = setInterval(tick, HEARTBEAT_MS);
    return () => clearInterval(timer);
  }, [sessionId, setSession, setPhase, setError]);

  useEffect(() => {
    if (!sessionId) return;
    const endBeacon = () => {
      // sendBeacon can't set headers (including Authorization), so it
      // would 401 with the Phase 18a auth middleware. Fall back to a
      // synchronous fetch with keepalive + the current token. keepalive:true
      // lets the request survive the page unload up to the browser limit.
      // We only read the cached token from the authStore synchronously —
      // calling `supabase.auth.getSession()` here would return a Promise
      // that the browser won't wait on during unload, so we skip it and
      // let the backend sweeper reap the session if the token isn't hot.
      const token = useAuthStore.getState().session?.access_token;
      if (!token) return;
      void fetch(`${API_BASE}/api/session/end`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "codetutor",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ sessionId }),
        keepalive: true,
      }).catch(() => {});
    };
    // Only fire on true unload — `pagehide` with persisted=false means the page
    // is actually going away (not just bfcache-frozen, which would resurrect).
    const onPageHide = (e: PageTransitionEvent) => {
      if (!e.persisted) endBeacon();
    };
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [sessionId]);

  return { clear };
}
