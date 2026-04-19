/**
 * Shared language utilities for authoring scripts (new-lesson, new-practice,
 * content-lint, verify-solutions).
 *
 * The source of truth for Language + LANGUAGE_ENTRYPOINT lives in src/types.ts;
 * this module re-exports the subset the scripts need and adds the per-language
 * authoring knobs (scaffold template paths, function-keyword for stubs, etc.)
 * that the runtime doesn't care about.
 */

import { LANGUAGES, LANGUAGE_ENTRYPOINT, type Language } from "../src/types";

export { LANGUAGES, LANGUAGE_ENTRYPOINT, type Language };

/**
 * Languages the scaffolding CLIs support today. Adding a new language here
 * requires: (1) a templates/<lang>/main.<ext>.template, (2) a verify-solutions
 * execution path, (3) — for function_tests — a backend harness registered in
 * backend/src/services/execution/harness/registry.ts.
 *
 * Kept narrower than LANGUAGES because not every language in the type has
 * authoring templates yet. Phase 12 grows this list.
 */
export const SCAFFOLD_LANGUAGES: readonly Language[] = ["python", "javascript"];

export function isScaffoldLanguage(value: string): value is Language {
  return (SCAFFOLD_LANGUAGES as readonly string[]).includes(value);
}

/**
 * Local stub-starter metadata for scripts only. Used by new-practice to
 * generate a minimal function-shaped starter without a template file for every
 * rule style × language combination.
 */
export const LANGUAGE_SYNTAX: Record<Language, { functionStub: (name: string) => string }> = {
  python: { functionStub: (name) => `def ${name}(/* TODO */):\n    # TODO: implement\n    pass\n` },
  javascript: { functionStub: (name) => `function ${name}(/* TODO */) {\n  // TODO: implement\n}\n` },
  typescript: { functionStub: (name) => `export function ${name}(/* TODO */) {\n  // TODO: implement\n}\n` },
  c: { functionStub: (name) => `// TODO: implement ${name}\n` },
  cpp: { functionStub: (name) => `// TODO: implement ${name}\n` },
  java: { functionStub: (name) => `// TODO: implement ${name}\n` },
  go: { functionStub: (name) => `// TODO: implement ${name}\n` },
  rust: { functionStub: (name) => `// TODO: implement ${name}\n` },
  ruby: { functionStub: (name) => `def ${name}(/* TODO */)\n  # TODO: implement\nend\n` },
};

/**
 * Mirror of backend/src/services/execution/harness/registry.ts for scripts
 * that can't pull from backend sources (content-lint already has
 * frontend/src/.../harnessSupport.ts for this — these scripts run in the
 * frontend context with the same list).
 */
export function hasFunctionTestsHarnessLanguage(lang: Language): boolean {
  return lang === "python";
}

export function entryFileFor(lang: Language): string {
  return LANGUAGE_ENTRYPOINT[lang];
}

export function fileExtForLanguage(lang: Language): string {
  const entry = LANGUAGE_ENTRYPOINT[lang];
  const dot = entry.lastIndexOf(".");
  return dot === -1 ? "" : entry.slice(dot + 1);
}
