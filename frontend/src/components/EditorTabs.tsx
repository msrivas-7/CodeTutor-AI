import { useAIStore } from "../state/aiStore";
import { useProjectStore } from "../state/projectStore";
import { fileIcon } from "../util/fileIcon";

// Horizontal tab strip above the editor. Mirrors VSCode-style ergonomics:
// click to switch, X or middle-click to close, active tab visually merges
// into the editor below by sharing its bg color.
export function EditorTabs() {
  const { openTabs, activeFile, setActive, closeTab } = useProjectStore();
  const keyStatus = useAIStore((s) => s.keyStatus);
  const selectedModel = useAIStore((s) => s.selectedModel);
  const asking = useAIStore((s) => s.asking);
  const setPendingAsk = useAIStore((s) => s.setPendingAsk);
  const tutorReady = keyStatus === "valid" && !!selectedModel;

  if (openTabs.length === 0) return null;

  const walkPrompt = activeFile
    ? `Walk me through ${activeFile}, one step at a time.`
    : null;

  return (
    <div className="flex shrink-0 items-center overflow-x-auto border-b border-border bg-panel">
      <div className="flex flex-1 overflow-x-auto">
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
      {walkPrompt && tutorReady && (
        <button
          onClick={() => setPendingAsk(walkPrompt)}
          disabled={asking}
          title={`Ask the tutor to walk through ${activeFile} step by step`}
          className="mx-2 shrink-0 rounded-md border border-accent/40 bg-accent/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-accent transition hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-accent/10"
        >
          Walk me through this →
        </button>
      )}
    </div>
  );
}
