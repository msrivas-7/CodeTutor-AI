import { describe, it, expect } from "vitest";
import {
  getHarness,
  hasHarness,
  registeredHarnessLanguages,
} from "./registry.js";
import { pythonHarness } from "./pythonHarness.js";
import { LANGUAGES } from "../commands.js";

describe("harness registry", () => {
  it("returns the Python harness for language 'python'", () => {
    expect(getHarness("python")).toBe(pythonHarness);
    expect(hasHarness("python")).toBe(true);
  });

  it("returns null / false for languages without a registered harness", () => {
    for (const lang of LANGUAGES) {
      if (lang === "python") continue;
      expect(hasHarness(lang)).toBe(false);
      expect(getHarness(lang)).toBeNull();
    }
  });

  it("lists exactly the languages that have backends", () => {
    const listed = registeredHarnessLanguages();
    expect(listed).toContain("python");
    // Registry currently only has Python; lock that in so future additions
    // are a conscious change (this test + one line in registry.ts).
    expect(listed).toEqual(["python"]);
  });
});
