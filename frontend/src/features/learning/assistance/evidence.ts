import type { RunResult } from "../../../types";
import type { AssistanceEvidenceCode } from "../types";

export interface AssistanceEvidence {
  code: AssistanceEvidenceCode;
  key: string;
  path: string;
  line: number;
  label: "Syntax error";
}

const PYTHON_UNCLOSED_PARENTHESIS = /SyntaxError:\s*['"]\(['"]\s+was never closed/i;
const PYTHON_LOCATION = /File\s+["']([^"']+)["'],\s+line\s+(\d+)/g;

function resolveProjectPath(rawPath: string, projectPaths: readonly string[]): string | null {
  const normalized = rawPath.replaceAll("\\", "/");
  const exact = projectPaths.find((path) => normalized === path);
  if (exact) return exact;

  // Prefer the most specific suffix. A project may contain both `main.py`
  // and `examples/main.py`; runner paths such as `/workspace/examples/main.py`
  // must not bind the evidence to whichever basename happens to appear first.
  return (
    projectPaths
      .filter((path) => normalized.endsWith(`/${path}`))
      .sort((left, right) => right.length - left.length)[0] ?? null
  );
}

/**
 * Converts runner output into a small allowlisted evidence vocabulary. Raw
 * stderr is deliberately never returned: policy and authored copy must not be
 * driven by arbitrary execution output.
 */
export function normalizeRunEvidence(
  result: RunResult | null,
  projectPaths: readonly string[],
): AssistanceEvidence | null {
  if (
    result?.stage !== "compile" ||
    result.errorType !== "compile" ||
    !result.stderr ||
    !PYTHON_UNCLOSED_PARENTHESIS.test(result.stderr)
  ) {
    return null;
  }

  const locations = [...result.stderr.matchAll(PYTHON_LOCATION)];
  const location = locations.at(-1);
  if (!location) return null;

  const path = resolveProjectPath(location[1], projectPaths);
  const line = Number.parseInt(location[2], 10);
  if (!path || !Number.isSafeInteger(line) || line < 1) return null;

  const code: AssistanceEvidenceCode = "python-unclosed-parenthesis";
  return {
    code,
    key: `${code}:${path}:${line}`,
    path,
    line,
    label: "Syntax error",
  };
}
