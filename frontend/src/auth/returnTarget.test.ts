import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  authPath,
  authReturnTarget,
  callbackUrl,
  consumeReturnTarget,
  normalizeReturnTarget,
  rememberReturnTarget,
} from "./returnTarget";

describe("auth return targets", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
  };

  beforeAll(() => {
    vi.stubGlobal("window", {
      location: { origin: "https://codetutor.example" },
    });
    vi.stubGlobal("sessionStorage", storage);
  });

  beforeEach(() => storage.clear());

  it("preserves an internal path with query and fragment", () => {
    const target = "/learn/course/python-fundamentals/lesson/variables?from=audit#practice";
    expect(normalizeReturnTarget(target)).toBe(target);
    expect(
      authReturnTarget(`?returnTo=${encodeURIComponent(target)}`, null),
    ).toBe(target);
  });

  it("rejects external, protocol-relative, and auth-loop destinations", () => {
    expect(normalizeReturnTarget("https://evil.example/steal")).toBe("/start");
    expect(normalizeReturnTarget("//evil.example/steal")).toBe("/start");
    expect(normalizeReturnTarget("/login?returnTo=/login")).toBe("/start");
  });

  it("carries the target through callback URLs with storage fallback", () => {
    const target = "/learn/course/python-fundamentals/lesson/variables?from=audit#practice";
    const callback = new URL(callbackUrl(target));
    expect(callback.pathname).toBe("/auth/callback");
    expect(callback.searchParams.get("returnTo")).toBe(target);

    rememberReturnTarget(target);
    expect(consumeReturnTarget("")).toBe(target);
    expect(consumeReturnTarget("")).toBe("/start");
  });

  it("builds auth links without losing the destination", () => {
    const path = authPath("/login", "/editor?file=main.py#output");
    expect(authReturnTarget(new URL(path, window.location.origin).search, null)).toBe(
      "/editor?file=main.py#output",
    );
  });
});
