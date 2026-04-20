import { describe, it, expect } from "vitest";
import path from "node:path";
import { safeResolve } from "./snapshot.js";

// safeResolve runs inside the backend Linux container in production, so
// `path.sep` is "/" there. When the Windows CI runner executes this test,
// `path.sep` is "\\" — which is exactly why we want these assertions to run
// on every OS: any drift in path.resolve/path.sep behaviour surfaces here
// before it breaks the ExecutionBackend file-I/O paths in a runtime-only way.

const ws = path.resolve("/tmp/workspace");
const join = (...parts: string[]): string => path.join(ws, ...parts);

describe("safeResolve", () => {
  describe("happy paths", () => {
    it("resolves a simple filename", () => {
      expect(safeResolve(ws, "main.py")).toBe(join("main.py"));
    });

    it("resolves a nested file", () => {
      expect(safeResolve(ws, "src/utils/helpers.ts")).toBe(
        join("src", "utils", "helpers.ts")
      );
    });

    it("normalises backslashes in the input to forward slashes before resolving", () => {
      // Frontend on Windows may send paths with backslashes. The backend
      // always runs on Linux, but the logic must tolerate either shape.
      expect(safeResolve(ws, "src\\utils\\helpers.ts")).toBe(
        join("src", "utils", "helpers.ts")
      );
    });

    it("strips a leading forward slash (treats as relative)", () => {
      expect(safeResolve(ws, "/file.txt")).toBe(join("file.txt"));
    });

    it("strips multiple leading forward slashes", () => {
      expect(safeResolve(ws, "///file.txt")).toBe(join("file.txt"));
    });
  });

  describe("rejections", () => {
    it("rejects an empty path", () => {
      expect(() => safeResolve(ws, "")).toThrow(/invalid path/);
    });

    it("rejects a path that only contains slashes", () => {
      expect(() => safeResolve(ws, "///")).toThrow(/invalid path/);
    });

    it("rejects parent-directory traversal via ..", () => {
      expect(() => safeResolve(ws, "../outside")).toThrow(/invalid path/);
    });

    it("rejects .. even when embedded mid-path", () => {
      expect(() => safeResolve(ws, "a/../../outside")).toThrow(/invalid path/);
    });

    it("rejects .. after backslash normalisation", () => {
      expect(() => safeResolve(ws, "a\\..\\..\\outside")).toThrow(/invalid path/);
    });
  });

  describe("cross-platform sanity", () => {
    it("always returns an absolute path for valid input", () => {
      const result = safeResolve(ws, "file.txt");
      expect(path.isAbsolute(result)).toBe(true);
    });

    it("returned path stays within the workspace", () => {
      const result = safeResolve(ws, "sub/dir/file.txt");
      expect(result.startsWith(ws + path.sep)).toBe(true);
    });
  });
});
