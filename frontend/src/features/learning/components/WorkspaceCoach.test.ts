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

import { isOnboardingDone } from "./WorkspaceCoach";

beforeEach(() => {
  storage.clear();
});

describe("isOnboardingDone", () => {
  it("returns false when no key set", () => {
    expect(isOnboardingDone()).toBe(false);
  });

  it("returns true when key is '1'", () => {
    storage.set("onboarding:v1:workspace-done", "1");
    expect(isOnboardingDone()).toBe(true);
  });

  it("returns false for other values", () => {
    storage.set("onboarding:v1:workspace-done", "0");
    expect(isOnboardingDone()).toBe(false);
  });
});
