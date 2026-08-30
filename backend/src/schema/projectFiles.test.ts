import { describe, expect, it } from "vitest";
import { hasUniqueProjectFilePaths } from "./projectFiles.js";

describe("hasUniqueProjectFilePaths", () => {
  it("accepts one authoritative value per path", () => {
    expect(hasUniqueProjectFilePaths([
      { path: "main.py" },
      { path: "examples/main.py" },
    ])).toBe(true);
  });

  it("rejects duplicate paths even when their contents differ", () => {
    expect(hasUniqueProjectFilePaths([
      { path: "main.py" },
      { path: "main.py" },
    ])).toBe(false);
  });
});
