const WRITER_STORAGE_KEY = "codetutor:writer-id";

function fallbackUuid(): string {
  const suffix = Array.from({ length: 12 }, () =>
    Math.floor(Math.random() * 16).toString(16),
  ).join("");
  return `00000000-0000-4000-8000-${suffix}`;
}

function getTabWriterId(): string {
  const generated = globalThis.crypto?.randomUUID?.() ?? fallbackUuid();
  if (typeof window === "undefined") return generated;
  try {
    const existing = window.sessionStorage.getItem(WRITER_STORAGE_KEY);
    if (existing) return existing;
    window.sessionStorage.setItem(WRITER_STORAGE_KEY, generated);
  } catch {
    // Storage can be disabled; a per-module UUID still distinguishes this tab.
  }
  return generated;
}

export const tabWriterId = getTabWriterId();
