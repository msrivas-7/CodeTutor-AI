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
