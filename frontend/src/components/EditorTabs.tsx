import { useProjectStore } from "../state/projectStore";
import { fileIcon } from "../util/fileIcon";

// Horizontal tab strip above the editor. Mirrors VSCode-style ergonomics:
// click to switch, X or middle-click to close, active tab visually merges
// into the editor below by sharing its bg color.
export function EditorTabs() {
  const { openTabs, activeFile, setActive, closeTab } = useProjectStore();

  if (openTabs.length === 0) return null;

  return (
    <div className="flex shrink-0 overflow-x-auto border-b border-border bg-panel">
      {openTabs.map((path) => {
        const icon = fileIcon(path);
        const isActive = path === activeFile;
        const name = path.split("/").pop() ?? path;
        return (
          <div
            key={path}
            onClick={() => setActive(path)}
            onAuxClick={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                closeTab(path);
              }
            }}
            title={path}
            className={`group flex cursor-pointer items-center gap-1.5 border-r border-border px-3 py-1.5 text-xs transition ${
              isActive
                ? "bg-bg text-ink"
                : "text-muted hover:bg-elevated/60 hover:text-ink"
            }`}
          >
            <span className={`font-mono text-[10px] font-semibold ${icon.color}`}>
              {icon.label}
            </span>
            <span className="max-w-[180px] truncate font-mono">{name}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                closeTab(path);
              }}
              title="Close"
              className={`ml-1 rounded px-1 text-[10px] leading-none transition ${
                isActive
                  ? "text-muted hover:bg-danger/20 hover:text-danger"
                  : "text-faint opacity-0 hover:bg-danger/20 hover:text-danger group-hover:opacity-100"
              }`}
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}
