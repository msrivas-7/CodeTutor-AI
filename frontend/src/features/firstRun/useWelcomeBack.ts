import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { useAuthStore } from "../../auth/authStore";
import { usePreferencesStore } from "../../state/preferencesStore";
import { useProgressStore } from "../learning/stores/progressStore";
import { resolveFirstName } from "./resolveFirstName";
import {
  resolveWelcomeBackCopy,
  type WelcomeBackCopy,
} from "./resolveWelcomeBackCopy";

// Decides whether the welcome-back overlay should render on the current
// authenticated route, derives its copy, and exposes a dismissal handler
// that stamps `lastWelcomeBackAt` on the server. AuthedLayout mounts a
// single instance of <WelcomeBackOverlay /> and uses this hook as the
// gate.
//
// Trigger rule (all must hold):
//   1. User is signed in, preferences hydrated.
//   2. `welcomeDone === true` (not a first-run path).
//   3. Route is `/` or `/learn` only — never mid-work (deep lesson link).
//   4. `lastWelcomeBackAt` is null OR > 6 h ago OR a different calendar
//      day (strictest: new day = nearly always shows; short tab-cycle =
//      doesn't). Calendar day uses the learner's local timezone.
//
// The DB write fires once per dismissal (click anywhere / Esc / auto).
// It uses the existing preferencesStore `patch()` contract — optimistic
// update, debounced server write, rollback on failure. Worst case a
// failed write means the user sees welcome-back twice in a day. Fine.

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const ALLOWED_PATHS = new Set(["/", "/learn"]);

// Courses rarely change during a single tab lifetime; we look them up
// from the catalogLoader the first time the hook consumes progress.
// For now, a no-op — we pass progress maps + firstName and call it a
// day. Real catalog lookup happens inside resolveWelcomeBackCopy via
// the `courseCatalog` param, populated by callers that already have
// the courses loaded. AuthedLayout doesn't have those, so we'll lean
// on the fallback ("Picking up where you left off.") when the learner
// is on `/` with an in-progress lesson — their next click lands them
// in CourseOverview which DOES know the titles.

export interface UseWelcomeBackResult {
  shouldShow: boolean;
  firstName: string;
  copy: WelcomeBackCopy | null;
  /** Called by the overlay when dismissed (click / Esc / auto). Writes
   *  the current timestamp to preferences.lastWelcomeBackAt. */
  dismiss: () => void;
}

export function useWelcomeBack(): UseWelcomeBackResult {
  const location = useLocation();
  const user = useAuthStore((s) => s.user);
  const welcomeDone = usePreferencesStore((s) => s.welcomeDone);
  const prefsHydrated = usePreferencesStore((s) => s.hydrated);
  const lastWelcomeBackAt = usePreferencesStore((s) => s.lastWelcomeBackAt);
  const patch = usePreferencesStore((s) => s.patch);
  const courseProgressMap = useProgressStore((s) => s.courseProgress);
  const lessonProgressMap = useProgressStore((s) => s.lessonProgress);
  const progressHydrated = useProgressStore((s) => s.hydrated);

  // Snapshot the trigger decision once when the hook mounts / its
  // gate inputs change. A learner sitting on / for an hour shouldn't
  // suddenly get an overlay because the clock crossed 6 hours mid-
  // session. State transitions from false → true happen on mount /
  // route change / login — not on the clock ticking.
  const [dismissed, setDismissed] = useState(false);

  const shouldShow = useMemo(() => {
    if (dismissed) return false;
    if (!user) return false;
    if (!prefsHydrated || !progressHydrated) return false;
    if (!welcomeDone) return false; // first-run path owns the greeting
    if (!ALLOWED_PATHS.has(location.pathname)) return false;

    const now = Date.now();
    if (lastWelcomeBackAt === null) return true; // never shown
    const last = Date.parse(lastWelcomeBackAt);
    if (Number.isNaN(last)) return true; // corrupt value — recover by showing
    if (now - last > SIX_HOURS_MS) return true;
    // Calendar-day check (local TZ): if the user welcomed at 10:30 PM
    // and comes back at 2 AM the same night, it's a new calendar day —
    // greet again.
    const lastDate = new Date(last);
    const nowDate = new Date(now);
    if (
      lastDate.getFullYear() !== nowDate.getFullYear() ||
      lastDate.getMonth() !== nowDate.getMonth() ||
      lastDate.getDate() !== nowDate.getDate()
    ) {
      return true;
    }
    return false;
  }, [
    dismissed,
    user,
    prefsHydrated,
    progressHydrated,
    welcomeDone,
    lastWelcomeBackAt,
    location.pathname,
  ]);

  const firstName = useMemo(() => resolveFirstName(user), [user]);

  const copy = useMemo<WelcomeBackCopy | null>(() => {
    if (!shouldShow) return null;
    return resolveWelcomeBackCopy({
      firstName,
      lastWelcomeBackAt,
      courseProgressMap,
      lessonProgressMap,
    });
  }, [shouldShow, firstName, lastWelcomeBackAt, courseProgressMap, lessonProgressMap]);

  const dismiss = useCallback(() => {
    setDismissed(true);
    void patch({ lastWelcomeBackAt: new Date().toISOString() }).catch(() => {
      /* already logged by preferencesStore; overlay is already gone */
    });
  }, [patch]);

  return { shouldShow, firstName, copy, dismiss };
}
