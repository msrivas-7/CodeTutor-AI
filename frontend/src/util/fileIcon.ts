// Per-extension accent color + two-to-three-letter label. Used by both the
// file tree and the editor tab strip so a file looks the same everywhere.
export function fileIcon(path: string): { label: string; color: string } {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "py": return { label: "py", color: "text-warn" };
    case "js": return { label: "js", color: "text-warn" };
    case "ts": return { label: "ts", color: "text-accent" };
    case "c": return { label: "c", color: "text-accent" };
    case "h": return { label: "h", color: "text-muted" };
    case "cpp":
    case "cc":
    case "cxx": return { label: "c++", color: "text-violet" };
    case "hpp": return { label: "hpp", color: "text-muted" };
    case "java": return { label: "java", color: "text-danger" };
    case "go": return { label: "go", color: "text-accent" };
    case "rs": return { label: "rs", color: "text-warn" };
    case "rb": return { label: "rb", color: "text-danger" };
    case "json": return { label: "{}", color: "text-success" };
    case "md": return { label: "md", color: "text-muted" };
    default: return { label: "•", color: "text-faint" };
  }
}
