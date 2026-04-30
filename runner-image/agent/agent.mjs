#!/usr/bin/env node
// Phase 24B: in-runner HTTP agent for the ACI hybrid burst overflow.
//
// ACI containers can't be reached via `docker exec` / `docker cp` from
// outside Azure (those APIs only work against the local docker daemon),
// so the backend talks to this agent over HTTP instead. Same operations
// as LocalDocker (exec, writeFiles, fileExists, removeFiles, snapshot),
// different transport.
//
// The agent ships with the runner image, but only starts when
// ENABLE_AGENT=1 is set on the container's env. LocalDocker leaves it
// unset, so the agent process never spawns in local containers
// (zero RAM cost on the 14 in-process sessions) — those keep using
// docker exec/cp directly per the Phase 24B / 25 split.
//
// === Threat model ====================================================
//
// Authentication: bearer token read once at boot from
// RUNNER_AGENT_TOKEN, then deleted from process.env so /proc/<pid>/environ
// reads from same-uid learner processes can't leak it. Comparison is
// constant-time (timingSafeEqual). All endpoints except /health require
// the token.
//
// Symlink defense: writeFiles refuses to follow symlinks at any segment
// of the destination path. Mirrors LocalDocker's O_NOFOLLOW + parent-walk
// logic so learner code can't plant a symlink and trick writeFiles into
// escaping /workspace.
//
// Output cap: stdout/stderr each cap at 1 MB per exec, matching
// LocalDocker. Past that, the stream is marked truncated and the rest
// is dropped on the floor (the exec still finishes on its own clock so
// we don't need to kill upstream).
//
// Wall-clock timeout: every exec is wrapped in
// `timeout --signal=KILL Ns sh -c <cmd>` so a runaway process is hard-
// killed at the deadline. exitCode === 137 marks "timed out" the same
// way LocalDocker reports it.

import http from "node:http";
import fs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createHash, timingSafeEqual } from "node:crypto";

// ── Boot config ─────────────────────────────────────────────────────

// Token is piped from the entrypoint shell on stdin (single line,
// newline-terminated). The shell unsets RUNNER_AGENT_TOKEN from env
// BEFORE exec'ing node, so /proc/<node_pid>/environ never contains it.
// (The /proc env snapshot is set at execve() time and is immutable —
// `delete process.env.X` at runtime would NOT clear /proc.)
async function readTokenFromStdin() {
  let total = 0;
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
    total += chunk.length;
    // Token is a short single line; refuse pathological inputs.
    if (total > 4096) break;
    if (chunks.some((c) => c.includes(0x0a))) break; // newline seen
  }
  const buf = Buffer.concat(chunks);
  const nl = buf.indexOf(0x0a);
  return (nl >= 0 ? buf.subarray(0, nl) : buf).toString("utf8").trim();
}

const TOKEN = await readTokenFromStdin();
if (!TOKEN || TOKEN.length < 16) {
  // Fail fast: a missing or trivially-guessable token is a refuse-to-boot
  // condition. ACI's container-create call always sets a 32+ char random
  // token; the only way we get here is a misconfiguration we'd rather
  // surface as a crashloop than as an "open relay" agent.
  console.error(
    JSON.stringify({
      level: "error",
      evt: "agent_boot_failed",
      reason: "missing_or_weak_token",
    }),
  );
  process.exit(1);
}
// P1-2 (audit fix): instead of comparing `Buffer.from(headerValue)` to
// the raw TOKEN_BUF — which has to length-check first because
// timingSafeEqual rejects unequal-length inputs — we SHA-256 both
// sides and compare the 32-byte digests. The length check itself was
// a side channel: a wrong-length request returned in microseconds
// while a same-length request paid for the timingSafeEqual call,
// letting a network attacker probe the token's length over many
// requests. Hashing makes both paths take the same time regardless
// of attacker input length, and SHA-256's collision resistance keeps
// "find an input whose hash matches" infeasible.
const TOKEN_HASH = createHash("sha256").update(TOKEN, "utf8").digest();

const PORT = Number(process.env.RUNNER_AGENT_PORT ?? 5757);
const WORKSPACE = "/workspace";
// P1-4: canonical form of WORKSPACE — used by assertParentInsideWorkspace
// to compare child paths against the workspace prefix. Without this,
// any environment where /workspace contains a symlink component (or
// platform-specific aliasing like macOS's /tmp → /private/tmp during
// local smoke tests) would surface legitimate children as escaping.
// Computed at boot under the assumption /workspace exists; if it
// doesn't, fall back to the raw constant.
let WORKSPACE_REAL = WORKSPACE;
try {
  WORKSPACE_REAL = await fs.realpath(WORKSPACE);
} catch {
  // /workspace doesn't exist yet (test scaffold). The mkdir in
  // writeOneFile will create it on first write; subsequent realpath
  // calls inside assertParentInsideWorkspace will then resolve.
}
const MAX_BODY = 8 * 1024 * 1024; // 8 MB cap on JSON request body
const OUTPUT_CAP_BYTES = 1024 * 1024; // 1 MB per stream (matches localDocker.ts)

// Agent-level resource caps. ACI containers can't set Docker's PidsLimit or
// Ulimits via the container-group spec, so the parity comes from `ulimit`
// in the exec wrapper. LocalDocker (when Phase 25 migrates to the agent)
// will leave NPROC_LIMIT unset because RLIMIT_NPROC is per-uid on the host
// and would be shared across all 14 same-uid local containers, causing
// EAGAIN under concurrent load — Docker's PidsLimit is cgroup-scoped and
// the right tool for that case. ACI sessions get one container per learner
// so per-uid is effectively per-container.
//   - RUNNER_AGENT_NPROC_LIMIT  → ulimit -u  (process count cap, e.g. 256)
//   - RUNNER_AGENT_NOFILE_LIMIT → ulimit -n  (open-fd cap,        e.g. 256)
// Empty / 0 / non-numeric → no wrap for that limit.
const NPROC_LIMIT = Number(process.env.RUNNER_AGENT_NPROC_LIMIT) || 0;
const NOFILE_LIMIT = Number(process.env.RUNNER_AGENT_NOFILE_LIMIT) || 0;

// ── Auth helpers ────────────────────────────────────────────────────

function constantEqual(headerValue) {
  // P1-2 fix: hash both sides to fixed-width digests before compare,
  // so timing is independent of attacker-controlled input length.
  const headerHash = createHash("sha256").update(headerValue, "utf8").digest();
  return timingSafeEqual(headerHash, TOKEN_HASH);
}

function authOk(req) {
  const h = req.headers.authorization;
  if (!h || !h.startsWith("Bearer ")) return false;
  return constantEqual(h.slice(7));
}

// ── HTTP plumbing ───────────────────────────────────────────────────

// P3-1 (audit fix): per-route body caps + prototype-pollution reviver.
//
// Pre-fix every route shared the global 8 MB MAX_BODY ceiling. /exec
// only ever takes a small command + env, while /writeFiles can carry
// learner-snapshot payloads that legitimately approach the 8 MB cap.
// Allowing a 7.99 MB JSON body into /exec was a CPU-DoS surface: a
// pathological deeply-nested JSON parses for seconds even if its
// shape is rejected immediately after.
//
// The reviver rejects __proto__ / constructor / prototype keys at the
// JSON.parse step so a malicious body can't pollute Object.prototype
// before our handler validates the shape.
async function readJsonBody(req, options = {}) {
  const cap = typeof options.maxBytes === "number" ? options.maxBytes : MAX_BODY;
  let total = 0;
  const chunks = [];
  for await (const chunk of req) {
    total += chunk.length;
    if (total > cap) {
      throw Object.assign(new Error("request body too large"), { code: 413 });
    }
    chunks.push(chunk);
  }
  if (total === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"), (key, value) => {
      if (key === "__proto__" || key === "constructor" || key === "prototype") {
        // Drop the dangerous key; preserves the rest of the body so the
        // route handler still gets a usable object to shape-check.
        return undefined;
      }
      return value;
    });
  } catch {
    throw Object.assign(new Error("invalid JSON body"), { code: 400 });
  }
}

// P3-1: per-route caps. Deliberately tight where the route's payload is
// small (commands + paths) and only loose where it must be (writeFiles
// carrying learner snapshots).
const PER_ROUTE_MAX_BODY = {
  "/exec": 64 * 1024,
  "/health": 1024,
  "/writeFiles": MAX_BODY, // learner-snapshot payloads, up to 8 MB
  "/snapshot": MAX_BODY,
  "/removeFiles": 64 * 1024,
  "/fileExists": 4 * 1024,
};

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

// ── Path safety ─────────────────────────────────────────────────────

// P1-3 (audit fix): align with backend/src/services/project/snapshot.ts
// `safeResolve`. The previous agent-side resolver was weaker than the
// shared backend resolver in three ways:
//
//   1. No NUL-byte reject. A path like "ok\x00../etc/passwd" was
//      accepted by Node's path.resolve but truncated by syscalls at the
//      first NUL — letting an attacker target a different file than
//      what path.resolve appeared to produce.
//
//   2. No reject for segments starting with "-". On the runner image,
//      shell expansion of `*.c` would pass a file named e.g. `-O3.c`
//      as a flag to gcc/cc. The compile-command harness uses ./* prefixes
//      as primary defense, but rejecting such filenames at write time is
//      the proper choke point.
//
//   3. No backslash normalization. A Windows-style "a\b\c" path slipped
//      through the resolver as a single segment instead of three —
//      meaning ".." inside such a string was missed by the substring
//      check on the unnormalized form.
//
// Inputs hit this on writeFiles, removeFiles, and fileExists, so any
// gap here is a generic file-write/read primitive into anywhere
// inside /workspace's parent (or beyond, with NUL truncation).
function safeResolveAbs(rel) {
  if (typeof rel !== "string" || rel.length === 0) {
    throw Object.assign(new Error("path required"), { code: 400 });
  }
  // Reject NUL bytes outright — the kernel truncates filenames at NUL,
  // so a path that LOOKS valid to path.resolve resolves at the syscall
  // to a totally different file. There is no legitimate use of NUL
  // inside a relative path; any input containing it is malicious.
  if (rel.includes("\0")) {
    throw Object.assign(new Error("invalid path"), { code: 400 });
  }
  // Normalize backslashes and strip leading slashes BEFORE the traversal
  // check — without this, "a\\..\\b" would slip past a naive ".." check.
  const cleaned = rel.replace(/\\/g, "/").replace(/^\/+/, "");
  if (cleaned === "" || cleaned.includes("..")) {
    throw Object.assign(new Error("invalid path"), { code: 400 });
  }
  // Per-segment "starts with -" reject. A file named "-O3.c" would otherwise
  // be expanded by the shell's wildcard into a flag to gcc. Belt-and-
  // suspenders; the harness also uses ./* prefixes.
  for (const segment of cleaned.split("/")) {
    if (segment.startsWith("-")) {
      throw Object.assign(new Error("invalid path"), { code: 400 });
    }
  }
  const abs = path.resolve(WORKSPACE, cleaned);
  if (abs !== WORKSPACE && !abs.startsWith(WORKSPACE + path.sep)) {
    throw Object.assign(new Error("path escapes workspace"), { code: 400 });
  }
  return abs;
}

async function ensureNoSymlinkInPath(parent) {
  // Walk every segment between WORKSPACE and `parent`; reject if any is
  // a symlink. ENOENT segments are OK (mkdir-recursive will create them).
  // This guards against the directory-symlink attack: learner code plants
  // /workspace/a/b → /etc, then a write to /workspace/a/b/foo would land
  // outside the workspace if we just trusted the resolved path.
  const rel = path.relative(WORKSPACE, parent);
  if (!rel || rel === "" || rel.startsWith("..")) return;
  let cur = WORKSPACE;
  for (const seg of rel.split(path.sep)) {
    cur = path.join(cur, seg);
    try {
      const st = await fs.lstat(cur);
      if (st.isSymbolicLink()) {
        throw Object.assign(new Error(`symlink in path: ${cur}`), { code: 400 });
      }
    } catch (e) {
      if (e.code === "ENOENT") return; // missing dir is fine
      throw e;
    }
  }
}

// P1-4 (audit fix): TOCTOU close-out for the parent directory.
//
// The audit's preferred fix was an O_PATH workspace fd + posix.openat
// per segment, but Node — even at v23 — does not expose openat. Closest
// Node primitive that closes the TOCTOU window is realpath: after we've
// walked + mkdir'd the parent, we resolve the canonical path of `parent`
// and verify it still lands under WORKSPACE. Any symlink inserted
// between ensureNoSymlinkInPath and now would have made the realpath
// jump outside the workspace, and we catch it here BEFORE the leaf
// open.
//
// Combined with the leaf open's O_NOFOLLOW | O_EXCL flags, this makes
// the only remaining race: an attacker who replaces the leaf with a
// symlink between realpath and open. O_NOFOLLOW catches that — open
// refuses to follow a symlink leaf and returns ELOOP.
//
// Note: realpath follows ALL symlinks. We previously REJECTED them in
// the per-segment walk, so for legitimate paths realpath is a no-op
// (canonical form == input). For attacker paths inserted post-walk,
// realpath surfaces the real target and we reject.
async function assertParentInsideWorkspace(parent) {
  if (parent === WORKSPACE) return;
  let real;
  try {
    real = await fs.realpath(parent);
  } catch (e) {
    if (e.code === "ENOENT") return; // mkdir hasn't run yet, or post-write race; fine
    throw e;
  }
  // Compare against the realpath of WORKSPACE so platform-specific path
  // aliasing (macOS /tmp → /private/tmp, or any future symlink in the
  // workspace ancestry) doesn't make legitimate children look escaping.
  if (real !== WORKSPACE_REAL && !real.startsWith(WORKSPACE_REAL + path.sep)) {
    throw Object.assign(
      new Error(`parent escapes workspace via symlink TOCTOU: ${parent} → ${real}`),
      { code: 400 },
    );
  }
}

async function writeOneFile(file) {
  if (!file || typeof file.path !== "string" || typeof file.content !== "string") {
    throw Object.assign(new Error("file requires {path, content}"), { code: 400 });
  }
  const abs = safeResolveAbs(file.path);
  const parent = path.dirname(abs);
  await ensureNoSymlinkInPath(parent);
  await fs.mkdir(parent, { recursive: true });
  // P1-4: TOCTOU close-out — re-verify parent's canonical path is still
  // under WORKSPACE. mkdir(recursive) follows symlinks on intermediate
  // components, so a symlink inserted between the walk above and the
  // mkdir would let mkdir create directories anywhere on disk. Catch
  // it now, before the leaf open commits to a path.
  await assertParentInsideWorkspace(parent);
  // Pre-unlink any existing file (regular or symlink) so the open below
  // creates fresh. Combined with O_NOFOLLOW + O_EXCL this is TOCTOU-safe:
  // even if a symlink is replanted between unlink and open, the open
  // refuses to follow it.
  await fs.unlink(abs).catch((e) => {
    if (e.code !== "ENOENT") throw e;
  });
  const flags =
    fsConstants.O_WRONLY |
    fsConstants.O_CREAT |
    fsConstants.O_EXCL |
    fsConstants.O_NOFOLLOW;
  const fh = await fs.open(abs, flags, 0o600);
  try {
    await fh.writeFile(file.content, "utf8");
  } finally {
    await fh.close();
  }
}

// ── Endpoint handlers ───────────────────────────────────────────────

async function handleHealth(_req, res) {
  send(res, 200, { ok: true, agent: "codetutor-runner-agent", v: 1 });
}

async function handleExec(req, res) {
  const body = await readJsonBody(req, { maxBytes: PER_ROUTE_MAX_BODY["/exec"] });
  const command = body.command;
  const timeoutMs = Number(body.timeoutMs);
  if (typeof command !== "string" || !command) {
    return send(res, 400, { error: "command required" });
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 600_000) {
    return send(res, 400, { error: "timeoutMs must be 1..600000" });
  }
  const timeoutSec = Math.max(1, Math.ceil(timeoutMs / 1000));
  // Build env: start from process.env (already token-stripped), apply
  // caller overlay last so explicit overrides win. Never re-add the
  // bearer token. Cast all values to strings — child_process is strict.
  const env = { ...process.env };
  if (body.env && typeof body.env === "object") {
    // P3-1 (audit fix): cap body.env to 64 entries × 4 KB. Pre-fix a
    // pathological 8 MB body could flood the spawn with megabytes of
    // env vars. argv/env limits at the kernel level (~2 MB total) would
    // have caught this eventually but at a worse error path.
    const ENV_MAX_ENTRIES = 64;
    const ENV_MAX_VALUE_BYTES = 4 * 1024;
    const entries = Object.entries(body.env);
    if (entries.length > ENV_MAX_ENTRIES) {
      return send(res, 400, {
        error: `env has too many keys (max ${ENV_MAX_ENTRIES})`,
      });
    }
    for (const [k, v] of entries) {
      const ks = String(k);
      const vs = String(v);
      if (Buffer.byteLength(vs, "utf8") > ENV_MAX_VALUE_BYTES) {
        return send(res, 400, {
          error: `env[${ks}] exceeds ${ENV_MAX_VALUE_BYTES} bytes`,
        });
      }
      env[ks] = vs;
    }
  }
  // Build the wrapped command:
  //   `[ulimit -u N;] [ulimit -n N;] <user command>`
  // Wrapped further with `timeout --signal=KILL Ns bash -c …` so a runaway
  // process is hard-killed at the wall-clock deadline; exit code 137
  // means timeout fired, matching the LocalDocker convention.
  //
  // ulimit is a SHELL builtin (not /usr/bin/ulimit) so it has to live
  // inside the `bash -c` body. It applies to the shell + descendants via
  // RLIMIT_NPROC / RLIMIT_NOFILE inheritance. Belt-and-suspenders: ACI
  // gets these because its container spec can't set Docker-style PidsLimit
  // / Ulimits; LocalDocker today sets them at the cgroup level via Docker
  // and leaves these env vars unset.
  //
  // Why bash and not sh: Debian's /bin/sh is dash, whose ulimit builtin
  // does NOT support `-u` (POSIX only requires -c, -d, -f, -m, -p, -s,
  // -t, -v; -u is a bash extension). The runner image already installs
  // bash, so the cost is one extra fork-exec layer per /exec call —
  // negligible vs. the safety win.
  const ulimitParts = [];
  if (NPROC_LIMIT > 0) ulimitParts.push(`ulimit -u ${NPROC_LIMIT}`);
  if (NOFILE_LIMIT > 0) ulimitParts.push(`ulimit -n ${NOFILE_LIMIT}`);
  const wrapped =
    ulimitParts.length > 0 ? `${ulimitParts.join("; ")}; ${command}` : command;
  const args = ["--signal=KILL", `${timeoutSec}s`, "bash", "-c", wrapped];
  const started = Date.now();
  const child = spawn("timeout", args, { env, cwd: WORKSPACE });

  let stdoutBytes = 0, stderrBytes = 0;
  let stdoutTrunc = false, stderrTrunc = false;
  const stdoutChunks = [], stderrChunks = [];

  child.stdout.on("data", (c) => {
    if (stdoutBytes >= OUTPUT_CAP_BYTES) return;
    const room = OUTPUT_CAP_BYTES - stdoutBytes;
    if (c.length <= room) {
      stdoutChunks.push(c);
      stdoutBytes += c.length;
    } else {
      stdoutChunks.push(c.subarray(0, room));
      stdoutBytes = OUTPUT_CAP_BYTES;
      stdoutTrunc = true;
    }
  });
  child.stderr.on("data", (c) => {
    if (stderrBytes >= OUTPUT_CAP_BYTES) return;
    const room = OUTPUT_CAP_BYTES - stderrBytes;
    if (c.length <= room) {
      stderrChunks.push(c);
      stderrBytes += c.length;
    } else {
      stderrChunks.push(c.subarray(0, room));
      stderrBytes = OUTPUT_CAP_BYTES;
      stderrTrunc = true;
    }
  });

  if (typeof body.stdin === "string") {
    child.stdin.write(body.stdin);
  }
  child.stdin.end();

  const result = await new Promise((resolve) => {
    child.on("close", (code, signal) => resolve({ code, signal }));
    child.on("error", () => resolve({ code: -1, signal: null }));
  });

  // Timeout detection. `timeout --signal=KILL Ns sh -c <cmd>` may
  // return EITHER:
  //   - exitCode 137 (the killed shell's SIGKILL exit, propagated by
  //     timeout) when timeout cleans up after sending SIGKILL, OR
  //   - signal === "SIGKILL" + code === null when Node observes the
  //     spawn parent itself was reaped via the kill — common when the
  //     timeout binary forwards the signal into its own process group.
  // Either path is a timeout; collapse to one boolean and a sane code.
  const sigKilled = result.signal === "SIGKILL";
  const timedOut = sigKilled || result.code === 137;
  const exitCode = result.code ?? (timedOut ? 137 : -1);

  const truncMarker = "\n[output truncated at 1 MB]\n";
  const stdout =
    Buffer.concat(stdoutChunks).toString("utf8") + (stdoutTrunc ? truncMarker : "");
  const stderr =
    Buffer.concat(stderrChunks).toString("utf8") + (stderrTrunc ? truncMarker : "");

  send(res, 200, {
    stdout,
    stderr,
    exitCode,
    timedOut,
    durationMs: Date.now() - started,
  });
}

async function handleWriteFiles(req, res) {
  const body = await readJsonBody(req, {
    maxBytes: PER_ROUTE_MAX_BODY["/writeFiles"],
  });
  if (!Array.isArray(body.files)) {
    return send(res, 400, { error: "files[] required" });
  }
  for (const f of body.files) {
    await writeOneFile(f);
  }
  send(res, 200, { ok: true, written: body.files.length });
}

async function handleRemoveFiles(req, res) {
  const body = await readJsonBody(req, {
    maxBytes: PER_ROUTE_MAX_BODY["/removeFiles"],
  });
  if (!Array.isArray(body.paths)) {
    return send(res, 400, { error: "paths[] required" });
  }
  for (const p of body.paths) {
    try {
      const abs = safeResolveAbs(p);
      await fs.rm(abs, { force: true });
    } catch {
      /* invalid path or already gone — match localDocker semantics */
    }
  }
  send(res, 200, { ok: true });
}

async function handleFileExists(req, res) {
  const url = new URL(req.url, "http://x");
  const rel = url.searchParams.get("path");
  if (!rel) return send(res, 400, { error: "path required" });
  try {
    const abs = safeResolveAbs(rel);
    await fs.access(abs);
    send(res, 200, { exists: true });
  } catch {
    send(res, 200, { exists: false });
  }
}

async function handleSnapshot(req, res) {
  const body = await readJsonBody(req, {
    maxBytes: PER_ROUTE_MAX_BODY["/snapshot"],
  });
  if (!Array.isArray(body.files)) {
    return send(res, 400, { error: "files[] required" });
  }
  // Wipe workspace contents (not the dir itself — bind-mount inode
  // matters for LocalDocker, and consistency for ACI is cheap).
  await fs.mkdir(WORKSPACE, { recursive: true });
  const entries = await fs.readdir(WORKSPACE, { withFileTypes: true });
  await Promise.all(
    entries.map((e) => {
      const child = path.join(WORKSPACE, e.name);
      if (e.isSymbolicLink()) return fs.unlink(child).catch(() => {});
      return fs.rm(child, { recursive: true, force: true });
    }),
  );
  for (const f of body.files) {
    await writeOneFile(f);
  }
  send(res, 200, { ok: true, written: body.files.length });
}

// ── Server ──────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");

    // Health is unauth so external probes (ACI's livenessProbe, k8s
    // readiness checks, dev curl) can hit it without holding the token.
    if (req.method === "GET" && url.pathname === "/health") {
      return await handleHealth(req, res);
    }

    // All other endpoints require the bearer token. Return 401 with no
    // body detail so the response shape doesn't reveal which arm of the
    // auth check failed (header missing vs. token mismatch).
    if (!authOk(req)) return send(res, 401, { error: "unauthorized" });

    if (req.method === "POST" && url.pathname === "/exec") return await handleExec(req, res);
    if (req.method === "POST" && url.pathname === "/writeFiles") return await handleWriteFiles(req, res);
    if (req.method === "DELETE" && url.pathname === "/files") return await handleRemoveFiles(req, res);
    if (req.method === "GET" && url.pathname === "/fileExists") return await handleFileExists(req, res);
    if (req.method === "POST" && url.pathname === "/snapshot") return await handleSnapshot(req, res);

    send(res, 404, { error: "not found" });
  } catch (e) {
    const status = typeof e?.code === "number" ? e.code : 500;
    send(res, status, { error: String(e?.message ?? e) });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(
    JSON.stringify({
      level: "info",
      evt: "agent_listening",
      port: PORT,
    }),
  );
});

// Clean shutdown on SIGTERM / SIGINT so ACI's terminate signal lets
// in-flight requests drain rather than dying mid-response.
for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => {
    console.log(JSON.stringify({ level: "info", evt: "agent_stopping", sig }));
    server.close(() => process.exit(0));
    // 5s grace before hard-exit; ACI gives ~30s by default.
    setTimeout(() => process.exit(1), 5000).unref();
  });
}
