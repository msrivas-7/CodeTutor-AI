import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  harnessJavaScript,
  javascriptHarness,
  HARNESS_JS,
  HARNESS_JSON,
} from "./javascriptHarness.js";
import { parseSignedEnvelope } from "./envelope.js";
import { TEST_SENTINEL, type FunctionTest } from "./types.js";

// ── Generated-source sanity checks ────────────────────────────────
describe("harnessJavaScript (source)", () => {
  const src = harnessJavaScript();

  it("embeds the v2 sentinel constant", () => {
    expect(src).toContain(TEST_SENTINEL);
  });

  it("reads tests into memory and then fs.unlinkSync()s the file", () => {
    expect(src).toContain(`fs.readFileSync(TESTS_PATH`);
    expect(src).toContain("fs.unlinkSync(TESTS_PATH)");
  });

  it("reads the nonce from stdin (not env)", () => {
    // Phase 17: HARNESS_NONCE must not appear in env at all — /proc/<pid>/environ
    // leaks even after `delete process.env.X`. Nonce arrives on stdin instead.
    // (We don't fs.closeSync(0); libuv asserts on closing fd 0. Draining via
    // fs.readFileSync(0) to EOF is the property that matters — the pipe is
    // empty after that, and children get stdio:['ignore'] so they can't read
    // the parent's fd 0 either.)
    expect(src).not.toContain("HARNESS_NONCE");
    expect(src).toContain('fs.readFileSync(0, "utf8")');
  });

  it("spawns child subprocesses with stdio: ignore for stdin", () => {
    // Belt-and-suspenders: parent's stdin is drained, but 'ignore' on the
    // child means even if it tried to read fd 0 it would get EOF.
    expect(src).toMatch(/stdio:\s*\[\s*["']ignore["']/);
  });

  it("does not expose require/process/Buffer to the user's vm ctx", () => {
    // M-A4: vm.createContext is a module loader, not a security boundary.
    // The DRIVER builds a ctx without require/process/Buffer so a learner's
    // main.js referencing those fails with ReferenceError.
    expect(src).not.toMatch(/require:\s*require/);
    expect(src).not.toMatch(/process:\s*process/);
    expect(src).not.toMatch(/Buffer:\s*Buffer/);
  });

  it("spawns the driver via spawnSync with -e (not vm.runInContext in-process)", () => {
    expect(src).toContain("spawnSync(");
    expect(src).toContain('"-e", DRIVER');
  });

  it("does not pass the expected value to the driver subprocess", () => {
    expect(src).toMatch(/setup:\s*test\.setup[^,]*,\s*call:\s*test\.call/);
    expect(src).not.toMatch(/expected:\s*test\.expected/);
  });

  it("HMAC-signs the body with the nonce and base64-wraps the envelope", () => {
    expect(src).toContain('crypto.createHmac("sha256", NONCE)');
    expect(src).toContain('Buffer.from(inner, "utf8").toString("base64")');
  });

  it("emits sentinel + base64 + sentinel on stdout", () => {
    expect(src).toContain("SENTINEL + encoded + SENTINEL");
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
    expect(JSON.parse(byName.get(HARNESS_JSON)!)).toEqual([
      { name: "basic", call: "square(2)", expected: "4" },
    ]);
  });

  it("execCommand invokes the harness script under node", () => {
    expect(javascriptHarness.execCommand()).toBe(`node ${HARNESS_JS}`);
  });
});

// ── Integration: actually run the harness against sample main.js ──
describe("javascriptHarness integration (runs node)", () => {
  const hasNode =
    spawnSync("node", ["--version"], { encoding: "utf8" }).status === 0;

  function runHarnessWith(mainJs: string, tests: FunctionTest[]) {
    const nonce = crypto.randomBytes(32).toString("hex");
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
      timeout: 20_000,
      input: `${nonce}\n`,
      env: {
        ...process.env,
        HARNESS_PER_TEST_TIMEOUT_MS: "5000",
      },
    });
    const report = parseSignedEnvelope(r.stdout ?? "", r.stderr ?? "", nonce);
    const testsStillPresent = fs.existsSync(path.join(tmp, HARNESS_JSON));
    fs.rmSync(tmp, { recursive: true, force: true });
    return { report, tests_json_still_present: testsStillPresent };
  }

  it.skipIf(!hasNode)(
    "runs a basic function call and matches the expected JSON literal",
    () => {
      const { report } = runHarnessWith(
        "function square(x) { return x * x; }",
        [{ name: "square-3", call: "square(3)", expected: "9" }],
      );
      expect(report.harnessError).toBeNull();
      expect(report.results).toHaveLength(1);
      expect(report.results[0].passed).toBe(true);
      expect(report.results[0].actualRepr).toBe("9");
    },
  );

  it.skipIf(!hasNode)("deletes the tests.json file before running user code", () => {
    const { tests_json_still_present } = runHarnessWith(
      "function f() { return 1; }",
      [{ name: "t", call: "f()", expected: "1" }],
    );
    expect(tests_json_still_present).toBe(false);
  });

  it.skipIf(!hasNode)(
    "captures per-test console.log into stdoutDuring without polluting cleanStdout",
    () => {
      const { report } = runHarnessWith(
        `function loud() { console.log("from inside"); return 42; }`,
        [{ name: "side-effect", call: "loud()", expected: "42" }],
      );
      expect(report.harnessError).toBeNull();
      expect(report.results[0].passed).toBe(true);
      expect(report.results[0].stdoutDuring).toContain("from inside");
      expect(report.cleanStdout).not.toContain("from inside");
    },
  );

  it.skipIf(!hasNode)(
    "module-level side effects don't leak into per-test stdoutDuring",
    () => {
      // Module-level console.log happens during probe + once per driver spawn
      // (the module body re-runs each time). It shows up in cleanStdout
      // (from the probe) but not in any test's stdoutDuring, because the
      // driver strips markers and captures per-test prints into its own
      // buffer — not the module-load prints.
      const main = `
console.log("at module load");
function greet(name) { return "hi, " + name; }
`;
      const { report } = runHarnessWith(main, [
        { name: "greet", call: 'greet("x")', expected: '"hi, x"' },
      ]);
      expect(report.results[0].passed).toBe(true);
      expect(report.cleanStdout).toContain("at module load");
    },
  );

  it.skipIf(!hasNode)(
    "surfaces per-test errors with name + message",
    () => {
      const { report } = runHarnessWith(
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
      const { report } = runHarnessWith(
        "function f( { return 1 }",
        [{ name: "t", call: "f()", expected: "1" }],
      );
      expect(report.harnessError).toBeTruthy();
      expect(report.results).toEqual([]);
    },
  );

  it.skipIf(!hasNode)(
    "supports setup + hidden + category fields",
    () => {
      const main = `
let items = [];
function add(x) { items.push(x); }
function count() { return items.length; }
`;
      const { report } = runHarnessWith(main, [
        { name: "empty-starts", call: "count()", expected: "0" },
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
      expect(report.results[0].passed).toBe(true);
      expect(report.results[1].passed).toBe(true);
      expect(report.results[1].hidden).toBe(true);
      expect(report.results[1].category).toBe("mutation");
    },
  );

  it.skipIf(!hasNode)(
    "rejects a non-JSON-literal expected value with a per-test error",
    () => {
      const { report } = runHarnessWith(
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
      const { report } = runHarnessWith(main, [
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

  it.skipIf(!hasNode)(
    "user code cannot reach process.env at all (ctx minimization, Phase 17)",
    () => {
      // Phase 17 / M-A4: the vm ctx no longer exposes `process`, `require`, or
      // `Buffer`. Learner code that reaches for them gets a ReferenceError —
      // which is fine, because:
      //   (a) those APIs were only ever namespace-convenient, not sandboxed;
      //   (b) the nonce now lives on stdin, not env, so even if `process` were
      //       exposed, `process.env.HARNESS_NONCE` would be empty.
      const main = `
function leaked() {
  try { return process.env.HARNESS_NONCE || "absent"; }
  catch (e) { return "no-process"; }
}
`;
      const { report } = runHarnessWith(main, [
        { name: "env-gone", call: "leaked()", expected: '"no-process"' },
      ]);
      expect(report.results[0].passed).toBe(true);
    },
  );

  it.skipIf(!hasNode)(
    "user code cannot read the expected value by opening tests.json",
    () => {
      const main = `
function leaked() {
  try {
    require("fs").readFileSync("__codetutor_tests.json", "utf8");
    return "found";
  } catch (e) {
    return "missing";
  }
}
`;
      const { report } = runHarnessWith(main, [
        { name: "hidden-file", call: "leaked()", expected: '"missing"' },
      ]);
      expect(report.results[0].passed).toBe(true);
    },
  );
});
