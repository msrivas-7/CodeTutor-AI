import { api, API_BASE } from "../../../api/client";
import { useAuthStore } from "../../../auth/authStore";

// P-H4 (adversarial audit, bucket 4b): client-side heartbeat accumulator.
// Before: every 30s tick inside useLessonLoader fired a PATCH to
// /api/user/lessons/:courseId/:lessonId that rewrote time_spent_ms via
// COALESCE — 120 writes/hr/user, each one a round-trip through the
// Express middleware stack + Supabase pooler.
//
// After: the tick bumps an in-memory buffer here. We flush every FLUSH_MS
// to POST /api/user/lessons/heartbeat as a batch of additive deltas, and
// on pagehide we send whatever's pending with fetch(keepalive:true) so
// the write survives tab-close.
//
// Why not sendBeacon: the Phase 18a auth middleware requires a Bearer
// token, and sendBeacon can't set request headers. The project-wide
// pattern (see useSessionLifecycle.ts) is fetch(keepalive:true) with the
// cached access_token — same trade-off applies here.

const FLUSH_MS = 60_000;

type Key = string; // `${courseId}/${lessonId}`

interface PendingItem {
  courseId: string;
  lessonId: string;
  deltaMs: number;
}

const pending = new Map<Key, PendingItem>();
let flushTimer: ReturnType<typeof setInterval> | null = null;

function keyOf(courseId: string, lessonId: string): Key {
  return `${courseId}/${lessonId}`;
}

export function bufferLessonTime(
  courseId: string,
  lessonId: string,
  deltaMs: number,
): void {
  if (!(deltaMs > 0)) return;
  const k = keyOf(courseId, lessonId);
  const prev = pending.get(k);
  pending.set(k, {
    courseId,
    lessonId,
    deltaMs: (prev?.deltaMs ?? 0) + deltaMs,
  });
}

function drainPending(): PendingItem[] {
  if (pending.size === 0) return [];
  const items = Array.from(pending.values());
  pending.clear();
  return items;
}

export async function flushLessonHeartbeat(): Promise<void> {
  const items = drainPending();
  if (items.length === 0) return;
  try {
    await api.sendLessonHeartbeat(items);
  } catch (err) {
    // Requeue the drained items so a transient network error doesn't
    // lose them — the next successful flush (periodic or pagehide) will
    // send them. Newer deltas accumulated during the failed request
    // coalesce with the requeue via the Map key.
    for (const it of items) {
      const prev = pending.get(keyOf(it.courseId, it.lessonId));
      pending.set(keyOf(it.courseId, it.lessonId), {
        courseId: it.courseId,
        lessonId: it.lessonId,
        deltaMs: (prev?.deltaMs ?? 0) + it.deltaMs,
      });
    }
    console.error("[heartbeat] flush failed:", (err as Error).message);
  }
}

// Pagehide path: we can't await the POST and the browser won't wait on a
// returned Promise. Use fetch(keepalive:true) — same pattern as
// useSessionLifecycle's endBeacon — and fire-and-forget. Matches the
// headers the api client sets so the backend's csrfGuard + authMiddleware
// accept it.
function flushOnPagehide(): void {
  const items = drainPending();
  if (items.length === 0) return;
  const token = useAuthStore.getState().session?.access_token;
  if (!token) return;
  try {
    void fetch(`${API_BASE}/api/user/lessons/heartbeat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "codetutor",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ items }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Ignore — the next mount's periodic flush (after a cold reload)
    // will miss this particular tick, and that's acceptable. The ledger
    // isn't lifetime-perfect accounting, it's a progress signal.
  }
}

// Idempotent installer. Called from useLessonLoader on mount; safe to call
// from multiple hook instances because the module-level flag guards the
// listener registrations.
let installed = false;
export function installLessonHeartbeatLifecycle(): () => void {
  if (installed) return () => {};
  installed = true;
  flushTimer = setInterval(() => {
    void flushLessonHeartbeat();
  }, FLUSH_MS);
  const onPageHide = (e: PageTransitionEvent) => {
    // `persisted: true` → bfcache freeze; the page will resurrect with
    // its timers intact, so we don't need to flush here.
    if (e.persisted) return;
    flushOnPagehide();
  };
  const onVisibility = () => {
    if (document.visibilityState === "hidden") {
      // Synchronous-ish flush via the pagehide path — sends what's
      // currently buffered without waiting on the normal 60s tick. Mobile
      // browsers fire visibilitychange reliably; pagehide only fires on
      // some app-backgrounding paths.
      flushOnPagehide();
    }
  };
  window.addEventListener("pagehide", onPageHide);
  document.addEventListener("visibilitychange", onVisibility);
  return () => {
    if (flushTimer) clearInterval(flushTimer);
    flushTimer = null;
    window.removeEventListener("pagehide", onPageHide);
    document.removeEventListener("visibilitychange", onVisibility);
    installed = false;
  };
}

export function __resetLessonHeartbeatForTests(): void {
  pending.clear();
  if (flushTimer) clearInterval(flushTimer);
  flushTimer = null;
  installed = false;
}
