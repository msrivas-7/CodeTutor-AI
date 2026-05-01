// Phase 24B: HybridBackend — routing wrapper.
//
// Holds two underlying ExecutionBackends (local + aci) and dispatches
// per call. New sessions go to local until local hits its cap; past
// that, overflow routes to ACI. Every other method (exec, writeFiles,
// destroy, etc.) dispatches on the handle's `__kind` discriminator —
// once a session is on a backend it stays there for its whole lifetime.
//
// The wrapper is transparent to all existing consumers of ExecutionBackend
// (routes, runHarness, runProject, sessionManager). They keep the same
// dependency-injection shape they had pre-Phase-24B: one ExecutionBackend
// from `makeExecutionBackend()`, threaded through. The hybrid behavior
// is invisible from the outside.

import type {
  ExecOptions,
  ExecResult,
  ExecutionBackend,
  RuntimeSpec,
  SessionHandle,
  WorkspaceFile,
} from "./types.js";
import type { AciExecutionBackend } from "./aci.js";

export interface HybridBackendOptions {
  /**
   * Sessions ≥ this count route to ACI. Matches `config.session.maxGlobal`
   * (the historical "local Docker hard cap" — now the routing threshold).
   * Counted against the local backend's active sessions, NOT the global
   * total, because ACI sessions don't compete with local for the local cap.
   */
  localCap: number;
  /**
   * Max concurrent ACI sessions (the "+ overflow" portion of the absolute
   * cap). Number for static use (e.g., tests) OR a getter for dynamic use
   * (factory passes `() => operationalConfig.maxOverflow` so admin-panel
   * changes take effect within the operational-config refresh interval).
   * When ACI overflow is gated off (via `isAciOverflowAllowed`), the
   * effective cap collapses back to `localCap` — see `effectiveCap()`.
   */
  aciCap: number | (() => number);
  /**
   * Gate on whether ACI overflow is currently permitted. Returns false
   * when (a) the runtime admin toggle is off OR (b) today's spend has hit
   * the daily cap. When this returns false, `effectiveCap()` collapses to
   * `localCap` so sessionManager 503s the 15th+ request rather than
   * letting it cascade into a broken ACI spawn.
   */
  isAciOverflowAllowed?: () => boolean;
}

export class HybridBackend implements ExecutionBackend {
  readonly kind = "hybrid";

  // Each backend's session count tracked here so the routing decision is
  // O(1) without asking the backend. Increment on createSession, decrement
  // on destroy. Drift would mean wrong routing — guarded by destroy()
  // always going through this wrapper (sessionManager calls
  // requireBackend().destroy(handle), which is the wrapper).
  private localActive = 0;
  private aciActive = 0;

  // P1-8 (audit fix): cache the ACI status for 30 s. Pre-fix every call
  // to /api/health/deep made a fresh ARM list call (60+ probes per hour
  // from webtests + the LA scheduled-query rules). At ~100ms per call
  // that's a meaningful chunk of ARM read budget AND a 30 s cache window
  // matches the alert evaluation cadence so we never serve stale truth.
  private aciStatusCache: {
    value: "ok" | "degraded" | "disabled";
    expiresAt: number;
  } | null = null;

  constructor(
    private readonly local: ExecutionBackend,
    private readonly aci: AciExecutionBackend | null,
    private readonly opts: HybridBackendOptions,
  ) {}

  // ── Lifecycle ───────────────────────────────────────────────────────

  async ensureReady(): Promise<void> {
    // Local is critical — refuse to boot without it. ACI is best-effort:
    // a transient Azure outage at boot shouldn't take the whole backend
    // down, since local-only is still fully functional. Log + continue.
    await this.local.ensureReady();
    if (this.aci) {
      try {
        await this.aci.ensureReady();
      } catch (err) {
        console.error(
          JSON.stringify({
            level: "error",
            evt: "aci_backend_unready_at_boot",
            err: (err as Error).message,
          }),
        );
        // We keep `this.aci` set so retries are possible later (ping/health
        // probe), but route() will treat a non-ready ACI the same as a
        // missing one (createSession surfaces the underlying error).
      }
    }
  }

  async ping(): Promise<void> {
    // Local is the critical path; ACI being unhealthy = degraded mode,
    // not an outage. Ping local only here so /api/health/deep doesn't
    // flip to 503 over an ACI hiccup. ACI status is exposed via a
    // separate field on the deep-health response.
    await this.local.ping();
  }

  /**
   * ACI status field for /api/health/deep. Pure read, never throws.
   * "ok"        — ACI is configured and the cost-cap allows new spawns
   * "degraded"  — ACI is configured but currently disabled (cost cap hit,
   *               kill switch on, etc). Overflow won't work; primary still does.
   * "disabled"  — ACI is not configured (flag off or Azure config missing).
   */
  async getAciStatus(): Promise<"ok" | "degraded" | "disabled"> {
    // Disabled and degraded checks are CHEAP local reads — never cache them.
    // Caching would let an admin's runtime kill switch take up to 30 s to
    // surface, which the operator would call "the kill switch is broken."
    if (!this.aci) return "disabled";
    if (!this.allow()) return "degraded";

    // P1-8: cached ARM ping. Hit the cache when fresh; otherwise pay the
    // ARM call but cap it at 3 s — without a timeout, an Azure regional
    // hiccup would let `/api/health/deep` block for the SDK's default
    // (10 s+), pushing webtests over their 5 s budget.
    const now = Date.now();
    if (this.aciStatusCache && this.aciStatusCache.expiresAt > now) {
      return this.aciStatusCache.value;
    }

    const ARM_PING_BUDGET_MS = 3_000;
    const STATUS_CACHE_TTL_MS = 30_000;
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), ARM_PING_BUDGET_MS);
    });

    let value: "ok" | "degraded";
    try {
      const result = await Promise.race([
        this.aci.ping().then(() => "ok" as const),
        deadline,
      ]);
      value = result === "ok" ? "ok" : "degraded";
    } catch {
      value = "degraded";
    } finally {
      if (timer) clearTimeout(timer);
    }
    this.aciStatusCache = { value, expiresAt: now + STATUS_CACHE_TTL_MS };
    return value;
  }

  queueDepth(): { inFlight: number; queued: number } {
    const l = this.local.queueDepth();
    const a = this.aci?.queueDepth() ?? { inFlight: 0, queued: 0 };
    return {
      inFlight: l.inFlight + a.inFlight,
      queued: l.queued + a.queued,
    };
  }

  /**
   * Phase 24B Slice 8: read of the locally-routed session count. Used by
   * aciWarmPoolService to decide when to pre-spawn / drain warm
   * containers. Not part of ExecutionBackend — this is a HybridBackend-
   * specific affordance.
   */
  getLocalActive(): number {
    return this.localActive;
  }

  /**
   * Phase 24B: dynamic absolute cap, evaluated on every startSession call.
   *   - ACI on + overflow allowed   → localCap + aciCap
   *   - ACI off OR cost-cap tripped → localCap only
   * sessionManager queries this before its 503 check so overflow actually
   * shrinks back to local-only when the kill switch fires. `aciCap` may
   * be a number (tests, static config) or a getter (factory wires it to
   * the admin-editable operational-config mirror).
   */
  effectiveCap(): number {
    if (!this.aci || !this.allow()) return this.opts.localCap;
    return this.opts.localCap + this.resolveAciCap();
  }

  private resolveAciCap(): number {
    return typeof this.opts.aciCap === "function"
      ? this.opts.aciCap()
      : this.opts.aciCap;
  }

  // ── Session lifecycle ───────────────────────────────────────────────

  async createSession(spec: RuntimeSpec): Promise<SessionHandle> {
    // P1-7 (audit fix): increment counters BEFORE awaiting createSession,
    // not after. Pre-fix, two concurrent calls would both observe
    // `localActive < cap`, both pass the route check, both await spawn,
    // and both increment afterwards — meaning N+1 sessions could land on
    // a backend whose cap was N. Now the second concurrent call sees
    // the first's reservation in localActive and either routes to ACI
    // or 503s correctly. On spawn failure we decrement; on success we
    // leave the counter where it is.
    if (this.shouldUseAci()) {
      this.aciActive += 1;
      try {
        const handle = await this.aci!.createSession(spec);
        console.log(
          JSON.stringify({
            level: "info",
            evt: "session_routed_aci",
            sessionId: spec.sessionId,
            localActive: this.localActive,
            aciActive: this.aciActive,
          }),
        );
        return handle;
      } catch (err) {
        this.aciActive -= 1;
        throw err;
      }
    }
    this.localActive += 1;
    try {
      return await this.local.createSession(spec);
    } catch (err) {
      this.localActive -= 1;
      throw err;
    }
  }

  async isAlive(handle: SessionHandle): Promise<boolean> {
    return this.dispatch(handle).isAlive(handle);
  }

  async destroy(handle: SessionHandle): Promise<void> {
    try {
      await this.dispatch(handle).destroy(handle);
    } finally {
      // Always decrement, even on destroy failure — the session is gone
      // from sessionManager either way; leaving the counter elevated
      // would slowly push routing to ACI for sessions that should've
      // fit locally.
      //
      // P1-7 (audit fix): no Math.max(0, …) clamp. Pre-fix the clamp
      // hid counter drift — if createSession failed AFTER the post-
      // increment but BEFORE the caller could destroy(), or if a
      // double-destroy slipped through, the counter would silently
      // go negative-then-clamped. Now any negative value surfaces in
      // the gauge below, alerting the operator that lifecycle invariants
      // are broken somewhere upstream.
      if (handle.__kind === "aci") {
        this.aciActive -= 1;
      } else {
        this.localActive -= 1;
      }
    }
  }

  /**
   * P1-7: drift signal for the metrics scrape. Returns the SUM of any
   * negative-going counter values (hybrid backend uses unclamped
   * decrements so drift becomes observable). A non-zero positive value
   * here = "we destroyed more sessions than we created on at least one
   * backend, which means lifecycle invariants are broken somewhere."
   * `0` is healthy.
   */
  getCounterDrift(): number {
    let drift = 0;
    if (this.localActive < 0) drift += -this.localActive;
    if (this.aciActive < 0) drift += -this.aciActive;
    return drift;
  }

  // ── Pass-through methods (dispatch on handle.__kind) ────────────────

  async exec(
    handle: SessionHandle,
    command: string,
    timeoutMs: number,
    opts?: ExecOptions,
  ): Promise<ExecResult> {
    return this.dispatch(handle).exec(handle, command, timeoutMs, opts);
  }

  async writeFiles(handle: SessionHandle, files: WorkspaceFile[]): Promise<void> {
    return this.dispatch(handle).writeFiles(handle, files);
  }

  async removeFiles(handle: SessionHandle, paths: string[]): Promise<void> {
    return this.dispatch(handle).removeFiles(handle, paths);
  }

  async fileExists(
    handle: SessionHandle,
    relativePath: string,
  ): Promise<boolean> {
    return this.dispatch(handle).fileExists(handle, relativePath);
  }

  async replaceSnapshot(
    handle: SessionHandle,
    files: WorkspaceFile[],
  ): Promise<void> {
    return this.dispatch(handle).replaceSnapshot(handle, files);
  }

  // ── Private helpers ─────────────────────────────────────────────────

  private allow(): boolean {
    return this.opts.isAciOverflowAllowed
      ? this.opts.isAciOverflowAllowed()
      : true;
  }

  private shouldUseAci(): boolean {
    if (!this.aci) return false;
    if (!this.allow()) return false;
    return this.localActive >= this.opts.localCap;
  }

  private dispatch(handle: SessionHandle): ExecutionBackend {
    if (handle.__kind === "aci") {
      if (!this.aci) {
        // Configuration drift — handle says ACI but ACI not wired.
        // Should never happen in normal flow because createSession is
        // the only producer of __kind="aci", and it requires this.aci.
        // If it does happen, surface clearly.
        throw new Error(
          "[hybrid] received ACI handle but ACI backend not configured",
        );
      }
      return this.aci;
    }
    return this.local;
  }
}
