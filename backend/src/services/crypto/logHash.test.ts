import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { _resetLogHashForTest, hashUserId } from "./logHash.js";

describe("hashUserId", () => {
  beforeEach(() => {
    _resetLogHashForTest();
  });

  afterEach(() => {
    _resetLogHashForTest();
  });

  it("returns 'anon' for null / undefined / empty input", () => {
    expect(hashUserId(null)).toBe("anon");
    expect(hashUserId(undefined)).toBe("anon");
    expect(hashUserId("")).toBe("anon");
  });

  it("returns a 12-char hex digest for a UUID", () => {
    const hash = hashUserId("11111111-2222-3333-4444-555555555555");
    expect(hash).toMatch(/^[0-9a-f]{12}$/);
  });

  it("is stable across calls within one process (same salt)", () => {
    const a = hashUserId("user-a");
    const b = hashUserId("user-a");
    expect(a).toBe(b);
  });

  it("produces different digests for different users", () => {
    const a = hashUserId("user-a");
    const b = hashUserId("user-b");
    expect(a).not.toBe(b);
  });

  it("never echoes the raw userId string in its output", () => {
    const userId = "00000000-0000-0000-0000-000000000001";
    const hash = hashUserId(userId);
    expect(hash).not.toContain(userId);
    // Nor any recognizable UUID fragment
    expect(hash).not.toContain("0000");
  });
});
