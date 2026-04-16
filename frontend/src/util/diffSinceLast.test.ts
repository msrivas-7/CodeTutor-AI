import { describe, it, expect } from "vitest";
import { computeDiffSinceLast } from "./diffSinceLast";

describe("computeDiffSinceLast", () => {
  it("returns null when there's no prior snapshot", () => {
    expect(computeDiffSinceLast(null, [{ path: "a.py", content: "x" }])).toBeNull();
  });

  it("returns a no-changes marker when prior and current match", () => {
    const prev = { "a.py": "x\ny\n" };
    const curr = [{ path: "a.py", content: "x\ny\n" }];
    expect(computeDiffSinceLast(prev, curr)).toBe("(no file edits since last tutor turn)");
  });

  it("marks an ADDED file", () => {
    const out = computeDiffSinceLast({ "a.py": "old" }, [
      { path: "a.py", content: "old" },
      { path: "b.py", content: "hello\nworld" },
    ]);
    expect(out).toContain("--- b.py (ADDED) ---");
    expect(out).toContain("hello\nworld");
  });

  it("marks a REMOVED file", () => {
    const out = computeDiffSinceLast({ "a.py": "x", "b.py": "bye" }, [
      { path: "a.py", content: "x" },
    ]);
    expect(out).toContain("--- b.py (REMOVED) ---");
  });

  it("emits +/- lines for a modified file with 1-indexed line numbers", () => {
    const prev = { "a.py": "line1\nline2\nline3\nline4\n" };
    const curr = [{ path: "a.py", content: "line1\nCHANGED\nline3\nline4\n" }];
    const out = computeDiffSinceLast(prev, curr)!;
    expect(out).toContain("--- a.py (MODIFIED) ---");
    expect(out).toMatch(/- 2: line2/);
    expect(out).toMatch(/\+ 2: CHANGED/);
  });

  it("includes surrounding context lines", () => {
    const prev = { "a.py": "a\nb\nc\nd\ne\nf\n" };
    const curr = [{ path: "a.py", content: "a\nb\nc\nX\ne\nf\n" }];
    const out = computeDiffSinceLast(prev, curr)!;
    expect(out).toMatch(/  2: b/);
    expect(out).toMatch(/  3: c/);
    expect(out).toMatch(/- 4: d/);
    expect(out).toMatch(/\+ 4: X/);
    expect(out).toMatch(/  5: e/);
  });
});
