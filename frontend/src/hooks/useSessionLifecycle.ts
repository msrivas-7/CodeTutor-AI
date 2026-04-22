import { useEffect, useRef } from "react";
import { api, API_BASE, abortSessionRequests } from "../api/client";
import { useSessionStore } from "../state/sessionStore";
import { useAuthStore } from "../auth/authStore";

const HEARTBEAT_MS = 25_000;
// How many consecutive heartbeat failures before we stop saying "reconnecting"
// and surface a hard error. 3 failures × 25s = ~75s of silent retries before
// we bother the user.
const MAX_FAILURES = 3;

export function useSessionLifecycle() {
  const {
    sessionId,
    setSession,
    setPhase,
    setError,
    setSessionRestarted,
    setSessionReplaced,
    clear,
  } = useSessionStore();
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
  // QA-M7: monotonic heartbeat sequence. setInterval doesn't wait for the
  // async tick to finish, so two pings can overlap and land out of order —
  // the older one resolving *after* the newer one must not clobber state.
  // Each tick captures a seq at entry and drops its writes if a newer tick
  // has since fired. Paired with QA-C3 (setError no longer flips phase) so
  // a stale write can't silently downgrade phase either.
  const heartbeatSeq = useRef(0);
  // QA-L5: cache the backend's per-process bootId so we can tell "my
  // session was individually reaped" (same bootId on 404) from "the whole
  // process restarted" (different bootId). First successful response seeds
  // it; every subsequent response refreshes. A mismatch on a 404 flips
  // `sessionReplaced` (modal) instead of the quiet rebind → banner path.
  const knownBootId = useRef<string | null>(null);

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
      .then(({ sessionId: id, backendBootId }) => {
        if (backendBootId) knownBootId.current = backendBootId;
        setSession(id);
      })
      .catch((err: Error) => {
        setError(err.message);
        setPhase("error");
      });
  }, [authLoading, user, sessionId, setSession, setPhase, setError]);

  useEffect(() => {
    if (!sessionId) return;
    failures.current = 0;
    heartbeatSeq.current = 0;
    const tick = async () => {
      const seq = ++heartbeatSeq.current;
      const result = await api.pingSession(sessionId);
      // QA-M7: drop stale writes. A later tick has already claimed the
      // sequence — its response is the authoritative one; ours is noise.
      if (seq !== heartbeatSeq.current) return;
      if (result.ok) {
        if (result.backendBootId) knownBootId.current = result.backendBootId;
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
        // QA-L5: diff the 404's bootId against the one we cached on our last
        // successful response. A mismatch means the process restarted — show
        // the replaced-session modal and skip the silent rebind. Otherwise
        // we'd storm a freshly-booted backend with every tab's rebind at
        // once before deps are warm.
        const bootDrifted =
          !!result.backendBootId &&
          !!knownBootId.current &&
          result.backendBootId !== knownBootId.current;
        if (bootDrifted) {
          abortSessionRequests(sessionId);
          knownBootId.current = result.backendBootId ?? null;
          setSessionReplaced(true);
          setPhase("reconnecting");
          failures.current = 0;
          return;
        }
        recovering.current = true;
        setPhase("reconnecting");
        try {
          const originalId = sessionId;
          const rebound = await api.rebindSession(originalId);
          if (rebound.backendBootId) knownBootId.current = rebound.backendBootId;
          // QA-H3: if the backend handed us a *different* id (owner-mismatch
          // branch in rebindSession — rare but possible), abort every in-flight
          // fetch still carrying the old id before we swap. Otherwise a snapshot
          // or execute fired pre-rebind lands with the stale id and the backend
          // 404s it, flashing a spurious error at the learner seconds after we
          // already recovered. Surface a modal (not the quieter restart banner)
          // because in-memory state they assumed was theirs is not — they need
          // to explicitly acknowledge before continuing to type code against
          // what looks like the same workspace.
          if (rebound.sessionId !== originalId) {
            abortSessionRequests(originalId);
            setSession(rebound.sessionId);
            setSessionReplaced(true);
          } else {
            setSession(rebound.sessionId);
            // `reused=false` means the backend had no live record for this id
            // (backend restart or sweeper reap) and spun up a fresh container
            // under the SAME id. Flip the one-shot banner flag so the UI can
            // surface a dismissible notice — otherwise the runner reset is
            // invisible to the learner until they hit Run and wonder why their
            // prior stdin/artifacts are gone.
            if (!rebound.reused) setSessionRestarted(true);
          }
        } catch (err) {
          setError(`session expired; reconnect failed: ${(err as Error).message}`);
          setPhase("error");
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
        setPhase("error");
      }
    };
    // QA-H1: suppress heartbeats while the tab is hidden. Modern browsers
    // throttle setInterval in hidden tabs (down to once per minute), so the
    // 25s cadence silently stretches to ~60s — if the user switches back
    // after 10 min we'd do one ping, miss the 404, and show the user a
    // stale "active" badge for another minute. Pause on hidden, ping
    // immediately on visible so the UI reconciles before the user does
    // anything. Also, a hidden tab making network calls every 25s is just
    // waste when the learner isn't looking.
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) return;
      timer = setInterval(tick, HEARTBEAT_MS);
    };
    const stop = () => {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        stop();
      } else {
        void tick();
        start();
      }
    };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      stop();
    };
  }, [sessionId, setSession, setPhase, setError, setSessionRestarted, setSessionReplaced]);

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
