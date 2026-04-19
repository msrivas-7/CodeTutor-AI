import { useEffect, useRef } from "react";
import { api } from "../api/client";
import { useSessionStore } from "../state/sessionStore";

const HEARTBEAT_MS = 25_000;
// How many consecutive heartbeat failures before we stop saying "reconnecting"
// and surface a hard error. 3 failures × 25s = ~75s of silent retries before
// we bother the user.
const MAX_FAILURES = 3;

export function useSessionLifecycle() {
  const { sessionId, setSession, setPhase, setError, clear } = useSessionStore();
  const started = useRef(false);
  const failures = useRef(0);
  const recovering = useRef(false);

  useEffect(() => {
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
  }, [sessionId, setSession, setPhase, setError]);

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
      navigator.sendBeacon?.(
        "/api/session/end",
        new Blob([JSON.stringify({ sessionId })], { type: "application/json" })
      );
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
