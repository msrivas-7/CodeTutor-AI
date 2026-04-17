import { describe, it, expect, beforeEach, vi } from "vitest";

const storage = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
  clear: () => storage.clear(),
  get length() { return storage.size; },
  key: () => null as string | null,
});

import { isWelcomeDone, markWelcomeDone } from "./WelcomeOverlay";

beforeEach(() => {
  storage.clear();
});

describe("WelcomeOverlay logic", () => {
  it("isWelcomeDone returns false initially", () => {
    expect(isWelcomeDone()).toBe(false);
  });

  it("isWelcomeDone returns true after markWelcomeDone", () => {
    markWelcomeDone();
    expect(isWelcomeDone()).toBe(true);
  });

  it("uses correct localStorage key", () => {
    markWelcomeDone();
    expect(storage.get("onboarding:v1:welcome-done")).toBe("1");
  });
});
