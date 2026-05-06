// Phase 24B: ACI hybrid burst overflow.
//
// When the local Docker session count hits config.session.maxGlobal (5 on
// B2s, 14 on B2ms — see config.ts for the SKU/cap pairing),
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
//   C3  capDrop ALL             HostConfig.CapDrop         ACI default cap set (NOT tightenable)
//   C4  readonly rootfs         HostConfig.ReadonlyRootfs  emptyDir-only writes; image has no setuid
//   C5  no-new-privileges       SecurityOpt                structural: non-root + no setuid in image
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
import { aciSpawnAttempts, aciSpawnDuration } from "../../metrics.js";
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
  /**
   * P0-2: callback returning the live daily $ cap (admin-editable via
   * system_config). When set, every spawn (cold or warm) calls
   * `aciCostTracker.tryReserve(...)` BEFORE asking ARM, atomically
   * incrementing projected spend so concurrent spawns can't both pass
   * a cap check that one of them is about to invalidate. When null/
   * undefined, no reservation is taken (used by tests + local-only
   * harnesses that aren't wired to operational config).
   */
  getDailyUsdCap?: () => number;
  /**
   * P2-5 (second-audit fix): delay before kicking the boot-time orphan
   * reaper. Production: 30 s so initial traffic settles before we hit
   * ARM with delete pressure. Tests: 0 so the reaper fires synchronously
   * after `ensureReady()` resolves.
   */
  orphanReapDelayMs?: number;
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

// P3-2 (audit fix): Azure ACI container-group names are validated as
// lowercase letters, digits, and hyphens. nanoid()'s default alphabet
// (`A-Za-z0-9_-`) emits uppercase and underscores, so a fraction of
// session IDs would have failed at ARM with `InvalidContainerGroupName`
// — surfacing as `fail_arm` metrics with no obvious cause. Sanitize
// the session-id portion of the ARM resource name to lowercase + hyphen.
// The transformation is N→1 in theory (e.g., "A_b" and "a-b" both map
// to "a-b"), but nanoid IDs are 12 chars and the sessionManager's
// uniqueness check (in-memory map by sessionId) prevents two
// concurrent sessions from colliding here in practice.
function sanitizeForArm(id: string): string {
  return id.toLowerCase().replace(/_/g, "-");
}

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

  // P3-2 (audit fix): cache the last successful isAlive ARM call per
  // session so kickReap() — which fans out across N candidates — doesn't
  // hit ARM N times every minute. Cache is alive-only: a "dead" answer
  // is never cached because we want the next call to re-check (the
  // session might have just been recreated). 30 s TTL matches the
  // session-manager sweep cadence so we're never staler than the next
  // sweep would have been anyway.
  private readonly aliveCache = new Map<string, number>();
  // P2-4 (second-audit fix): periodic prune handle for the aliveCache.
  // Started inside ensureReady so it shares the backend's lifecycle.
  private aliveCachePruneTimer: NodeJS.Timeout | null = null;

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

    // P0-3: reap any container groups left over from a previous backend
    // process. After a SIGTERM/OOM/deploy, Azure still has the groups
    // running (and billing); without this they'd accumulate until the
    // operator notices via the cost-cap alert. Reap is best-effort —
    // failures log + continue so a transient ARM hiccup doesn't block
    // the boot path.
    //
    // P2-5 (second-audit fix): delay the reap so initial traffic has a
    // chance to settle before we hit ARM with delete pressure. Pre-fix
    // the reaper started concurrently with the first /exec requests;
    // combined ARM load triggered 429s and inflated fail_arm metrics
    // during deploy windows. Tests pass `orphanReapDelayMs: 0` so the
    // reaper fires synchronously after `ensureReady()` resolves.
    const reapDelayMs = this.opts.orphanReapDelayMs ?? 30_000;
    const fireReap = () => {
      this.reapOrphans().catch((err) => {
        console.error(
          JSON.stringify({
            level: "error",
            evt: "aci_orphan_reap_failed",
            err: (err as Error).message,
          }),
        );
      });
    };
    if (reapDelayMs <= 0) {
      fireReap();
    } else {
      setTimeout(fireReap, reapDelayMs).unref();
    }

    // P2-4 (audit fix): periodic eviction of stale aliveCache entries.
    // Without this, the cache grows monotonically across the process
    // lifetime as session names cycle through. Sweep every 5 min and
    // drop any entry older than 2× ALIVE_CACHE_TTL_MS (60 s).
    if (!this.aliveCachePruneTimer) {
      this.aliveCachePruneTimer = setInterval(() => {
        const cutoff = Date.now() - 60_000;
        for (const [name, ts] of this.aliveCache) {
          if (ts < cutoff) this.aliveCache.delete(name);
        }
      }, 5 * 60_000);
      if (this.aliveCachePruneTimer.unref) this.aliveCachePruneTimer.unref();
    }
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

  /**
   * Test-only: drop the alive-cache so the next isAlive call goes back
   * to ARM regardless of when the last successful check was. Production
   * callers should NEVER use this — the cache is the whole point of
   * P3-2.
   */
  __clearAliveCacheForTests(): void {
    this.aliveCache.clear();
  }

  // ── Session lifecycle ───────────────────────────────────────────────

  async createSession(spec: RuntimeSpec): Promise<SessionHandle> {
    if (!this.client) {
      throw new Error("[aci] backend not ready — ensureReady() not called");
    }

    const spawnStart = Date.now();

    // Phase 24B Slice 8: warm-pool fast path. If a pre-spawned container
    // is waiting, claim it instead of cold-starting fresh. Latency drops
    // from 5–15s to ~1 ms. Single-use: claimed containers do NOT return
    // to the pool when the session ends (workspace + tmpfs accumulate
    // state across learners → cross-tenant data leak otherwise).
    const claimed = this.tryClaimWarm(spec.sessionId);
    if (claimed) {
      // P1-9 metric: warm-pool claim, near-zero latency.
      aciSpawnAttempts.inc({ result: "warm_claim" });
      aciSpawnDuration.observe(
        { path: "warm_claim" },
        (Date.now() - spawnStart) / 1000,
      );
      return claimed;
    }

    // P0-2: atomic cost-cap reservation. If the cap would be exceeded
    // (factoring in concurrent in-flight spawns), refuse before paying
    // ARM the spawn cost. Reserve up to one hour of billing as a
    // conservative upper bound; the real session usually ends sooner.
    let reservationId: string | null = null;
    if (this.opts.getDailyUsdCap) {
      const cap = this.opts.getDailyUsdCap();
      reservationId = aciCostTracker.tryReserve(60 * 60 * 1000, cap);
      if (reservationId === null) {
        // P1-9 metric: cap-refusal is its own outcome bucket — operator
        // wants to distinguish "we ran out of money" from "Azure broke."
        aciSpawnAttempts.inc({ result: "fail_cap" });
        throw new Error("aci_cost_cap_reached");
      }
    }

    const containerGroupName = `codetutor-ai-aci-${sanitizeForArm(spec.sessionId)}`;
    let spawned: { privateIp: string; port: number; bearerToken: string };
    try {
      spawned = await this.spawnContainerGroup(containerGroupName);
    } catch (err) {
      // Spawn failed — release the reservation so the cap accumulator
      // doesn't permanently inflate by a $0.053 ghost charge.
      if (reservationId !== null) {
        aciCostTracker.cancelReservation(reservationId);
      }
      // P1-9 metric: classify failure cause from message shape. ARM
      // errors come from beginCreateOrUpdateAndWait; agent errors come
      // from waitForAgent's "did not respond within budget" raise.
      const msg = (err as Error).message;
      const result = msg.includes("sidecar agent did not respond")
        ? "fail_agent"
        : "fail_arm";
      aciSpawnAttempts.inc({ result });
      // P3-4 (audit fix): structured log line so alerts.bicep's
      // scheduled-query rule can key on `evt:aci_spawn_failure` and
      // surface ARM-throttle / agent-unresponsive bursts that the Prom
      // counter alone wouldn't reach (no Prom scraper wired today).
      console.error(
        JSON.stringify({
          level: "error",
          evt: "aci_spawn_failure",
          result,
          err: msg,
        }),
      );
      throw err;
    }

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
    aciCostTracker.recordSessionStart(
      handle.sessionId,
      handle.createdAt,
      reservationId ?? undefined,
    );
    // P1-9 metric: cold-path success + duration histogram. Drives the
    // P2-1 budget-tuning decision (do we have enough slack at P99?).
    aciSpawnAttempts.inc({ result: "cold_success" });
    aciSpawnDuration.observe(
      { path: "cold" },
      (Date.now() - spawnStart) / 1000,
    );
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
          // ACI accepts ONLY the `privileged` flag in securityContext —
          // the API rejects the entire spawn with "Some SecurityContext
          // properties in container 'runner' is not supported. Only the
          // 'Privileged' flag is supported." if any other field is set.
          //
          // The other LocalDocker hardening (C1/C3/C4/C5) is preserved
          // by the runner image itself rather than the ACI spec:
          //  • runAsUser=1100, runAsNonRoot — `USER runner` (UID/GID
          //    1100) baked into runner-image/Dockerfile.
          //  • readOnlyRootFilesystem — emptyDir mounts at /tmp and
          //    /workspace are the only intended write paths; the rest
          //    of the rootfs is image content (learner code runs as
          //    UID 1100 with no write perms outside those mounts).
          //  • allowPrivilegeEscalation/capabilities.drop ALL — ACI's
          //    container runtime applies its own restricted capability
          //    set by default; we can't tighten further. Combined with
          //    privileged=false + non-root + the build-time setuid
          //    strip in the runner image (find / -xdev … chmod a-s),
          //    the no-new-privs equivalent is structural: there is
          //    NOTHING in the image to escalate against. Verified by
          //    e2e/security-suite/scenarios/S2_privileges.spec.ts S2f.
          securityContext: {
            privileged: false,
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

    // P3-2: short-circuit on a recent successful liveness check. Only
    // cache the ALIVE answer — a "dead" answer never short-circuits so
    // a later isAlive after destroy() always re-asks ARM.
    const ALIVE_CACHE_TTL_MS = 30_000;
    const cachedAt = this.aliveCache.get(h.containerGroupName);
    if (cachedAt && Date.now() - cachedAt < ALIVE_CACHE_TTL_MS) {
      return true;
    }

    let state: string | undefined;
    try {
      const group = await this.client.containerGroups.get(
        this.opts.resourceGroup,
        h.containerGroupName,
      );
      state = group.instanceView?.state;
    } catch {
      // 404 / network blip / SDK throw — treat as dead. The session manager
      // will reap on the next sweep.
      return false;
    }
    // Running OR Pending counts as alive at the ARM level. Failed/Succeeded/
    // (undefined) → dead.
    if (state !== "Running" && state !== "Pending") return false;

    // P1-9 (audit fix): ARM-level "Running" is necessary but not sufficient.
    // The container group can be Running while the agent process inside has
    // crashed (OOM, segfault, hung event loop). Pre-fix, sessionManager would
    // happily route exec calls to a dead agent until the user complained.
    // Probe the agent /health endpoint with a tight 1 s budget — agent is
    // local-LAN-fast (< 50 ms typical) so 1 s is generous slack without
    // making isAlive itself a latency hotspot.
    const AGENT_PROBE_BUDGET_MS = 1_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AGENT_PROBE_BUDGET_MS);
    try {
      // P2-3 (audit fix): /health is unauth — sending the bearer token
      // here is unnecessary and adds a forward-looking risk: any future
      // request-logger / debug hook on the agent would silently log
      // valid bearer tokens against an endpoint that doesn't actually
      // require credentials. The auth round-trip happens once during
      // waitForAgent (see line 821); subsequent liveness checks just
      // need to know the agent is listening.
      const res = await fetch(`http://${h.privateIp}:${h.port}/health`, {
        method: "GET",
        signal: controller.signal,
      });
      if (res.ok) {
        // P3-2: prime the cache so the next caller (within 30 s) skips
        // both ARM and the agent probe.
        this.aliveCache.set(h.containerGroupName, Date.now());
        return true;
      }
      return false;
    } catch {
      // Timeout / connection refused / agent crashed mid-response: treat
      // as dead so sessionManager reaps it. ARM said Running, but the
      // agent is unresponsive — the session is effectively useless.
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  async destroy(handle: SessionHandle): Promise<void> {
    const h = this.cast(handle);
    this.active.delete(h.sessionId);
    // P3-2: drop the alive-cache entry so a re-spawned group with the
    // same name (rare but possible if sessionId is reused) doesn't read
    // a stale alive=true.
    this.aliveCache.delete(h.containerGroupName);
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
    // P0-2: warm spawns also count against the daily $ cap (Azure starts
    // billing the moment the container group is created, regardless of
    // whether a learner has claimed it). Reserve before paying ARM.
    let reservationId: string | null = null;
    if (this.opts.getDailyUsdCap) {
      const cap = this.opts.getDailyUsdCap();
      reservationId = aciCostTracker.tryReserve(60 * 60 * 1000, cap);
      if (reservationId === null) {
        // Cap is at-or-above limit; warm-pool sit-out tick. The pool
        // service retries on the next tick and will succeed if other
        // sessions complete in the interim.
        return false;
      }
    }
    this.warmSpawnSeq += 1;
    const warmId = `aci-warm-${Date.now()}-${this.warmSpawnSeq}`;
    // P3-2: warm IDs are already lowercase + digits + hyphens, but wrap
    // through sanitizeForArm anyway so future renames stay safe by default.
    const containerGroupName = `codetutor-ai-aci-${sanitizeForArm(warmId)}`;
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
      aciCostTracker.recordSessionStart(
        warmId,
        entry.spawnedAt,
        reservationId ?? undefined,
      );
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
      if (reservationId !== null) {
        aciCostTracker.cancelReservation(reservationId);
      }
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
    // we get 200, then declare the agent ready. The first real /exec call
    // validates the bearer end-to-end; any mismatch surfaces there as a
    // 401 at sidecarFetch which the route handler maps to a user-visible
    // 5xx + structured log.
    //
    // Z-P2-1 (third-audit fix): dropped the auth-bearing /fileExists probe
    // that previously ran here. It was sending the bearer token over
    // plaintext HTTP at the moment the container's network namespace is
    // most likely to be in a transitional state (DNS race during cold-
    // start, possibly visible to ARM diagnostic infrastructure). Bearer-
    // mismatch detection moves from cold-start to first-real-request,
    // which is acceptable because: (a) the spawn-failure metric still
    // surfaces it (just one /exec call later), (b) a token-mismatch bug
    // is a regression-class issue caught in CI before deploy, not an
    // expected runtime condition.
    void bearerToken;
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
        if (res.ok) return;
        lastErr = new Error(`health probe → ${res.status}`);
      } catch (err) {
        lastErr = err as Error;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(
      `[aci] sidecar agent did not respond within budget: ${lastErr?.message ?? "unknown"}`,
    );
  }

  /**
   * P0-3 (audit fix): actually wait for the delete to land at Azure.
   *
   * Previously this called `beginDelete` and awaited only the poller-
   * creation promise — control returned to the caller while ARM was
   * still processing the delete. On a SIGTERM the process exited
   * before Azure finished, leaving an orphan container group billing
   * forever (Azure has no client-driven TTL on stopped groups).
   *
   * Now: `beginDeleteAndWait` blocks until ARM reports the delete
   * complete, capped by a 30 s budget. On budget exhaustion we log
   * + return — the boot-time reaper at next start will catch it.
   * Errors are similarly absorbed: cost-cap + alert visibility is
   * the operator's safety net for any group we couldn't reach.
   */
  private async tryDelete(containerGroupName: string): Promise<void> {
    if (!this.client) return;
    const TRY_DELETE_BUDGET_MS = 30_000;
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), TRY_DELETE_BUDGET_MS);
    });
    try {
      const result = await Promise.race([
        this.client.containerGroups
          .beginDeleteAndWait(this.opts.resourceGroup, containerGroupName)
          .then(() => "ok" as const),
        deadline,
      ]);
      if (result === "timeout") {
        console.error(
          JSON.stringify({
            level: "error",
            evt: "aci_delete_timeout",
            containerGroupName,
            budgetMs: TRY_DELETE_BUDGET_MS,
          }),
        );
      }
    } catch (err) {
      console.error(
        JSON.stringify({
          level: "error",
          evt: "aci_delete_failed",
          containerGroupName,
          err: (err as Error).message,
        }),
      );
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * P0-3 (audit fix): boot-time orphan reaper. After a backend restart,
   * any container group from the previous process is by definition an
   * orphan — Express has no record of it, no learner is connected,
   * and Azure is still billing it. List all groups in the RG with our
   * naming prefix and delete each one.
   *
   * Naming contract:
   *   - cold-start sessions: `codetutor-ai-aci-${sessionId}`
   *   - warm-pool slots:     `codetutor-ai-aci-aci-warm-${ts}-${seq}`
   * Both share the prefix, so a single startsWith check covers them.
   *
   * Concurrency cap of 5 to avoid saturating ARM with parallel deletes
   * on a backend that just spent 30+ minutes spinning up.
   */
  async reapOrphans(): Promise<{ found: number; deleted: number }> {
    if (!this.client) return { found: 0, deleted: 0 };
    const PREFIX = "codetutor-ai-aci-";
    // P2-5 (second-audit fix): adaptive concurrency. If the backend is
    // serving live traffic when the reaper fires (post-deploy window
    // where boot completed quickly + a learner already started a
    // session), shrink to 1-wide so we share ARM bandwidth. Idle
    // backends get the original 5-wide for fast cleanup.
    const REAP_CONCURRENCY =
      this.active.size > 0 || this.warmPool.length > 0 ? 1 : 5;

    const candidates: string[] = [];
    try {
      for await (const group of this.client.containerGroups.listByResourceGroup(
        this.opts.resourceGroup,
      )) {
        if (group.name && group.name.startsWith(PREFIX)) {
          candidates.push(group.name);
        }
      }
    } catch (err) {
      console.error(
        JSON.stringify({
          level: "error",
          evt: "aci_orphan_reap_list_failed",
          err: (err as Error).message,
        }),
      );
      return { found: 0, deleted: 0 };
    }

    if (candidates.length === 0) {
      return { found: 0, deleted: 0 };
    }

    // Race protection: the reaper runs in parallel with the backend
    // accepting new sessions. By the time we get to the per-candidate
    // delete, a new session may have spawned a container that ARM
    // already returned in the listing snapshot — or that we'd otherwise
    // re-list. Skip anything present in `this.active` OR the warm pool
    // at delete-time so our own newly-spawned groups never get reaped.
    const isOwnedNow = (name: string): boolean => {
      for (const h of this.active.values()) {
        if (h.containerGroupName === name) return true;
      }
      for (const w of this.warmPool) {
        if (w.containerGroupName === name) return true;
      }
      return false;
    };

    let deleted = 0;
    const queue = [...candidates];
    const workers: Promise<void>[] = [];
    for (let i = 0; i < Math.min(REAP_CONCURRENCY, queue.length); i++) {
      workers.push(
        (async () => {
          while (queue.length > 0) {
            const name = queue.shift();
            if (!name) break;
            if (isOwnedNow(name)) {
              // A session spawned between our list snapshot and now —
              // not an orphan, leave it alone.
              continue;
            }
            await this.tryDelete(name);
            // P2-4: clear any leftover aliveCache entry for this name.
            // Pre-fix the cache only got cleaned on `destroy()`; reaped
            // orphans persisted entries that nothing in this process
            // would ever access again.
            this.aliveCache.delete(name);
            // tryDelete absorbs errors; treat every successful return as
            // "best-effort completed". The next boot's reap is the
            // safety net for any group that didn't actually delete.
            // `deleted++` is atomic across the JS event loop — `before+1`
            // would race because workers' `before` reads can interleave
            // with each other across the await boundary above.
            deleted++;
            console.log(
              JSON.stringify({
                level: "info",
                evt: "aci_orphan_reaped",
                containerGroupName: name,
              }),
            );
          }
        })(),
      );
    }
    await Promise.all(workers);

    console.log(
      JSON.stringify({
        level: "info",
        evt: "aci_orphan_reap_done",
        found: candidates.length,
        deleted,
      }),
    );
    return { found: candidates.length, deleted };
  }
}
