import { describe, expect, it } from "vitest";
import { resolveDatabasePoolMax } from "./poolConfig.js";

describe("resolveDatabasePoolMax", () => {
  it("preserves the calibrated production default", () => {
    expect(resolveDatabasePoolMax(undefined)).toBe(25);
    expect(resolveDatabasePoolMax(" ")).toBe(25);
  });

  it("accepts a bounded E2E connection ceiling", () => {
    expect(resolveDatabasePoolMax("6")).toBe(6);
    expect(resolveDatabasePoolMax("1")).toBe(1);
    expect(resolveDatabasePoolMax("25")).toBe(25);
  });

  it.each(["0", "26", "6.5", "abc"])("rejects invalid value %s", (raw) => {
    expect(() => resolveDatabasePoolMax(raw)).toThrow(
      "DATABASE_POOL_MAX must be an integer from 1 to 25",
    );
  });
});

