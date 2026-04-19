import type { Language } from "../commands.js";
import type { HarnessBackend } from "./types.js";
import { pythonHarness } from "./pythonHarness.js";

// Plug-in registry for per-language function_test harnesses. The route layer
// looks up by language; absent entries return null and the route replies 422.
// Adding a language is a one-line addition here — no changes to the runner,
// route, or frontend client.
const HARNESSES: Partial<Record<Language, HarnessBackend>> = {
  python: pythonHarness,
};

export function getHarness(language: Language): HarnessBackend | null {
  return HARNESSES[language] ?? null;
}

export function hasHarness(language: Language): boolean {
  return language in HARNESSES;
}

export function registeredHarnessLanguages(): Language[] {
  return Object.keys(HARNESSES) as Language[];
}
