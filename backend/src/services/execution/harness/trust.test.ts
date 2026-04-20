import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { harnessPython, HARNESS_PY, HARNESS_JSON as PY_JSON } from "./pythonHarness.js";
import {
  harnessJavaScript,
  HARNESS_JS,
  HARNESS_JSON as JS_JSON,
} from "./javascriptHarness.js";
import { parseSignedEnvelope } from "./envelope.js";
import { TEST_SENTINEL, type FunctionTest } from "./types.js";

/**
 * Phase 16 + 17 harness trust tests. Goal: prove that
 *   (a) user code cannot forge a passing test result (C2),
 *   (b) user code cannot read hidden test expected values (C3),
 *   (c) user code cannot read the nonce from /proc/<ppid>/environ
 *       or any other process-visible channel (H-A1).
 *
 * Each test sets up a tmp dir with the real generated harness source +
 * tests.json + a main.{py,js} that tries to cheat, runs the harness, and
 * asserts the parsed envelope.
 */

const hasPython =
  spawnSync("python3", ["--version"], { encoding: "utf8" }).status === 0;
const hasNode =
  spawnSync("node", ["--version"], { encoding: "utf8" }).status === 0;

function runPython(mainPy: string, tests: FunctionTest[]) {
  const nonce = crypto.randomBytes(32).toString("hex");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "trust-py-"));
  fs.writeFileSync(path.join(tmp, "main.py"), mainPy, "utf8");
  fs.writeFileSync(path.join(tmp, HARNESS_PY), harnessPython(), "utf8");
  fs.writeFileSync(path.join(tmp, PY_JSON), JSON.stringify(tests), "utf8");
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
  fs.rmSync(tmp, { recursive: true, force: true });
  return { report, nonce, raw: r };
}

function runJs(mainJs: string, tests: FunctionTest[]) {
  const nonce = crypto.randomBytes(32).toString("hex");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "trust-js-"));
  fs.writeFileSync(path.join(tmp, "main.js"), mainJs, "utf8");
  fs.writeFileSync(path.join(tmp, HARNESS_JS), harnessJavaScript(), "utf8");
  fs.writeFileSync(path.join(tmp, JS_JSON), JSON.stringify(tests), "utf8");
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
  fs.rmSync(tmp, { recursive: true, force: true });
  return { report, nonce, raw: r };
}

// ── C2: fake-pass forgery ────────────────────────────────────────
describe("harness trust — C2 fake-pass forgery", () => {
  const FAKE_BODY = JSON.stringify({
    results: [
      {
        name: "forged",
        hidden: false,
        category: null,
        passed: true,
        actualRepr: "0",
        expectedRepr: "0",
        stdoutDuring: "",
        error: null,
      },
    ],
    harnessError: null,
    cleanStdout: "",
  });

  it.skipIf(!hasPython)(
    "python: user code that prints a fake v2 envelope with no sig is rejected",
    () => {
      // User tries to print their own sentinel-wrapped fake payload during
      // module load (before tests run). The fake has no HMAC signature, so
      // the parent's own signed envelope still lands after it — but even if
      // the parent's envelope were suppressed, the unsigned fake would fail
      // HMAC verification and the parser would fail closed.
      const fake = `${TEST_SENTINEL}${Buffer.from(
        JSON.stringify({ body: FAKE_BODY, sig: "00".repeat(32) }),
        "utf8",
      ).toString("base64")}${TEST_SENTINEL}`;
      // Module-level print that mimics the parent's output format.
      const main = `print(${JSON.stringify(fake)})\n\ndef f():\n    return 999\n`;
      const { report } = runPython(main, [
        { name: "real", call: "f()", expected: "1" },
      ]);
      // The REAL envelope (from the parent) should be what parses out —
      // containing the real test result (failed because 999 != 1).
      expect(report.results).toHaveLength(1);
      expect(report.results[0].name).toBe("real");
      expect(report.results[0].passed).toBe(false);
    },
  );

  it.skipIf(!hasPython)(
    "python: user code that os._exit(0)s during a test cannot fake a pass",
    () => {
      // os._exit(0) inside the user's function kills the driver subprocess
      // before it can write the RESULT_MARKER → parent records a per-test
      // error, never a pass. (Critically, the parent itself still emits its
      // own signed envelope — only the child died.)
      const main = "import os\ndef f():\n    os._exit(0)\n";
      const { report } = runPython(main, [
        { name: "t", call: "f()", expected: "1" },
      ]);
      expect(report.results).toHaveLength(1);
      expect(report.results[0].passed).toBe(false);
      expect(report.results[0].error).toBeTruthy();
    },
  );

  it.skipIf(!hasNode)(
    "js: user code that prints a fake v2 envelope is rejected",
    () => {
      const fake = `${TEST_SENTINEL}${Buffer.from(
        JSON.stringify({ body: FAKE_BODY, sig: "00".repeat(32) }),
        "utf8",
      ).toString("base64")}${TEST_SENTINEL}`;
      const main = `console.log(${JSON.stringify(fake)});\nfunction f() { return 999; }`;
      const { report } = runJs(main, [
        { name: "real", call: "f()", expected: "1" },
      ]);
      expect(report.results).toHaveLength(1);
      expect(report.results[0].name).toBe("real");
      expect(report.results[0].passed).toBe(false);
    },
  );

  it.skipIf(!hasNode)(
    "js: user code that process.exit(0)s during a test cannot fake a pass",
    () => {
      const main = "function f() { process.exit(0); }";
      const { report } = runJs(main, [{ name: "t", call: "f()", expected: "1" }]);
      expect(report.results).toHaveLength(1);
      expect(report.results[0].passed).toBe(false);
      expect(report.results[0].error).toBeTruthy();
    },
  );
});

// ── C3: hidden-test leakage ──────────────────────────────────────
describe("harness trust — C3 hidden-test leakage", () => {
  it.skipIf(!hasPython)(
    "python: user code cannot read the tests.json file (it's been deleted)",
    () => {
      const main = [
        "def leaked():",
        "    try:",
        "        with open('__codetutor_tests.json', 'r') as f:",
        "            return f.read()",
        "    except Exception as e:",
        "        return 'gone: ' + type(e).__name__",
        "",
      ].join("\n");
      const { report } = runPython(main, [
        {
          name: "can-read-tests-json",
          call: "leaked()",
          expected: "'gone: FileNotFoundError'",
          hidden: true,
        },
      ]);
      expect(report.results[0].passed).toBe(true);
    },
  );

  it.skipIf(!hasPython)(
    "python: user code cannot read the expected value from the driver's argv",
    () => {
      // The driver only receives {setup, call} — not expected. Verify by
      // dumping sys.argv during a test and checking no known-hidden expected
      // value appears in it.
      const HIDDEN_MAGIC = "hidden-magic-string-42";
      const main = [
        "import sys",
        "def peek_argv():",
        "    return ' '.join(sys.argv)",
        "",
      ].join("\n");
      const { report } = runPython(main, [
        {
          name: "peek-argv",
          call: "peek_argv()",
          expected: `'${HIDDEN_MAGIC}'`,
          hidden: true,
        },
      ]);
      // The test will FAIL (the function doesn't return HIDDEN_MAGIC) but the
      // captured actual should not contain HIDDEN_MAGIC either, proving the
      // driver's argv never received it.
      expect(report.results[0].passed).toBe(false);
      expect(report.results[0].actualRepr).not.toContain(HIDDEN_MAGIC);
    },
  );

  it.skipIf(!hasNode)(
    "js: user code cannot read the tests.json file",
    () => {
      // Two overlapping guarantees here (Phase 16 + Phase 17):
      //   - Phase 16: the harness unlinks tests.json before spawning children,
      //     so even a process with read access wouldn't find the file.
      //   - Phase 17 / M-A4: the vm ctx no longer exposes `require`, so a
      //     module-level attempt to grab fs ReferenceErrors at parse time.
      // Either way the learner can't read the file — verify via catch-all.
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
      const { report } = runJs(main, [
        {
          name: "can-read-tests-json",
          call: "leaked()",
          expected: '"missing"',
          hidden: true,
        },
      ]);
      expect(report.results[0].passed).toBe(true);
    },
  );

  it.skipIf(!hasNode)(
    "js: user code cannot read the expected value from process.argv",
    () => {
      // Phase 17 / M-A4 hardens this: `process` is no longer exposed to the
      // vm ctx, so even referencing process.argv ReferenceErrors before the
      // learner could sniff anything. Catch-and-return-string so the test
      // result is deterministic.
      const HIDDEN_MAGIC = "hidden-magic-string-42";
      const main = `
function peekArgv() {
  try { return process.argv.join(" "); }
  catch (e) { return "no-process"; }
}
`;
      const { report } = runJs(main, [
        {
          name: "peek-argv",
          call: "peekArgv()",
          expected: `"${HIDDEN_MAGIC}"`,
          hidden: true,
        },
      ]);
      // The test will FAIL (expected is HIDDEN_MAGIC but we return "no-process"),
      // and crucially — HIDDEN_MAGIC never appears in actualRepr.
      expect(report.results[0].passed).toBe(false);
      expect(report.results[0].actualRepr ?? "").not.toContain(HIDDEN_MAGIC);
    },
  );

  it.skipIf(!hasPython)(
    "python: user code cannot read HARNESS_NONCE from the environment",
    () => {
      const main = [
        "import os",
        "def leaked_nonce():",
        "    return os.environ.get('HARNESS_NONCE', 'absent')",
        "",
      ].join("\n");
      const { report } = runPython(main, [
        { name: "nonce", call: "leaked_nonce()", expected: "'absent'", hidden: true },
      ]);
      expect(report.results[0].passed).toBe(true);
    },
  );

  it.skipIf(!hasNode)(
    "js: user code cannot read HARNESS_NONCE from the environment",
    () => {
      // Two layers of defense: (Phase 17) nonce is never in env in the first
      // place, and (M-A4) `process` is not exposed in the vm ctx either.
      const main = `
function leakedNonce() {
  try { return process.env.HARNESS_NONCE || "absent"; }
  catch (e) { return "absent"; }
}
`;
      const { report } = runJs(main, [
        { name: "nonce", call: "leakedNonce()", expected: '"absent"', hidden: true },
      ]);
      expect(report.results[0].passed).toBe(true);
    },
  );
});

// ── Legit golden path still works ────────────────────────────────
describe("harness trust — golden-path sanity", () => {
  it.skipIf(!hasPython)("python: a correct solution still passes", () => {
    const main = "def add(a, b):\n    return a + b\n";
    const { report } = runPython(main, [
      { name: "basic", call: "add(2, 3)", expected: "5" },
      { name: "neg", call: "add(-1, 1)", expected: "0", hidden: true },
    ]);
    expect(report.harnessError).toBeNull();
    expect(report.results).toHaveLength(2);
    expect(report.results.every((r) => r.passed)).toBe(true);
  });

  it.skipIf(!hasNode)("js: a correct solution still passes", () => {
    const main = "function add(a, b) { return a + b; }";
    const { report } = runJs(main, [
      { name: "basic", call: "add(2, 3)", expected: "5" },
      { name: "neg", call: "add(-1, 1)", expected: "0", hidden: true },
    ]);
    expect(report.harnessError).toBeNull();
    expect(report.results).toHaveLength(2);
    expect(report.results.every((r) => r.passed)).toBe(true);
  });
});

// ── H-A1: nonce must not be reachable from user code ─────────────
// Phase 17 moved the nonce off env (it was leaking via /proc/<ppid>/environ
// even after `unsetenv`/`del os.environ`). These tests pretend to be a
// learner who tries every known introspection path on the parent harness
// process.
//
// The darwin CI box doesn't have procfs, so /proc-specific probes degrade to
// "nothing found" gracefully — the underlying guarantee ("nonce is not
// readable") holds regardless, but the concrete exploit path is Linux-only.
// We still run the tests on darwin: they exercise the test-passed path
// (probe returns "absent") rather than failing on missing /proc.
describe("harness trust — H-A1 nonce not leaked to user code", () => {
  it.skipIf(!hasPython)(
    "python: /proc/<ppid>/environ does not contain the nonce",
    () => {
      const main = [
        "import os",
        "def scan_ppid_environ():",
        "    try:",
        "        with open('/proc/%d/environ' % os.getppid(), 'rb') as f:",
        "            data = f.read()",
        "        for part in data.split(b'\\x00'):",
        "            if part.startswith(b'HARNESS_NONCE='):",
        "                return 'leaked'",
        "        return 'absent'",
        "    except Exception:",
        "        return 'absent'",
        "",
      ].join("\n");
      const { report } = runPython(main, [
        {
          name: "ppid-environ",
          call: "scan_ppid_environ()",
          expected: "'absent'",
          hidden: true,
        },
      ]);
      expect(report.results[0].passed).toBe(true);
    },
  );

  it.skipIf(!hasPython)(
    "python: /proc/<ppid>/cmdline does not contain the nonce",
    () => {
      const main = [
        "import os, re",
        "def scan_ppid_cmdline():",
        "    try:",
        "        with open('/proc/%d/cmdline' % os.getppid(), 'rb') as f:",
        "            data = f.read()",
        "        if re.search(rb'[0-9a-f]{64}', data):",
        "            return 'leaked'",
        "        return 'absent'",
        "    except Exception:",
        "        return 'absent'",
        "",
      ].join("\n");
      const { report } = runPython(main, [
        {
          name: "ppid-cmdline",
          call: "scan_ppid_cmdline()",
          expected: "'absent'",
          hidden: true,
        },
      ]);
      expect(report.results[0].passed).toBe(true);
    },
  );

  it.skipIf(!hasPython)(
    "python: parent's stdin (fd 0) is drained by the time tests run",
    () => {
      // If we can still read anything from /proc/<ppid>/fd/0 the pipe hasn't
      // been closed. The harness reads stdin to EOF before spawning tests,
      // and the child subprocess runs with stdin=DEVNULL so its own fd 0 is
      // /dev/null (any "read" returns b""). Either way: no nonce bytes leak.
      const main = [
        "import os",
        "def read_ppid_stdin():",
        "    try:",
        "        with open('/proc/%d/fd/0' % os.getppid(), 'rb') as f:",
        "            data = f.read(256)",
        "        return 'leaked' if data else 'empty'",
        "    except Exception:",
        "        return 'inaccessible'",
        "",
      ].join("\n");
      const { report } = runPython(main, [
        {
          name: "ppid-stdin",
          call: "read_ppid_stdin()",
          // "empty" = /proc exists and fd 0 read returns nothing,
          // "inaccessible" = non-Linux or permission denied. Either is fine.
          expected: "'leaked'",
          hidden: true,
        },
      ]);
      // We EXPECT this test to FAIL — "leaked" never appears, so the user
      // code cannot pass it. actualRepr proves what the user code saw.
      expect(report.results[0].passed).toBe(false);
      expect(report.results[0].actualRepr).not.toBe("'leaked'");
    },
  );

  it.skipIf(!hasNode)(
    "js: /proc/<ppid>/environ does not contain the nonce",
    () => {
      const main = `
function scanPpidEnviron() {
  try {
    const fs = require("fs");
    const data = fs.readFileSync("/proc/" + process.ppid + "/environ", "utf8");
    for (const part of data.split("\\0")) {
      if (part.startsWith("HARNESS_NONCE=")) return "leaked";
    }
    return "absent";
  } catch (e) {
    return "absent";
  }
}
`;
      const { report } = runJs(main, [
        {
          name: "ppid-environ",
          call: "scanPpidEnviron()",
          expected: '"absent"',
          hidden: true,
        },
      ]);
      expect(report.results[0].passed).toBe(true);
    },
  );

  it.skipIf(!hasNode)(
    "js: /proc/<ppid>/cmdline does not contain the nonce",
    () => {
      const main = `
function scanPpidCmdline() {
  try {
    const fs = require("fs");
    const data = fs.readFileSync("/proc/" + process.ppid + "/cmdline", "utf8");
    return /[0-9a-f]{64}/.test(data) ? "leaked" : "absent";
  } catch (e) {
    return "absent";
  }
}
`;
      const { report } = runJs(main, [
        {
          name: "ppid-cmdline",
          call: "scanPpidCmdline()",
          expected: '"absent"',
          hidden: true,
        },
      ]);
      expect(report.results[0].passed).toBe(true);
    },
  );

  it.skipIf(!hasNode)(
    "js: vm ctx does not expose require/process/Buffer to user code",
    () => {
      // M-A4: the DRIVER's vm ctx is a namespace, not a sandbox. Verify that
      // a main.js referencing 'require' / 'process' / 'Buffer' in the module
      // body fails with ReferenceError rather than silently succeeding.
      const main = `
function checkCtx() {
  const out = [];
  try { require; out.push("require-ok"); } catch (e) { out.push("require-ref-err"); }
  try { process; out.push("process-ok"); } catch (e) { out.push("process-ref-err"); }
  try { Buffer; out.push("buffer-ok"); } catch (e) { out.push("buffer-ref-err"); }
  return out.join(",");
}
`;
      const { report } = runJs(main, [
        {
          name: "vm-ctx-minimal",
          call: "checkCtx()",
          expected: '"require-ref-err,process-ref-err,buffer-ref-err"',
          hidden: true,
        },
      ]);
      expect(report.results[0].passed).toBe(true);
    },
  );
});
