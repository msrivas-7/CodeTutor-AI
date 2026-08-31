export interface ProjectFilePath {
  path: string;
}

/**
 * Return the single project-relative path used by the execution backend.
 * This deliberately mirrors safeResolve's accepted path language so trust
 * boundaries and filesystem writes cannot disagree about file identity.
 */
export function canonicalProjectFilePath(rawPath: string): string | null {
  const cleaned = rawPath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (cleaned === "" || cleaned.includes("..")) return null;

  const segments = cleaned.split("/").filter((segment) => segment !== "" && segment !== ".");
  if (segments.length === 0 || segments.some((segment) => segment.startsWith("-"))) {
    return null;
  }
  return segments.join("/");
}

/**
 * A project snapshot has one authoritative value per path. Duplicate paths
 * are ambiguous because execution backends replace them in order while
 * readers commonly select the first match.
 */
export function hasUniqueProjectFilePaths(
  files: readonly ProjectFilePath[],
): boolean {
  const seen = new Set<string>();
  for (const file of files) {
    const canonicalPath = canonicalProjectFilePath(file.path);
    if (
      canonicalPath === null ||
      file.path !== canonicalPath ||
      seen.has(canonicalPath)
    ) return false;
    seen.add(canonicalPath);
  }
  return true;
}

export const UNIQUE_PROJECT_FILE_PATHS_MESSAGE =
  "project file paths must be canonical and unique";
