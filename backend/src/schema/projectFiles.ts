export interface ProjectFilePath {
  path: string;
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
    if (seen.has(file.path)) return false;
    seen.add(file.path);
  }
  return true;
}

export const UNIQUE_PROJECT_FILE_PATHS_MESSAGE =
  "project file paths must be unique";
