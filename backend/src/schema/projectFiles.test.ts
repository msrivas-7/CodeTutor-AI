import { describe, expect, it } from "vitest";
import {
  canonicalProjectFilePath,
  hasUniqueProjectFilePaths,
} from "./projectFiles.js";

describe("canonicalProjectFilePath", () => {
  it("matches filesystem-equivalent project paths", () => {
    expect(canonicalProjectFilePath("./src//main.py")).toBe("src/main.py");
    expect(canonicalProjectFilePath("\\src\\main.py")).toBe("src/main.py");
  });

  it("rejects paths the execution backend cannot write", () => {
    expect(canonicalProjectFilePath("../main.py")).toBeNull();
    expect(canonicalProjectFilePath("src/-flag.py")).toBeNull();
    expect(canonicalProjectFilePath("///")).toBeNull();
  });
});

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

  it("rejects filesystem-equivalent duplicate paths", () => {
    expect(hasUniqueProjectFilePaths([
      { path: "main.py" },
      { path: "./main.py" },
    ])).toBe(false);
    expect(hasUniqueProjectFilePaths([
      { path: "src/main.py" },
      { path: "src//main.py" },
    ])).toBe(false);
    expect(hasUniqueProjectFilePaths([
      { path: "src/main.py" },
      { path: "src\\main.py" },
    ])).toBe(false);
  });

  it("rejects a singleton path alias instead of signing a different identity than execution", () => {
    expect(hasUniqueProjectFilePaths([{ path: "./main.py" }])).toBe(false);
    expect(hasUniqueProjectFilePaths([{ path: "/main.py" }])).toBe(false);
    expect(hasUniqueProjectFilePaths([{ path: "src//main.py" }])).toBe(false);
    expect(hasUniqueProjectFilePaths([{ path: "src\\main.py" }])).toBe(false);
  });
});
