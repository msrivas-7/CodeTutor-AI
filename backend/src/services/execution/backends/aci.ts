// Phase 24B: ACI hybrid burst overflow.
//
// When the local Docker session count hits config.session.maxGlobal (14),
// new sessions spill over into Azure Container Instances. This backend
// implements the same ExecutionBackend interface as LocalDocker, but drives
// the runner over HTTP via the in-runner sidecar agent (see
// runner-image/agent/agent.mjs) — Azure exposes no equivalent of `docker
// exec` / `docker cp` from outside the daemon, so the agent IS our
// control plane.
//
// === Security posture parity with LocalDocker ========================
//
// Every claim verified by e2e/security-suite/scenarios/* must hold for
// ACI containers too. The ACI container-group spec mirrors LocalDocker's
// HostConfig / SecurityOpt fields one-for-one where Azure exposes them,
// and falls back to agent-level enforcement where it doesn't:
//
//   Claim                       LocalDocker mechanism      ACI mechanism
//   -----                       ---------------------      -------------
//   C1  non-root UID 1100       USER runner (Dockerfile)   USER runner (image)
//   C3  capDrop ALL             HostConfig.CapDrop         securityContext.capabilities.drop
//   C4  readonly rootfs         HostConfig.ReadonlyRootfs  securityContext.readOnlyRootFilesystem
//   C5  no-new-privileges       SecurityOpt                securityContext.allowPrivilegeEscalation: false
//   C6  memory cap              HostConfig.Memory          resources.limits.memoryInGB
//   C7  CPU cap                 HostConfig.NanoCpus        resources.limits.cpu
//   C8  PidsLimit (fork-bomb)   HostConfig.PidsLimit       agent ulimit -u (RUNNER_AGENT_NPROC_LIMIT)
//   C9  ulimit nofile           HostConfig.Ulimits         agent ulimit -n (RUNNER_AGENT_NOFILE_LIMIT)
//   C10 tmpfs /tmp 64 MB        HostConfig.Tmpfs           emptyDir volume + agent-level path checks
//   C11 output cap 1 MB         agent (already)            agent (already)
//   C12 wall-clock timeout      agent (already)            agent (already)
//   C13 symlink defense         agent + LocalDocker writeFiles  agent (already)
//   C2  network=none            HostConfig.NetworkMode     subnet NSG denies all egress (slice 6)
//
// The runner image and the in-runner agent are the SAME binaries used by
// LocalDocker — this backend just provisions a different host. Defense
// in depth: every guarantee LocalDocker enforces below the OS, ACI either
// inherits via the image OR replicates via container-group spec OR backfills
// via the agent's exec wrapper. Cross-tenant isolation is by container-
// group boundary (one group per session, deleted on destroy).
//
// === Network ==========================================================
//
// Container groups deploy into a private VNet subnet (config.aci.subnetId).
// The subnet's NSG blocks all egress to the internet (provisioned in
// slice 6 / Bicep). The backend reaches the agent via the container's
// private IP address; the bearer token authenticates every request. HTTP
// (not HTTPS) is acceptable here because the traffic stays inside Azure's
// private VNet plane — adding TLS would require per-session cert
// provisioning, which is cost without commensurate threat-model benefit.

import { ContainerInstanceManagementClient } from "@azure/arm-containerinstance";
import { DefaultAzureCredential } from "@azure/identity";
import crypto from "node:crypto";
import { aciCostTracker } from "../../observability/aciCostTracker.js";
import type {
  ExecOptions,
  ExecResult,
  ExecutionBackend,
  RuntimeSpec,
  SessionHandle,
  WorkspaceFile,
} from "./types.js";

// Per-session opaque handle. The bearer token lives in this handle and
// nowhere else (NOT logged, NOT serialized to clients). When the session
// is destroyed the handle is dropped from the active map and the token
// is GC'd.
interface AciHandle extends SessionHandle {
  readonly __kind: "aci";
  readonly containerGroupName: string;
  readonly privateIp: string;
  readonly port: number;
  /** Per-session random bearer token. Sent to sidecar at boot, never logged. */
  readonly bearerToken: string;
  readonly createdAt: number;
}

export interface AciBackendOptions {
  subscriptionId: string;
  resourceGroup: string;
  location: string;
  /** Full ARM resource ID of the VNet subnet ACI containers join. */
  subnetId: string;
  /** GHCR-pulled image, ideally pinned by digest (`@sha256:…`). */
  runnerImage: string;
  /** Port the sidecar listens on — same value baked into the runner image. */
  sidecarPort: number;
  /** ms to wait for "Pending → Running" + first /health response. */
  coldStartTimeoutMs: number;
  /**
   * ms budget for the in-runner agent to respond to /health AFTER Azure
   * reports the container Running. The agent typically boots in 1-2s;
   * this is just slack for slow image cold-start variations. Default
   * 10000. Tests use small values (200ms) to keep failure-path tests
   * fast. In prod this is unrelated to coldStartTimeoutMs because Azure
   * has already done its work by the time we poll the agent.
   */
  agentReadyTimeoutMs?: number;
  /** Per-session memory cap. Match local for parity (default 0.5 GB). */
  memoryInGB?: number;
  /** Per-session CPU cap. Match local for parity (default 1 vCPU). */
  cpu?: number;
}

// Internal warm-pool entry. Same shape as AciHandle but the sessionId
// is a synthetic "warm-N" placeholder. On claim, the placeholder is
// swapped for the real sessionId before the handle is exposed.
interface WarmEntry {
  containerGroupName: string;
  privateIp: string;
  port: number;
  bearerToken: string;
  spawnedAt: number;
  warmId: string; // e.g. "warm-1761234567890-0" (used as a synthetic sessionId)
}

const DEFAULT_AGENT_READY_TIMEOUT_MS = 10_000;

const DEFAULT_MEMORY_GB = 0.5;
const DEFAULT_CPU = 1;
// Belt-and-suspenders caps applied via the agent's exec wrapper. ACI
// can't set these via container-group spec, so we pass them as env vars
// the agent reads at boot. Values match LocalDocker's PidsLimit/Ulimits.
const NPROC_LIMIT = 256;
const NOFILE_LIMIT = 256;

export class AciExecutionBackend implements ExecutionBackend {
  readonly kind = "aci";
  private client: ContainerInstanceManagementClient | null = null;
  private readonly active = new Map<string, AciHandle>();
  private ready = false;

  // Phase 24B Slice 8: warm pool. Pre-spawned containers waiting to be
  // CLAIMED (single-use, never recycled across learners — cross-tenant
  // workspace state would leak otherwise). Sized by an external service
  // (aciWarmPoolService) that reads HybridBackend's local-active count.
  // The cost tracker treats warm spawns the same as live sessions
  // (Azure bills them either way); on claim, the warm bucket ends and
  // a real-session bucket starts — total $ accrual stays continuous.
  private readonly warmPool: WarmEntry[] = [];
  private warmSpawnSeq = 0;

  constructor(private readonly opts: AciBackendOptions) {}

  // ── Lifecycle ───────────────────────────────────────────────────────

  async ensureReady(): Promise<void> {
    // Hard gate on required config. Without these, no ACI calls can succeed
    // — fail loudly at boot instead of mysteriously at first overflow.
    const missing: string[] = [];
    if (!this.opts.subscriptionId) missing.push("subscriptionId");
    if (!this.opts.resourceGroup) missing.push("resourceGroup");
    if (!this.opts.subnetId) missing.push("subnetId");
    if (!this.opts.runnerImage) missing.push("runnerImage");
    if (missing.length > 0) {
      throw new Error(
        `[aci] missing required config: ${missing.join(", ")}. ` +
          `ACI backend cannot start without these. See .env.production.example.`,
      );
    }

    // DefaultAzureCredential walks: env vars → Workload Identity → Managed
    // Identity → az CLI. On the prod VM the system-assigned MI is used; in
    // dev we fall back to az CLI. Token refresh is internal to the SDK.
    const credential = new DefaultAzureCredential();
    this.client = new ContainerInstanceManagementClient(
      credential,
      this.opts.subscriptionId,
    );

    // Cheap probe: list container groups in the RG. Verifies (a) creds are
    // valid, (b) sub/RG exist, (c) we have at least Read on the RG. Throws
    // if any fail — surface at boot rather than at first session create.
    try {
      const iter = this.client.containerGroups.listByResourceGroup(
        this.opts.resourceGroup,
      );
      // Drain at most one page; we don't need the contents, just the API call.
      await iter.next();
    } catch (err) {
      throw new Error(
        `[aci] auth probe failed against ${this.opts.resourceGroup}: ${(err as Error).message}`,
      );
    }

    this.ready = true;
    console.log(
      JSON.stringify({
        level: "info",
        evt: "aci_backend_ready",
        rg: this.opts.resourceGroup,
        location: this.opts.location,
      }),
    );
  }

  async ping(): Promise<void> {
    if (!this.ready || !this.client) {
      throw new Error("aci backend not ready");
    }
    // Same shape as ensureReady but kept tight for /api/health/deep —
    // single API call, returns when Azure ARM responds with the first
    // page of container groups (fast, doesn't enumerate all).
    const iter = this.client.containerGroups.listByResourceGroup(
      this.opts.resourceGroup,
    );
    await iter.next();
  }

  queueDepth(): { inFlight: number; queued: number } {
    // ACI doesn't queue locally — every overflow request either spawns or
    // fails. inFlight = active session count; queued = 0 always.
    return { inFlight: this.active.size, queued: 0 };
  }

  /** Active session count for the cost sampler. Pure read. */
  activeSessionCount(): number {
    return this.active.size;
  }

  // ── Session lifecycle ───────────────────────────────────────────────

  async createSession(spec: RuntimeSpec): Promise<SessionHandle> {
    if (!this.client) {
      throw new Error("[aci] backend not ready — ensureReady() not called");
    }

    // Phase 24B Slice 8: warm-pool fast path. If a pre-spawned container
    // is waiting, claim it instead of cold-starting fresh. Latency drops
    // from 5–15s to ~1 ms. Single-use: claimed containers do NOT return
    // to the pool when the session ends (workspace + tmpfs accumulate
    // state across learners → cross-tenant data leak otherwise).
    const claimed = this.tryClaimWarm(spec.sessionId);
    if (claimed) return claimed;

    const containerGroupName = `codetutor-ai-aci-${spec.sessionId}`;
    const spawned = await this.spawnContainerGroup(containerGroupName);

    const handle: AciHandle = {
      sessionId: spec.sessionId,
      __kind: "aci",
      containerGroupName,
      privateIp: spawned.privateIp,
      port: spawned.port,
      bearerToken: spawned.bearerToken,
      createdAt: Date.now(),
    };
    this.active.set(spec.sessionId, handle);
    // Cost-cap accounting: register only AFTER cold start succeeded +
    // the agent is reachable. Failed spawns don't get billed against
    // the daily cap (Azure may have charged for the partial spawn, but
    // it's bounded by coldStartTimeoutMs and we'd rather under-credit
    // than have failed spawns burn cap headroom).
    aciCostTracker.recordSessionStart(handle.sessionId, handle.createdAt);
    return handle;
  }

  // Shared spawn helper used by BOTH cold-start createSession and the
  // warm-pool spawn path. Returns the network coords + bearer token of
  // a fully-Running, agent-responding container group. Throws on any
  // failure — caller decides whether to surface to the user (cold path)
  // or quietly drop the warm-pool slot (warm path).
  private async spawnContainerGroup(containerGroupName: string): Promise<{
    privateIp: string;
    port: number;
    bearerToken: string;
  }> {
    if (!this.client) {
      throw new Error("[aci] backend not ready — ensureReady() not called");
    }
    // 192-bit token, base64url-encoded → 32 chars. Cryptographically
    // random per-container; never logged, never serialized off the backend.
    const bearerToken = crypto.randomBytes(24).toString("base64url");
    const port = this.opts.sidecarPort;
    const memoryInGB = this.opts.memoryInGB ?? DEFAULT_MEMORY_GB;
    const cpu = this.opts.cpu ?? DEFAULT_CPU;

    // Container-group spec. Every field below either:
    //   - mirrors a LocalDocker HostConfig / SecurityOpt setting, or
    //   - delegates to the agent for defense-in-depth.
    // No public IP — `ipAddress.type: "Private"` keeps the agent unreachable
    // from outside the VNet. Subnet NSG (slice 6) blocks egress.
    const groupSpec = {
      location: this.opts.location,
      osType: "Linux",
      restartPolicy: "Never" as const,
      subnetIds: [{ id: this.opts.subnetId }],
      ipAddress: {
        type: "Private" as const,
        ports: [{ port, protocol: "TCP" as const }],
      },
      containers: [
        {
          name: "runner",
          image: this.opts.runnerImage,
          // Token via env. Inside the container, the entrypoint script
          // unsets it from env BEFORE exec'ing node, so the token only
          // lives in node's JS heap (not /proc/<pid>/environ).
          environmentVariables: [
            { name: "ENABLE_AGENT", value: "1" },
            { name: "RUNNER_AGENT_TOKEN", secureValue: bearerToken },
            { name: "RUNNER_AGENT_NPROC_LIMIT", value: String(NPROC_LIMIT) },
            { name: "RUNNER_AGENT_NOFILE_LIMIT", value: String(NOFILE_LIMIT) },
          ],
          ports: [{ port, protocol: "TCP" as const }],
          resources: {
            requests: { memoryInGB, cpu },
            limits: { memoryInGB, cpu },
          },
          // C1 / C3 / C4 / C5 — kernel-level claims. ACI's securityContext
          // is the documented mapping for these Linux kernel knobs.
          securityContext: {
            allowPrivilegeEscalation: false,
            capabilities: { drop: ["ALL"] },
            privileged: false,
            runAsNonRoot: true,
            runAsUser: 1100,
            readOnlyRootFilesystem: true,
          },
          volumeMounts: [
            { name: "tmp", mountPath: "/tmp" },
            { name: "workspace", mountPath: "/workspace" },
          ],
        },
      ],
      // emptyDir volumes provide the writable /tmp and /workspace mounts
      // that readOnlyRootFilesystem otherwise denies. ACI's emptyDir is
      // bound by the container's memory limit; sufficient for short
      // session-scoped use. Both volumes are wiped when the container
      // group is deleted (which happens on destroy()).
      volumes: [
        { name: "tmp", emptyDir: {} },
        { name: "workspace", emptyDir: {} },
      ],
    };

    let privateIp: string | null = null;
    try {
      // beginCreateOrUpdateAndWait blocks until the group transitions to
      // a terminal state (Running, Failed, etc). The abortSignal cuts
      // the wait short if the cold-start budget is exceeded — at that
      // point we delete the partial group and surface the failure.
      const result = await this.client.containerGroups.beginCreateOrUpdateAndWait(
        this.opts.resourceGroup,
        containerGroupName,
        groupSpec as never, // SDK types are deeply structural; spec above matches
        { abortSignal: AbortSignal.timeout(this.opts.coldStartTimeoutMs) },
      );

      privateIp = result.ipAddress?.ip ?? null;
      if (!privateIp) {
        throw new Error("[aci] container group has no private IP after Running");
      }

      // The container is Running but the sidecar process inside may be
      // mid-boot. Poll /health until 200 or budget exhausted.
      await this.waitForAgent(privateIp, port, bearerToken);
    } catch (err) {
      // Never leak a partial container group. Best-effort delete; if it
      // fails we have a stale resource the operator will spot via cost
      // alerts. Re-throw the original error.
      await this.tryDelete(containerGroupName);
      throw new Error(
        `[aci] spawnContainerGroup failed: ${(err as Error).message}`,
      );
    }
    return { privateIp, port, bearerToken };
  }

  async isAlive(handle: SessionHandle): Promise<boolean> {
    const h = this.cast(handle);
    if (!this.client) return false;
    try {
      const group = await this.client.containerGroups.get(
        this.opts.resourceGroup,
        h.containerGroupName,
      );
      // Running OR Pending counts as alive. Failed/Succeeded/(undefined) → dead.
      const state = group.instanceView?.state;
      return state === "Running" || state === "Pending";
    } catch {
      // 404 / network blip / SDK throw — treat as dead. The session manager
      // will reap on the next sweep.
      return false;
    }
  }

  async destroy(handle: SessionHandle): Promise<void> {
    const h = this.cast(handle);
    this.active.delete(h.sessionId);
    // Record session end BEFORE the async Azure delete — destroy() is
    // the moment we stop being responsible for billing from our side.
    // Azure's actual teardown is typically <1s after this call returns,
    // so the seconds-of-undercount are bounded and acceptable for a
    // daily cap (vs. ledger-grade invoicing).
    aciCostTracker.recordSessionEnd(h.sessionId);
    await this.tryDelete(h.containerGroupName);
  }

  // ── HTTP-to-sidecar methods ─────────────────────────────────────────

  async exec(
    handle: SessionHandle,
    command: string,
    timeoutMs: number,
    opts: ExecOptions = {},
  ): Promise<ExecResult> {
    const h = this.cast(handle);
    // HTTP-side timeout = agent-side timeout + 5s buffer. The agent's
    // wrapper kills the runaway process at timeoutMs; we wait a little
    // longer to receive the response.
    const httpBudgetMs = timeoutMs + 5_000;
    const body = await this.sidecarFetch<ExecResult>(h, "POST", "/exec", {
      command,
      timeoutMs,
      env: opts.env,
      stdin: opts.stdin,
    }, httpBudgetMs);
    return body;
  }

  async writeFiles(handle: SessionHandle, files: WorkspaceFile[]): Promise<void> {
    const h = this.cast(handle);
    await this.sidecarFetch(h, "POST", "/writeFiles", { files });
  }

  async removeFiles(handle: SessionHandle, paths: string[]): Promise<void> {
    const h = this.cast(handle);
    await this.sidecarFetch(h, "DELETE", "/files", { paths });
  }

  async fileExists(
    handle: SessionHandle,
    relativePath: string,
  ): Promise<boolean> {
    const h = this.cast(handle);
    const qs = `?path=${encodeURIComponent(relativePath)}`;
    const body = await this.sidecarFetch<{ exists: boolean }>(
      h,
      "GET",
      `/fileExists${qs}`,
    );
    return body.exists === true;
  }

  async replaceSnapshot(
    handle: SessionHandle,
    files: WorkspaceFile[],
  ): Promise<void> {
    const h = this.cast(handle);
    await this.sidecarFetch(h, "POST", "/snapshot", { files });
  }

  // ── Warm pool ───────────────────────────────────────────────────────
  //
  // Pre-spawn ACI containers + hold them ready for claim. Reduces overflow
  // cold-start from 5–15 s to ~1 ms. Driven externally by aciWarmPoolService
  // (which reads HybridBackend's localActive count + applies hysteresis);
  // this class just exposes the mechanism.
  //
  // Single-use: a claimed container becomes a real session and is destroyed
  // when that session ends. Reuse across learners would leak workspace +
  // /tmp + agent process state across tenants — a security violation.
  //
  // Cost continuity: warm spawns ARE billed (Azure doesn't care that they're
  // idle). Their seconds count toward the daily cap. On claim, the warm-id
  // bucket ends and a real-session bucket starts at the same moment so total
  // accrual matches the Azure invoice (continuous billable time, no double-
  // counting and no gaps).

  /**
   * Spawn one new warm container and add it to the pool. Returns true on
   * success, false on any failure (Azure throttle, cold-start timeout,
   * agent unreachable). The pool service uses the boolean to decide
   * whether to back off before retrying.
   */
  async spawnWarm(): Promise<boolean> {
    if (!this.client) return false;
    this.warmSpawnSeq += 1;
    const warmId = `aci-warm-${Date.now()}-${this.warmSpawnSeq}`;
    const containerGroupName = `codetutor-ai-aci-${warmId}`;
    try {
      const spawned = await this.spawnContainerGroup(containerGroupName);
      const entry: WarmEntry = {
        containerGroupName,
        privateIp: spawned.privateIp,
        port: spawned.port,
        bearerToken: spawned.bearerToken,
        spawnedAt: Date.now(),
        warmId,
      };
      this.warmPool.push(entry);
      // Warm containers are billable from spawn-time. Record under the
      // synthetic warm-id so the daily-cap accumulator includes them.
      aciCostTracker.recordSessionStart(warmId, entry.spawnedAt);
      console.log(
        JSON.stringify({
          level: "info",
          evt: "aci_warm_spawned",
          warmId,
          poolSize: this.warmPool.length,
        }),
      );
      return true;
    } catch (err) {
      // spawnContainerGroup already cleaned up (tryDelete on the partial
      // group). Just log + return false; the pool service will retry on
      // the next tick if it still wants more warm capacity.
      console.error(
        JSON.stringify({
          level: "error",
          evt: "aci_warm_spawn_failed",
          err: (err as Error).message,
        }),
      );
      return false;
    }
  }

  /**
   * Drain the OLDEST warm container (FIFO). Used by the pool service when
   * the high-watermark clears and we want to release the held capacity.
   * No-op + returns false if the pool is empty.
   */
  async drainOldestWarm(): Promise<boolean> {
    const entry = this.warmPool.shift();
    if (!entry) return false;
    // End the warm-id cost bucket — the time from spawn to drain is its
    // total billable lifetime (warm containers were never claimed).
    aciCostTracker.recordSessionEnd(entry.warmId);
    await this.tryDelete(entry.containerGroupName);
    console.log(
      JSON.stringify({
        level: "info",
        evt: "aci_warm_drained",
        warmId: entry.warmId,
        poolSize: this.warmPool.length,
      }),
    );
    return true;
  }

  /**
   * Try to pop a warm container and convert it into a session-bound
   * handle. Returns null if the pool is empty (caller falls back to
   * cold-start). Cost bookkeeping is atomic with the claim: the warm-id
   * bucket ends and the real session-id bucket starts at the same moment.
   * Called from createSession's hot path.
   */
  private tryClaimWarm(sessionId: string): AciHandle | null {
    const entry = this.warmPool.shift();
    if (!entry) return null;
    const now = Date.now();
    // Atomic cost continuity: end warm bucket, start session bucket.
    // (now-spawnedAt) + (destroy-now) = total billed time = (destroy-spawnedAt).
    aciCostTracker.recordSessionEnd(entry.warmId, now);
    aciCostTracker.recordSessionStart(sessionId, now);
    const handle: AciHandle = {
      sessionId,
      __kind: "aci",
      containerGroupName: entry.containerGroupName,
      privateIp: entry.privateIp,
      port: entry.port,
      bearerToken: entry.bearerToken,
      createdAt: now,
    };
    this.active.set(sessionId, handle);
    console.log(
      JSON.stringify({
        level: "info",
        evt: "aci_warm_claimed",
        sessionId,
        warmId: entry.warmId,
        warmAgeMs: now - entry.spawnedAt,
        poolRemaining: this.warmPool.length,
      }),
    );
    return handle;
  }

  /** Current warm-pool size. Read by the pool service for hysteresis decisions. */
  getWarmCount(): number {
    return this.warmPool.length;
  }

  // ── Private helpers ─────────────────────────────────────────────────

  private cast(handle: SessionHandle): AciHandle {
    if (handle.__kind !== "aci") {
      throw new Error(`[aci] expected aci handle, got __kind=${handle.__kind}`);
    }
    return handle as AciHandle;
  }

  private async sidecarFetch<T = { ok: true }>(
    h: AciHandle,
    method: "GET" | "POST" | "DELETE",
    pathAndQuery: string,
    body?: unknown,
    timeoutMs: number = 30_000,
  ): Promise<T> {
    const url = `http://${h.privateIp}:${h.port}${pathAndQuery}`;
    const headers: Record<string, string> = {
      authorization: `Bearer ${h.bearerToken}`,
    };
    let payload: string | undefined;
    if (body !== undefined) {
      headers["content-type"] = "application/json";
      payload = JSON.stringify(body);
    }
    const res = await fetch(url, {
      method,
      headers,
      body: payload,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "<no body>");
      // Truncate for log hygiene; never include the bearer token in errors.
      throw new Error(
        `[aci] sidecar ${method} ${pathAndQuery} → ${res.status}: ${text.slice(0, 256)}`,
      );
    }
    return (await res.json()) as T;
  }

  private async waitForAgent(
    privateIp: string,
    port: number,
    bearerToken: string,
  ): Promise<void> {
    // Cold start: container group is Running but the agent process inside
    // may still be in `node` startup. Poll /health (which is unauth) until
    // we get 200, then a single auth-bearing call to confirm the bearer
    // path works end-to-end.
    const url = `http://${privateIp}:${port}/health`;
    const budget =
      this.opts.agentReadyTimeoutMs ?? DEFAULT_AGENT_READY_TIMEOUT_MS;
    const deadline = Date.now() + budget;
    let lastErr: Error | null = null;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(url, {
          signal: AbortSignal.timeout(1500),
        });
        if (res.ok) {
          // Auth round-trip: tries an authed call to prove bearer works.
          // Use /fileExists?path=__health_probe (cheap, doesn't mutate).
          const probe = await fetch(
            `http://${privateIp}:${port}/fileExists?path=__health_probe`,
            {
              headers: { authorization: `Bearer ${bearerToken}` },
              signal: AbortSignal.timeout(1500),
            },
          );
          if (probe.ok) return;
          lastErr = new Error(`auth probe → ${probe.status}`);
        }
      } catch (err) {
        lastErr = err as Error;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(
      `[aci] sidecar agent did not respond within budget: ${lastErr?.message ?? "unknown"}`,
    );
  }

  private async tryDelete(containerGroupName: string): Promise<void> {
    if (!this.client) return;
    try {
      // Fire-and-forget — beginDelete returns a poller, but we don't need
      // to wait. Azure cleans up async; if the API call fails, the operator
      // will see the lingering group via the cost-cap alert.
      await this.client.containerGroups.beginDelete(
        this.opts.resourceGroup,
        containerGroupName,
      );
    } catch (err) {
      console.error(
        JSON.stringify({
          level: "error",
          evt: "aci_delete_failed",
          containerGroupName,
          err: (err as Error).message,
        }),
      );
    }
  }
}
