import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  harnessJavaScript,
  parseHarnessOutput,
  javascriptHarness,
  HARNESS_JS,
  HARNESS_JSON,
} from "./javascriptHarness.js";
import { TEST_SENTINEL, type FunctionTest } from "./types.js";

// ── Generated-source sanity checks ────────────────────────────────
describe("harnessJavaScript", () => {
  const src = harnessJavaScript();

  it("embeds the shared sentinel constant", () => {
    expect(src).toContain(TEST_SENTINEL);
  });

  it("reads tests from the sibling JSON file (never inlines them)", () => {
    expect(src).toContain(`JSON.parse(fs.readFileSync("${HARNESS_JSON}"`);
  });

  it("loads main.js source and runs it inside a vm context per test", () => {
    expect(src).toContain(`fs.readFileSync("main.js"`);
    expect(src).toContain("vm.createContext");
    expect(src).toContain("vm.runInContext(MAIN_SRC");
  });

  it("parses expected values with JSON.parse (not eval) for safety", () => {
    expect(src).toMatch(/JSON\.parse\(t\.expected\)/);
    expect(src).not.toMatch(/(?<!JSON\.)eval\(t\.expected\)/);
  });

  it("redirects console to a per-test buffer so prints don't pollute sentinel output", () => {
    expect(src).toMatch(/console:\s*bufConsole/);
  });

  it("exposes module/require such that `require.main === module` is false during tests", () => {
    expect(src).toContain("module: sandboxModule");
    expect(src).toContain("require");
  });

  it("wraps payload between two sentinels on stdout", () => {
    expect(src).toContain("SENTINEL + payload + SENTINEL");
  });

  it("catches harness-level errors (main.js probe) into harnessError", () => {
    expect(src).toContain("harnessError = e instanceof Error");
  });
});

// ── parseHarnessOutput ────────────────────────────────────────────
// Same envelope format as pythonHarness, so parser behavior mirrors.
describe("parseHarnessOutput", () => {
  const wrap = (json: string) => `${TEST_SENTINEL}${json}${TEST_SENTINEL}\n`;

  it("extracts results + harnessError when sentinels are present", () => {
    const payload = JSON.stringify({
      results: [
        {
          name: "t1",
          hidden: false,
          category: null,
          passed: true,
          actualRepr: "4",
          expectedRepr: "4",
          stdoutDuring: "",
          error: null,
        },
      ],
      harnessError: null,
    });
    const r = parseHarnessOutput(wrap(payload), "");
    expect(r.harnessError).toBeNull();
    expect(r.results).toHaveLength(1);
    expect(r.results[0].passed).toBe(true);
  });

  it("returns harnessError fallback when sentinel is missing", () => {
    const r = parseHarnessOutput("", "SyntaxError: Unexpected token");
    expect(r.harnessError).toContain("SyntaxError");
  });

  it("returns harnessError when payload isn't valid JSON", () => {
    const r = parseHarnessOutput(wrap("not-json{"), "");
    expect(r.harnessError).toMatch(/malformed/i);
  });

  it("preserves learner's pre-sentinel prints as cleanStdout", () => {
    const payload = JSON.stringify({ results: [], harnessError: null });
    const r = parseHarnessOutput(`learner wrote this\n${wrap(payload)}`, "");
    expect(r.cleanStdout).toBe("learner wrote this");
  });
});

// ── HarnessBackend adapter ────────────────────────────────────────
describe("javascriptHarness (HarnessBackend adapter)", () => {
  it("declares language = javascript", () => {
    expect(javascriptHarness.language).toBe("javascript");
  });

  it("prepareFiles returns the harness script + serialized tests JSON", () => {
    const files = javascriptHarness.prepareFiles([
      { name: "basic", call: "square(2)", expected: "4" },
    ]);
    expect(files).toHaveLength(2);
    const byName = new Map(files.map((f) => [f.name, f.content]));
    expect(byName.get(HARNESS_JS)).toContain(TEST_SENTINEL);
    const json = byName.get(HARNESS_JSON);
    expect(JSON.parse(json!)).toEqual([
      { name: "basic", call: "square(2)", expected: "4" },
    ]);
  });

  it("execCommand invokes the harness script under node", () => {
    expect(javascriptHarness.execCommand()).toBe(`node ${HARNESS_JS}`);
  });
});

// ── Integration: actually run the harness against sample main.js ──
// Spawns `node` against the generated harness in a tmp dir. Proves the
// harness survives round-trip: generated source → Node runtime → sentinel
// payload → parseHarnessOutput. Skips if node isn't on PATH.
describe("javascriptHarness integration (runs node)", () => {
  const hasNode =
    spawnSync("node", ["--version"], { encoding: "utf8" }).status === 0;

  function runHarnessWith(mainJs: string, tests: FunctionTest[]) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jsharness-"));
    fs.writeFileSync(path.join(tmp, "main.js"), mainJs, "utf8");
    fs.writeFileSync(path.join(tmp, HARNESS_JS), harnessJavaScript(), "utf8");
    fs.writeFileSync(
      path.join(tmp, HARNESS_JSON),
      JSON.stringify(tests),
      "utf8",
    );
    const r = spawnSync("node", [HARNESS_JS], {
      cwd: tmp,
      encoding: "utf8",
      timeout: 15_000,
    });
    fs.rmSync(tmp, { recursive: true, force: true });
    return parseHarnessOutput(r.stdout ?? "", r.stderr ?? "");
  }

  it.skipIf(!hasNode)(
    "runs a basic function call and matches the expected JSON literal",
    () => {
      const report = runHarnessWith(
        "function square(x) { return x * x; }",
        [{ name: "square-3", call: "square(3)", expected: "9" }],
      );
      expect(report.harnessError).toBeNull();
      expect(report.results).toHaveLength(1);
      expect(report.results[0].passed).toBe(true);
      expect(report.results[0].actualRepr).toBe("9");
    },
  );

  it.skipIf(!hasNode)(
    "captures per-test console.log into stdoutDuring without polluting sentinel output",
    () => {
      const report = runHarnessWith(
        `function loud() { console.log("from inside"); return 42; }`,
        [{ name: "side-effect", call: "loud()", expected: "42" }],
      );
      expect(report.harnessError).toBeNull();
      expect(report.results[0].passed).toBe(true);
      expect(report.results[0].stdoutDuring).toContain("from inside");
      // And the clean (post-extract) stdout shouldn't contain the sentinel
      expect(report.cleanStdout).not.toContain("from inside");
    },
  );

  it.skipIf(!hasNode)(
    "skips top-level `if (require.main === module)` branches during tests",
    () => {
      // The guard must short-circuit — otherwise this console.log would
      // bleed into every test's stdoutDuring.
      const main = `
function greet(name) { return "hi, " + name; }
if (require.main === module) {
  console.log("at module load");
}
`;
      const report = runHarnessWith(main, [
        { name: "greet", call: 'greet("x")', expected: '"hi, x"' },
      ]);
      expect(report.results[0].passed).toBe(true);
      expect(report.results[0].stdoutDuring).toBe("");
    },
  );

  it.skipIf(!hasNode)(
    "surfaces per-test errors with name + message",
    () => {
      const report = runHarnessWith(
        "function f() { return 1; }",
        [
          {
            name: "bad-call",
            call: "doesNotExist()",
            expected: "1",
          },
        ],
      );
      expect(report.results[0].passed).toBe(false);
      expect(report.results[0].error).toContain("ReferenceError");
      expect(report.results[0].actualRepr).toBeNull();
    },
  );

  it.skipIf(!hasNode)(
    "surfaces harnessError when main.js has a syntax error",
    () => {
      const report = runHarnessWith(
        "function f( { return 1 }", // intentionally broken
        [{ name: "t", call: "f()", expected: "1" }],
      );
      expect(report.harnessError).toBeTruthy();
      expect(report.harnessError).toMatch(/SyntaxError/);
      expect(report.results).toEqual([]);
    },
  );

  it.skipIf(!hasNode)(
    "supports setup + hidden + category fields (capstone-style tests)",
    () => {
      const main = `
let items = [];
function add(x) { items.push(x); }
function count() { return items.length; }
`;
      const report = runHarnessWith(main, [
        {
          name: "empty-starts",
          call: "count()",
          expected: "0",
        },
        {
          name: "after-adds",
          setup: "add(10); add(20); add(30);",
          call: "count()",
          expected: "3",
          hidden: true,
          category: "mutation",
        },
      ]);
      expect(report.results).toHaveLength(2);
      // Fresh context per test: first test's items list is empty at start
      // even though second test's setup adds to it (hence pass on both).
      expect(report.results[0].passed).toBe(true);
      expect(report.results[1].passed).toBe(true);
      expect(report.results[1].hidden).toBe(true);
      expect(report.results[1].category).toBe("mutation");
    },
  );

  it.skipIf(!hasNode)(
    "rejects a non-JSON-literal expected value with a per-test error",
    () => {
      const report = runHarnessWith(
        "function f() { return 1; }",
        [{ name: "bad-expected", call: "f()", expected: "{ x: 1 }" }],
      );
      expect(report.results[0].passed).toBe(false);
      expect(report.results[0].error).toMatch(/invalid expected/i);
    },
  );

  it.skipIf(!hasNode)(
    "deep-equals arrays and plain objects",
    () => {
      const main = `
function makeList() { return [1, 2, 3]; }
function makeObj() { return { a: 1, b: [2, 3] }; }
`;
      const report = runHarnessWith(main, [
        { name: "list", call: "makeList()", expected: "[1, 2, 3]" },
        {
          name: "obj",
          call: "makeObj()",
          expected: '{"a": 1, "b": [2, 3]}',
        },
      ]);
      expect(report.results[0].passed).toBe(true);
      expect(report.results[1].passed).toBe(true);
    },
  );
});
