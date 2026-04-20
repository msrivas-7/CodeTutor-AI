import type { Language } from "../../../types";

// Languages that have a registered function_tests harness backend. Mirrors the
// backend registry in backend/src/services/execution/harness/registry.ts —
// both sides must agree, since content-lint and validator use this to reject
// or flag function_tests on languages the backend can't actually execute.
// Adding a language means one line here AND one line in the backend registry.
export const LANGUAGES_WITH_FUNCTION_TESTS_HARNESS: readonly Language[] = [
  "python",
  "javascript",
];

export function hasFunctionTestsHarness(lang: Language): boolean {
  return LANGUAGES_WITH_FUNCTION_TESTS_HARNESS.includes(lang);
}
