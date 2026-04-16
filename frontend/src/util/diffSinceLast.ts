import type { ProjectFile } from "../types";

// Lightweight per-file diff used to tell the tutor what the student changed
// since the last tutor turn. We deliberately don't pull in a full Myers-diff
// library — the student's typical edit is a small burst in one region of one
// file, so "common prefix + changed region + common suffix" reads well and
// keeps prompt tokens low. Multi-region edits collapse into one diff hunk
// with unchanged lines in the middle, which a model handles fine.

const CONTEXT_LINES = 2;
const MAX_PATCH_LINES = 40;

function diffLines(oldStr: string, newStr: string): string {
  const oldLines = oldStr.split("\n");
  const newLines = newStr.split("\n");
  const oLen = oldLines.length;
  const nLen = newLines.length;

  let pre = 0;
  while (pre < oLen && pre < nLen && oldLines[pre] === newLines[pre]) pre++;

  let suf = 0;
  while (
    suf < oLen - pre &&
    suf < nLen - pre &&
    oldLines[oLen - 1 - suf] === newLines[nLen - 1 - suf]
  )
    suf++;

  const out: string[] = [];
  const preStart = Math.max(0, pre - CONTEXT_LINES);
  for (let i = preStart; i < pre; i++) {
    out.push(`  ${i + 1}: ${oldLines[i]}`);
  }
  for (let i = pre; i < oLen - suf; i++) {
    out.push(`- ${i + 1}: ${oldLines[i]}`);
  }
  for (let i = pre; i < nLen - suf; i++) {
    out.push(`+ ${i + 1}: ${newLines[i]}`);
  }
  const newSufStart = nLen - suf;
  const sufEnd = Math.min(nLen, newSufStart + CONTEXT_LINES);
  for (let i = newSufStart; i < sufEnd; i++) {
    out.push(`  ${i + 1}: ${newLines[i]}`);
  }

  if (out.length > MAX_PATCH_LINES) {
    return (
      out.slice(0, MAX_PATCH_LINES).join("\n") +
      `\n… [truncated, ${out.length - MAX_PATCH_LINES} more diff lines]`
    );
  }
  return out.join("\n");
}

export function computeDiffSinceLast(
  prev: Record<string, string> | null,
  curr: ProjectFile[],
): string | null {
  if (!prev) return null;

  const currMap = new Map(curr.map((f) => [f.path, f.content]));
  const prevPaths = new Set(Object.keys(prev));

  const chunks: string[] = [];
  for (const [path, content] of currMap) {
    if (!prevPaths.has(path)) {
      chunks.push(`--- ${path} (ADDED) ---\n${content.split("\n").slice(0, 20).join("\n")}`);
      continue;
    }
    if (prev[path] === content) continue;
    chunks.push(`--- ${path} (MODIFIED) ---\n${diffLines(prev[path], content)}`);
  }
  for (const path of prevPaths) {
    if (!currMap.has(path)) {
      chunks.push(`--- ${path} (REMOVED) ---`);
    }
  }

  if (chunks.length === 0) return "(no file edits since last tutor turn)";
  return chunks.join("\n\n");
}
