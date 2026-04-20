import { config } from "../../../config.js";
import { LocalDockerBackend } from "./localDocker.js";
import type { ExecutionBackend } from "./types.js";

/**
 * Select the execution backend impl based on `EXECUTION_BACKEND` env.
 * Today only `local-docker` is implemented; cloud variants (`ecs-fargate`,
 * `aks`, `aci`) are the future drop-in slots.
 */
export function makeExecutionBackend(): ExecutionBackend {
  const kind = process.env.EXECUTION_BACKEND ?? "local-docker";
  switch (kind) {
    case "local-docker":
      return new LocalDockerBackend({
        runnerImage: config.runnerImage,
        workspaceRoot: config.workspaceRoot,
        runner: {
          memoryBytes: config.runner.memoryBytes,
          nanoCpus: config.runner.nanoCpus,
        },
        hostWorkspaceRootOverride: config.hostWorkspaceRootOverride,
      });
    default:
      throw new Error(
        `unknown EXECUTION_BACKEND: "${kind}". Known: local-docker`,
      );
  }
}

export type {
  ExecutionBackend,
  ExecOptions,
  ExecResult,
  RuntimeSpec,
  SessionHandle,
  WorkspaceFile,
} from "./types.js";
