import { useCallback, useEffect, useState } from "react";
import {
  setUiLayoutValue,
  useUiLayoutValue,
  usePreferencesStore,
} from "../state/preferencesStore";

// A20: layouts below 1024 px cram three columns into a space better suited
// to two. Tracks the OS-level viewport breakpoint reactively so pages can
// auto-collapse a rail on narrow viewports.
export function useNarrowViewport(maxPx: number = 1024): boolean {
  const [narrow, setNarrow] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return false;
    }
    return window.matchMedia(`(max-width: ${maxPx}px)`).matches;
  });
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const mq = window.matchMedia(`(max-width: ${maxPx}px)`);
    const onChange = (e: MediaQueryListEvent) => setNarrow(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [maxPx]);
  return narrow;
}

// Phase 27-v2.2 audit fix D1 (staff-qa): "phone-class form factor"
// detection that survives orientation. The width-only `useNarrowViewport`
// check returns false on iPhone 13 landscape (844×390) — Maya rotates
// her phone to read code more easily, the WorkspaceCoach phone-skip and
// CinematicGreeting earlier-Skip mitigations evaporate exactly when the
// form-factor pressure is highest. Match: portrait ≤639 px wide OR
// landscape ≤480 px tall on tablet-and-narrower (≤1024 px wide).
const PHONE_FORM_FACTOR_MQ =
  "(max-width: 639px), (max-height: 480px) and (max-width: 1024px)";

export function usePhoneFormFactor(): boolean {
  const [phone, setPhone] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return false;
    }
    return window.matchMedia(PHONE_FORM_FACTOR_MQ).matches;
  });
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const mq = window.matchMedia(PHONE_FORM_FACTOR_MQ);
    const onChange = (e: MediaQueryListEvent) => setPhone(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return phone;
}

// Phase 18b: layout prefs (panel widths, collapsed flags) live in the
// user_preferences.ui_layout jsonb bucket instead of localStorage. The two
// useXxx hooks below mirror the pre-18b signatures so consuming pages
// (EditorPage, LessonPage) can keep calling them unchanged.

// Side panels are clamped against a fraction of viewport width so that on
// narrow displays the user can't drag a side panel wide enough to starve the
// editor. On wide displays the hardMax still wins.
const SIDE_PANEL_VW_FRACTION = 0.45;

export function clamp(v: number, [min, max]: readonly [number, number]): number {
  return Math.max(min, Math.min(max, v));
}

export function clampSide(v: number, [min, hardMax]: readonly [number, number]): number {
  const vw = typeof window !== "undefined" ? window.innerWidth : Infinity;
  const max = Math.min(hardMax, Math.floor(vw * SIDE_PANEL_VW_FRACTION));
  return Math.max(min, Math.min(max, v));
}

function readLayout<T>(key: string, fallback: T, predicate: (v: unknown) => v is T): T {
  const v = usePreferencesStore.getState().uiLayout[key];
  return predicate(v) ? v : fallback;
}

const isFiniteNumber = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v > 0;
const isBool = (v: unknown): v is boolean => typeof v === "boolean";

export function usePersistedNumber(
  key: string,
  fallback: number,
): [number, React.Dispatch<React.SetStateAction<number>>] {
  const raw = useUiLayoutValue<number>(key, fallback);
  const value = isFiniteNumber(raw) ? raw : fallback;
  // Functional updates MUST read from the live store — mousemove events on a
  // splitter drag fire multiple times within one React render cycle, so a
  // closure-captured `value` would cause every event to compute from the
  // same stale base and drop intermediate drags.
  const setValue = useCallback<React.Dispatch<React.SetStateAction<number>>>(
    (next) => {
      const resolved = typeof next === "function"
        ? (next as (prev: number) => number)(readLayout(key, fallback, isFiniteNumber))
        : next;
      setUiLayoutValue(key, resolved);
    },
    [key, fallback],
  );
  return [value, setValue];
}

export function usePersistedFlag(
  key: string,
  fallback: boolean,
): [boolean, React.Dispatch<React.SetStateAction<boolean>>] {
  const raw = useUiLayoutValue<boolean>(key, fallback);
  const value = isBool(raw) ? raw : fallback;
  const setValue = useCallback<React.Dispatch<React.SetStateAction<boolean>>>(
    (next) => {
      const resolved = typeof next === "function"
        ? (next as (prev: boolean) => boolean)(readLayout(key, fallback, isBool))
        : next;
      setUiLayoutValue(key, resolved);
    },
    [key, fallback],
  );
  return [value, setValue];
}

// Phase 27 — device-local boolean flag, mirrors usePersistedFlag's
// signature but persists to localStorage instead of the server-stored
// uiLayout bucket. Use for UI state where the right value depends on
// the device class (mobile vs desktop) — e.g., panel collapse flags.
//
// The bug this fixes: a user on a phone collapses the instructions or
// tutor panel (or A20's auto-collapse fires on a narrow viewport),
// then opens the same lesson on desktop — and the panel is still
// collapsed. A new learner has no idea where the instructions went or
// how to find the tutor. Server-side persistence is the right home
// for cross-device prefs (theme, persona, BYOK key); collapse state
// is per-device.
//
// Read happens synchronously in useState init so there's no flicker
// between default render and the localStorage value. Writes go
// through the standard React batch — there's no debounce because
// collapse toggles are infrequent.
//
// Per /Users/mehul/.claude/projects/-Users-mehul-Projects-AICodeEditor/
// memory/feedback_no_localstorage_migration.md: localStorage is fine
// for device-local UI state; the rule "no localStorage → DB migration
// ever" applies to legacy DATA hydration, not to per-device prefs.
function readLocalStorageFlag(key: string, fallback: boolean): boolean {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    if (raw === "true") return true;
    if (raw === "false") return false;
    return fallback;
  } catch {
    // localStorage can throw in private-mode Safari, sandboxed iframes,
    // or when the quota is exhausted. Falling back is silent on
    // purpose — the panel just renders in its default state.
    return fallback;
  }
}

function writeLocalStorageFlag(key: string, value: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value ? "true" : "false");
  } catch {
    // Same swallow as the read path — write failures aren't fatal,
    // the user can re-toggle if a future read returns the fallback.
  }
}

export function useLocalStorageFlag(
  key: string,
  fallback: boolean,
): [boolean, React.Dispatch<React.SetStateAction<boolean>>] {
  const [value, setStateValue] = useState<boolean>(() =>
    readLocalStorageFlag(key, fallback),
  );
  const setValue = useCallback<React.Dispatch<React.SetStateAction<boolean>>>(
    (next) => {
      setStateValue((prev) => {
        const resolved =
          typeof next === "function"
            ? (next as (prev: boolean) => boolean)(prev)
            : next;
        writeLocalStorageFlag(key, resolved);
        return resolved;
      });
    },
    [key],
  );
  return [value, setValue];
}
