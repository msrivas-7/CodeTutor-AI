import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  harnessPython,
  pythonHarness,
  HARNESS_PY,
  HARNESS_JSON,
} from "./pythonHarness.js";
import { parseSignedEnvelope } from "./envelope.js";
import { TEST_SENTINEL, type FunctionTest } from "./types.js";

// ── Generated-source sanity checks ────────────────────────────────
describe("harnessPython (source)", () => {
  const src = harnessPython();

  it("embeds the v2 sentinel constant", () => {
    expect(src).toContain(TEST_SENTINEL);
  });

  it("reads tests into memory and then os.remove()s the file", () => {
    expect(src).toContain(`open(_tests_path, "r"`);
    expect(src).toContain("os.remove(_tests_path)");
  });

  it("reads the nonce from stdin (not env) and closes stdin", () => {
    // Phase 17: HARNESS_NONCE must not appear in env at all — /proc/<pid>/environ
    // leaks even after `del os.environ[...]`. Nonce arrives on stdin instead.
    expect(src).not.toContain("HARNESS_NONCE");
    expect(src).toContain("sys.stdin.read()");
    expect(src).toContain("sys.stdin.close()");
  });

  it("spawns child subprocesses with stdin=DEVNULL", () => {
    // Belt-and-suspenders — the parent's stdin is drained, but DEVNULL on the
    // child means even if it tried to read its own fd 0 it would get EOF.
    expect(src).toContain("stdin=subprocess.DEVNULL");
  });

  it("spawns the driver via subprocess.run with -c (not runpy in-process)", () => {
    expect(src).toContain('subprocess.run(');
    expect(src).toContain('"python3", "-c"');
  });

  it("does not pass the expected value to the driver subprocess", () => {
    // The payload handed to the child must only carry setup + call.
    expect(src).toMatch(/json\.dumps\(\{"setup"[^}]*"call"[^}]*\}\)/);
    expect(src).not.toMatch(/"expected":\s*test\[/);
  });

  it("HMAC-signs the body with the nonce and base64-wraps the envelope", () => {
    expect(src).toContain("hmac.new(_nonce.encode");
    expect(src).toContain("hashlib.sha256");
    expect(src).toContain("base64.b64encode");
  });

  it("emits sentinel + base64 + sentinel on stdout", () => {
    expect(src).toContain("SENTINEL + _encoded + SENTINEL");
  });
});

// ── HarnessBackend adapter ────────────────────────────────────────
describe("pythonHarness (HarnessBackend adapter)", () => {
  it("declares language = python", () => {
    expect(pythonHarness.language).toBe("python");
  });

  it("prepareFiles returns the harness script + serialized tests JSON", () => {
    const files = pythonHarness.prepareFiles([
      { name: "basic", call: "square(2)", expected: "4" },
    ]);
    expect(files).toHaveLength(2);
    const byName = new Map(files.map((f) => [f.name, f.content]));
    expect(byName.get(HARNESS_PY)).toContain(TEST_SENTINEL);
    expect(JSON.parse(byName.get(HARNESS_JSON)!)).toEqual([
      { name: "basic", call: "square(2)", expected: "4" },
    ]);
  });

  it("execCommand invokes the harness script under python3", () => {
    expect(pythonHarness.execCommand()).toBe(`python3 ${HARNESS_PY}`);
  });
});

// ── Integration: actually run the harness against sample main.py ──
// Spawns python3 against the generated harness in a tmp dir. Proves the
// harness survives the full round-trip: nonce-in-env → subprocess-per-test →
// signed base64 envelope → parseSignedEnvelope.
describe("pythonHarness integration (runs python3)", () => {
  const hasPython =
    spawnSync("python3", ["--version"], { encoding: "utf8" }).status === 0;

  function runHarnessWith(mainPy: string, tests: FunctionTest[]) {
    const nonce = crypto.randomBytes(32).toString("hex");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pyharness-"));
    fs.writeFileSync(path.join(tmp, "main.py"), mainPy, "utf8");
    fs.writeFileSync(path.join(tmp, HARNESS_PY), harnessPython(), "utf8");
    fs.writeFileSync(
      path.join(tmp, HARNESS_JSON),
      JSON.stringify(tests),
      "utf8",
    );
    const r = spawnSync("python3", [HARNESS_PY], {
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
    // The tests.json file should have been deleted by the harness on startup.
    const testsStillPresent = fs.existsSync(path.join(tmp, HARNESS_JSON));
    fs.rmSync(tmp, { recursive: true, force: true });
    return { report, tests_json_still_present: testsStillPresent };
  }

  it.skipIf(!hasPython)(
    "runs a basic function call and matches the expected literal",
    () => {
      const { report } = runHarnessWith(
        "def square(x):\n    return x * x\n",
        [{ name: "square-3", call: "square(3)", expected: "9" }],
      );
      expect(report.harnessError).toBeNull();
      expect(report.results).toHaveLength(1);
      expect(report.results[0].passed).toBe(true);
      expect(report.results[0].actualRepr).toBe("9");
    },
  );

  it.skipIf(!hasPython)("deletes the tests.json file before running user code", () => {
    const { tests_json_still_present } = runHarnessWith(
      "def f():\n    return 1\n",
      [{ name: "t", call: "f()", expected: "1" }],
    );
    expect(tests_json_still_present).toBe(false);
  });

  it.skipIf(!hasPython)(
    "captures per-test prints into stdoutDuring, not into cleanStdout",
    () => {
      const { report } = runHarnessWith(
        'def loud():\n    print("from inside")\n    return 42\n',
        [{ name: "side-effect", call: "loud()", expected: "42" }],
      );
      expect(report.harnessError).toBeNull();
      expect(report.results[0].passed).toBe(true);
      expect(report.results[0].stdoutDuring).toContain("from inside");
      expect(report.cleanStdout).not.toContain("from inside");
    },
  );

  it.skipIf(!hasPython)(
    "surfaces per-test errors (module-level prints don't mask them)",
    () => {
      const { report } = runHarnessWith(
        "def f():\n    return 1\n",
        [
          {
            name: "bad-call",
            call: "does_not_exist()",
            expected: "1",
          },
        ],
      );
      expect(report.results[0].passed).toBe(false);
      expect(report.results[0].error).toMatch(/NameError/);
    },
  );

  it.skipIf(!hasPython)(
    "surfaces harnessError when main.py has a syntax error",
    () => {
      const { report } = runHarnessWith(
        "def f(:\n    return 1\n",
        [{ name: "t", call: "f()", expected: "1" }],
      );
      expect(report.harnessError).toBeTruthy();
      expect(report.results).toEqual([]);
    },
  );

  it.skipIf(!hasPython)(
    "supports setup + hidden + category fields",
    () => {
      const main = [
        "_items = []",
        "def add(x):",
        "    _items.append(x)",
        "def count():",
        "    return len(_items)",
        "",
      ].join("\n");
      const { report } = runHarnessWith(main, [
        { name: "empty-starts", call: "count()", expected: "0" },
        {
          name: "after-adds",
          setup: "add(10); add(20); add(30)",
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

  it.skipIf(!hasPython)(
    "rejects a non-literal expected value with a per-test error",
    () => {
      const { report } = runHarnessWith(
        "def f():\n    return 1\n",
        [{ name: "bad-expected", call: "f()", expected: "object()" }],
      );
      expect(report.results[0].passed).toBe(false);
      expect(report.results[0].error).toMatch(/invalid expected/i);
    },
  );

  it.skipIf(!hasPython)(
    "HARNESS_NONCE never appears in env for user code (Phase 17)",
    () => {
      // Phase 17: nonce is on stdin, never env. Verify env is clean even in
      // user code running inside the per-test subprocess.
      const main = [
        "import os",
        "def leaked():",
        "    return os.environ.get('HARNESS_NONCE', 'absent')",
        "",
      ].join("\n");
      const { report } = runHarnessWith(main, [
        { name: "env-clean", call: "leaked()", expected: "'absent'" },
      ]);
      expect(report.results[0].passed).toBe(true);
    },
  );

  it.skipIf(!hasPython)(
    "user code cannot read the expected value by opening tests.json",
    () => {
      // If the file were still present, f() would return the expected string.
      const main = [
        "import os",
        "def leaked():",
        "    try:",
        "        with open('__codetutor_tests.json', 'r') as f:",
        "            return 'found'",
        "    except Exception:",
        "        return 'missing'",
        "",
      ].join("\n");
      const { report } = runHarnessWith(main, [
        { name: "hidden-file", call: "leaked()", expected: "'missing'" },
      ]);
      expect(report.results[0].passed).toBe(true);
    },
  );
});
