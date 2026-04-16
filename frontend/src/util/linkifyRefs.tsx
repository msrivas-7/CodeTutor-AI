import { Fragment, type ReactNode } from "react";

// Matches the three source-location shapes we see in stderr and in tutor
// prose:
//   Python:    File "main.py", line 12
//   Generic:   main.py:12  or  main.py:12:5  or  src/main.rs:12:5
// The generic path may include a directory prefix; the extension list covers
// every language this project runs.
const REF_REGEX =
  /(?:File\s+"([^"]+)",\s*line\s+(\d+))|((?:[\w.\\/-]*[\\/])?[\w.-]+\.(?:py|pyw|js|mjs|cjs|jsx|ts|tsx|go|rs|rb|c|cpp|cc|cxx|h|hpp|hh|java)):(\d+)(?::(\d+))?/g;

function resolvePath(candidate: string, knownPaths: string[]): string | null {
  if (knownPaths.includes(candidate)) return candidate;
  // Stack traces often print absolute or repo-relative paths
  // (e.g. `/workspace/main.go`, `./src/main.rs`). Fall back to basename match
  // when that uniquely identifies a project file.
  const base = candidate.replace(/^.*[\\/]/, "");
  const byBase = knownPaths.filter(
    (p) => p === base || p.replace(/^.*[\\/]/, "") === base,
  );
  return byBase.length === 1 ? byBase[0] : null;
}

export function linkifyRefs(
  text: string,
  knownPaths: string[],
  onJump: (path: string, line: number, column?: number) => void,
): ReactNode {
  if (!text) return text;

  const out: ReactNode[] = [];
  let lastEnd = 0;
  let key = 0;

  REF_REGEX.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = REF_REGEX.exec(text)) !== null) {
    const [full, pyPath, pyLine, genPath, genLine, genCol] = m;

    let path: string | null = null;
    let line = 0;
    let column: number | undefined;

    if (pyPath !== undefined) {
      path = resolvePath(pyPath, knownPaths);
      line = Number(pyLine);
    } else if (genPath !== undefined) {
      path = resolvePath(genPath, knownPaths);
      line = Number(genLine);
      column = genCol !== undefined ? Number(genCol) : undefined;
    }

    if (!path || !line) continue;

    if (m.index > lastEnd) {
      out.push(<Fragment key={key++}>{text.slice(lastEnd, m.index)}</Fragment>);
    }
    const resolvedPath = path;
    const resolvedLine = line;
    const resolvedColumn = column;
    out.push(
      <button
        key={key++}
        onClick={() => onJump(resolvedPath, resolvedLine, resolvedColumn)}
        className="text-accent underline decoration-dotted underline-offset-2 transition hover:decoration-solid"
        title={`Jump to ${resolvedPath}:${resolvedLine}${resolvedColumn ? `:${resolvedColumn}` : ""}`}
      >
        {full}
      </button>,
    );
    lastEnd = m.index + full.length;
  }

  if (out.length === 0) return text;
  if (lastEnd < text.length) {
    out.push(<Fragment key={key++}>{text.slice(lastEnd)}</Fragment>);
  }
  return out;
}
