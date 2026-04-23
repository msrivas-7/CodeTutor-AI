import { describe, it, expect } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { linkifyRefs } from "./linkifyRefs";

// linkifyRefs turns raw stderr/tutor prose into clickable file:line buttons.
// We test the structure of the returned nodes directly — no DOM, no
// jsdom — because the failure modes we care about (regex misses a valid
// reference, a wrong path binds to a click handler, clicks go to line 0) are
// all observable as props on the returned React elements.

interface Jumped {
  path: string;
  line: number;
  column?: number;
}

function collectButtons(node: ReactNode): {
  buttons: ReactElement[];
  jumps: Jumped[];
} {
  const buttons: ReactElement[] = [];
  const jumps: Jumped[] = [];
  const walk = (n: ReactNode) => {
    if (n === null || n === undefined || typeof n === "boolean") return;
    if (typeof n === "string" || typeof n === "number") return;
    if (Array.isArray(n)) {
      n.forEach(walk);
      return;
    }
    if (isValidElement(n)) {
      if (n.type === "button") buttons.push(n);
      const children = (n.props as { children?: ReactNode }).children;
      if (children !== undefined) walk(children);
    }
  };
  walk(node);

  for (const b of buttons) {
    const onClick = (b.props as { onClick: () => void }).onClick;
    const before = jumps.length;
    // Capture the (path, line, column) via a stub jump handler.
    const stub = (p: string, l: number, c?: number) => {
      jumps.push({ path: p, line: l, column: c });
    };
    // Each button closes over its own path/line/column; tripping onClick
    // surfaces them without needing the DOM.
    const savedOn = onClick;
    savedOn();
    // If the component was created via the real linkifyRefs, onClick already
    // has the captured values — so this push is the reference push, not the
    // stub one. Keep stub unused as a tripwire.
    void stub;
    void before;
  }
  return { buttons, jumps };
}

describe("linkifyRefs", () => {
  const paths = ["main.py", "stats.py", "main.go", "src/utils/helpers.ts"];

  it("returns the raw string when there are no matches", () => {
    const out = linkifyRefs("no refs here at all", paths, () => {});
    expect(out).toBe("no refs here at all");
  });

  it("returns the raw string when input is empty", () => {
    const out = linkifyRefs("", paths, () => {});
    expect(out).toBe("");
  });

  it("matches the Python `File \"x.py\", line N` pattern", () => {
    const jumps: Jumped[] = [];
    const node = linkifyRefs(
      'Traceback: File "stats.py", line 12',
      paths,
      (p, l, c) => jumps.push({ path: p, line: l, column: c }),
    );
    const { buttons } = collectButtons(node);
    expect(buttons).toHaveLength(1);
    expect(jumps).toEqual([{ path: "stats.py", line: 12, column: undefined }]);
  });

  it("matches generic `file.ext:line` with optional column", () => {
    const jumps: Jumped[] = [];
    const node = linkifyRefs(
      "main.go:12:3 and main.py:45",
      paths,
      (p, l, c) => jumps.push({ path: p, line: l, column: c }),
    );
    const { buttons } = collectButtons(node);
    expect(buttons).toHaveLength(2);
    expect(jumps).toEqual([
      { path: "main.go", line: 12, column: 3 },
      { path: "main.py", line: 45, column: undefined },
    ]);
  });

  it("resolves absolute / prefixed paths by basename when unambiguous", () => {
    // Container stack traces print `/workspace/main.go` — we should still jump
    // to the project's `main.go`.
    const jumps: Jumped[] = [];
    const node = linkifyRefs(
      "panic at /workspace/main.go:7",
      paths,
      (p, l) => jumps.push({ path: p, line: l }),
    );
    const { buttons } = collectButtons(node);
    expect(buttons).toHaveLength(1);
    expect(jumps[0]).toEqual({ path: "main.go", line: 7, column: undefined });
  });

  it("skips refs whose path can't be resolved", () => {
    // ghost.py is not in knownPaths — no button, original text preserved.
    const out = linkifyRefs("error at ghost.py:3", paths, () => {});
    const { buttons } = collectButtons(out);
    expect(buttons).toHaveLength(0);
  });

  it("does not linkify basenames that match multiple project files", () => {
    // Two project files share the basename `util.py` — an absolute path can't
    // be resolved unambiguously, so we leave it as plain text rather than
    // jumping to the wrong one.
    const ambiguous = ["src/a/util.py", "src/b/util.py"];
    const out = linkifyRefs(
      "see /workspace/src/util.py:1",
      ambiguous,
      () => {},
    );
    const { buttons } = collectButtons(out);
    expect(buttons).toHaveLength(0);
  });

  it("preserves surrounding text around a match", () => {
    const out = linkifyRefs(
      "before main.py:10 after",
      paths,
      () => {},
    );
    // Flatten to strings + button count; verify the before/after snippets
    // appear somewhere in the result.
    const serialize = (n: ReactNode): string => {
      if (n === null || n === undefined) return "";
      if (typeof n === "string") return n;
      if (Array.isArray(n)) return n.map(serialize).join("");
      if (isValidElement(n)) {
        const children = (n.props as { children?: ReactNode }).children;
        if (n.type === "button") return `[btn:${serialize(children ?? "")}]`;
        return serialize(children ?? "");
      }
      return "";
    };
    expect(serialize(out)).toBe("before [btn:main.py:10] after");
  });

  // Safety net for pathological outputs — the REF_REGEX has nested
  // quantifiers and scans the entire input, so a 1 MB single-line
  // payload from a malicious/runaway program can freeze the tab even
  // AFTER the backend's 1 MB stream cap. The bailout short-circuits
  // to raw text on oversized payloads so linkifyRefs never becomes the
  // bottleneck that hangs the UI. Thresholds here are kept above the
  // backend's per-line cap (8 KB) so normal traffic never trips them.
  describe("bailout on pathological input", () => {
    it("returns raw text when total payload exceeds the total-bytes bailout", () => {
      // Well-formed linkable reference embedded in a huge payload.
      // Normally this would be linkified; under the bailout it shouldn't.
      const filler = "A".repeat(250 * 1024); // > 200 KB threshold
      const input = `${filler}\nmain.py:10\n${filler}`;
      const out = linkifyRefs(input, paths, () => {});
      expect(out).toBe(input);
      const { buttons } = collectButtons(out);
      expect(buttons).toHaveLength(0);
    });

    it("returns raw text when any single line exceeds the per-line bailout", () => {
      // Total size is small, but one line is wildly out of spec for a
      // real stack trace. Don't risk the regex on it.
      const giantLine = "X".repeat(20 * 1024); // > 16 KB threshold
      const input = `ok\n${giantLine}\nmain.py:10`;
      const out = linkifyRefs(input, paths, () => {});
      expect(out).toBe(input);
      const { buttons } = collectButtons(out);
      expect(buttons).toHaveLength(0);
    });

    it("still linkifies when a long-but-within-threshold line is present", () => {
      // One line of ~10 KB — above the backend cap but below the
      // frontend bailout (16 KB). The frontend should proceed normally;
      // in practice the backend cap would have truncated it already,
      // but this test documents that the frontend bailout doesn't trip
      // for anything a well-behaved backend could emit.
      const tenK = "T".repeat(10 * 1024);
      const input = `${tenK}\nmain.py:10`;
      const jumps: Jumped[] = [];
      const out = linkifyRefs(input, paths, (p, l) =>
        jumps.push({ path: p, line: l }),
      );
      const { buttons } = collectButtons(out);
      expect(buttons).toHaveLength(1);
      expect(jumps).toEqual([{ path: "main.py", line: 10, column: undefined }]);
    });

    it("bails out fast on the 1 MB single-line repro (no catastrophic backtracking)", () => {
      // The exact post-stream-cap shape of
      // `sys.stderr.write("E" * (2 * 1024 * 1024))`: 1 MB of one
      // character, no newlines. Without the bailout, the regex
      // with nested `[\w.\\/-]*` quantifiers would stall. With it,
      // this should return in well under a second.
      const payload = "E".repeat(1024 * 1024);
      const start = performance.now();
      const out = linkifyRefs(payload, paths, () => {});
      const elapsed = performance.now() - start;
      expect(out).toBe(payload);
      // Generous envelope — the bailout check is O(n) byte scan.
      // A full regex pass would take seconds; this should take <100ms
      // even under test harness overhead.
      expect(elapsed).toBeLessThan(500);
    });
  });
});
