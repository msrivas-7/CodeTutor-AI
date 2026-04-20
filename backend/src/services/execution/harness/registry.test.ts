import { describe, it, expect } from "vitest";
import {
  getHarness,
  hasHarness,
  registeredHarnessLanguages,
} from "./registry.js";
import { pythonHarness } from "./pythonHarness.js";
import { javascriptHarness } from "./javascriptHarness.js";
import { LANGUAGES } from "../commands.js";

const REGISTERED: ReadonlySet<string> = new Set(["python", "javascript"]);

describe("harness registry", () => {
  it("returns the Python harness for language 'python'", () => {
    expect(getHarness("python")).toBe(pythonHarness);
    expect(hasHarness("python")).toBe(true);
  });

  it("returns the JavaScript harness for language 'javascript'", () => {
    expect(getHarness("javascript")).toBe(javascriptHarness);
    expect(hasHarness("javascript")).toBe(true);
  });

  it("returns null / false for languages without a registered harness", () => {
    for (const lang of LANGUAGES) {
      if (REGISTERED.has(lang)) continue;
      expect(hasHarness(lang)).toBe(false);
      expect(getHarness(lang)).toBeNull();
    }
  });

  it("lists exactly the languages that have backends", () => {
    const listed = registeredHarnessLanguages();
    // Lock the current set in — adding a language should be a conscious
    // change across this test + registry.ts + harnessSupport.ts.
    expect(new Set(listed)).toEqual(REGISTERED);
  });
});
