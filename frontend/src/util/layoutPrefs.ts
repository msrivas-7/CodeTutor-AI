import { useEffect, useState } from "react";
import { noteStorageQuotaError } from "../state/storageStore";

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

export function usePersistedNumber(
  key: string,
  fallback: number,
): [number, React.Dispatch<React.SetStateAction<number>>] {
  const [value, setValue] = useState<number>(() => {
    try {
      const v = Number(localStorage.getItem(key));
      return Number.isFinite(v) && v > 0 ? v : fallback;
    } catch {
      return fallback;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, String(value));
    } catch (err) {
      noteStorageQuotaError(err);
    }
  }, [key, value]);
  return [value, setValue];
}

export function usePersistedFlag(
  key: string,
  fallback: boolean,
): [boolean, React.Dispatch<React.SetStateAction<boolean>>] {
  const [value, setValue] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return fallback;
      return raw === "1";
    } catch {
      return fallback;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, value ? "1" : "0");
    } catch (err) {
      noteStorageQuotaError(err);
    }
  }, [key, value]);
  return [value, setValue];
}
