import { config } from "../../../config.js";
import { aciCostTracker } from "../../observability/aciCostTracker.js";
import { getAciOperationalConfig } from "../../observability/aciOperationalConfig.js";
import { LocalDockerBackend } from "./localDocker.js";
import { AciExecutionBackend } from "./aci.js";
import { HybridBackend } from "./hybrid.js";
import type { ExecutionBackend } from "./types.js";

/**
 * Result of the factory: the wired ExecutionBackend plus the absolute
 * session-count cap that sessionManager uses for its 503 trigger. With
 * ACI overflow enabled the cap is `local + maxOverflow`; without it the
 * cap stays at the local-only value. `aci` is exposed so observability
 * (cost sampler) can query it directly without re-walking the wrapper.
 */
export interface ExecutionBackendBundle {
  backend: ExecutionBackend;
  /** Total concurrent sessions before sessionManager 503s. */
  absoluteSessionCap: number;
  /** The ACI backend instance, if wired. Null when overflow is off / misconfigured. */
  aci: AciExecutionBackend | null;
}

/**
 * Build the execution backend stack. Always includes LocalDocker; adds
 * ACI overflow + the HybridBackend wrapper when ENABLE_ACI_OVERFLOW=1
 * AND the required Azure config is present. With ACI off, returns the
 * plain LocalDocker — same shape as pre-Phase-24B, no behavior change.
 */
export function makeExecutionBackend(): ExecutionBackendBundle {
  const local = new LocalDockerBackend({
    runnerImage: config.runnerImage,
    workspaceRoot: config.workspaceRoot,
    runner: {
      memoryBytes: config.runner.memoryBytes,
      nanoCpus: config.runner.nanoCpus,
    },
    hostWorkspaceRootOverride: config.hostWorkspaceRootOverride,
    dockerExecConcurrency: config.dockerExecConcurrency,
  });

  if (!config.aci.enabled) {
    console.log(
      JSON.stringify({
        level: "info",
        evt: "aci_overflow_off",
        reason: "flag_disabled",
      }),
    );
    return {
      backend: local,
      absoluteSessionCap: config.session.maxGlobal,
      aci: null,
    };
  }

  // Validate Azure-side config. Missing any → log + fall back to local-only.
  // Same observable behavior as flag=off, but the operator gets a clear
  // log line so the misconfiguration is debuggable.
  const aciImage = config.aci.runnerImage || config.runnerImage;
  const missing: string[] = [];
  if (!config.aci.subscriptionId) missing.push("AZURE_SUBSCRIPTION_ID");
  if (!config.aci.resourceGroup) missing.push("AZURE_RG");
  if (!config.aci.subnetId) missing.push("ACI_SUBNET_ID");
  if (!aciImage) missing.push("ACI_RUNNER_IMAGE/RUNNER_IMAGE");
  if (missing.length > 0) {
    console.warn(
      JSON.stringify({
        level: "warn",
        evt: "aci_overflow_off",
        reason: "missing_config",
        missing,
      }),
    );
    return {
      backend: local,
      absoluteSessionCap: config.session.maxGlobal,
      aci: null,
    };
  }

  const aci = new AciExecutionBackend({
    subscriptionId: config.aci.subscriptionId,
    resourceGroup: config.aci.resourceGroup,
    location: config.aci.location,
    subnetId: config.aci.subnetId,
    runnerImage: aciImage,
    sidecarPort: config.aci.sidecarPort,
    coldStartTimeoutMs: config.aci.coldStartTimeoutMs,
    memoryInGB: config.runner.memoryBytes / (1024 * 1024 * 1024),
    cpu: config.runner.nanoCpus / 1_000_000_000,
    // P0-2: atomic cost-cap reservation. Read the live admin-editable
    // cap; AciExecutionBackend.tryReserve() projects this spawn's
    // hourly bill against current spend on every cold-start AND every
    // warm-pool spawn, refusing the spawn if it would exceed the cap.
    getDailyUsdCap: () => getAciOperationalConfig().dailyUsdCap,
  });

  const hybrid = new HybridBackend(local, aci, {
    localCap: config.session.maxGlobal,
    // Phase 24B Slice 6.5: max-overflow is now an admin-editable knob,
    // mirrored synchronously by aciOperationalConfig. Pass a getter so
    // an admin shrinking the cap takes effect on the next routing
    // decision (within the operational-config refresh interval).
    aciCap: () => getAciOperationalConfig().maxOverflow,
    // Combined kill switch: (a) admin runtime toggle + (b) cost-cap.
    // When EITHER is off/tripped, overflow returns false →
    // HybridBackend's effectiveCap() collapses to localCap →
    // sessionManager 503s the 15th+ request instead of cascading into
    // ACI spawns the kill switches already vetoed.
    isAciOverflowAllowed: () => {
      const op = getAciOperationalConfig();
      if (!op.enabled) return false;
      return !aciCostTracker.exceedsDailyCap(op.dailyUsdCap);
    },
  });

  return {
    backend: hybrid,
    absoluteSessionCap: config.session.maxGlobal + config.aci.maxOverflow,
    aci,
  };
}

export type {
  ExecutionBackend,
  ExecOptions,
  ExecResult,
  RuntimeSpec,
  SessionHandle,
  WorkspaceFile,
} from "./types.js";
