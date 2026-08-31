import path from "node:path";
import { canonicalProjectFilePath } from "../../schema/projectFiles.js";

/**
 * Normalise a file path relative to the workspace. Rejects traversal (`..`),
 * absolute paths, and anything that would escape the session workspace.
 * Shared between the ExecutionBackend file-I/O methods — it's the single
 * choke point for path validation.
 */
export function safeResolve(workspace: string, relative: string): string {
  const cleaned = canonicalProjectFilePath(relative);
  if (cleaned === null) {
    throw new Error(`invalid path: "${relative}"`);
  }
  const resolved = path.resolve(workspace, cleaned);
  if (!resolved.startsWith(path.resolve(workspace) + path.sep)) {
    throw new Error(`path escapes workspace: "${relative}"`);
  }
  return resolved;
}
