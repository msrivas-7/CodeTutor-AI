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
    if (!this.aci) return "disabled";
    if (!this.allow()) return "degraded";
    try {
      await this.aci.ping();
      return "ok";
    } catch {
      return "degraded";
    }
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
    if (this.shouldUseAci()) {
      const handle = await this.aci!.createSession(spec);
      this.aciActive += 1;
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
    }
    const handle = await this.local.createSession(spec);
    this.localActive += 1;
    return handle;
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
      if (handle.__kind === "aci") {
        this.aciActive = Math.max(0, this.aciActive - 1);
      } else {
        this.localActive = Math.max(0, this.localActive - 1);
      }
    }
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
