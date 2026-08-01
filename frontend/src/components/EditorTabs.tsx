import { useAIStore } from "../state/aiStore";
import { usePreferencesStore } from "../state/preferencesStore";
import { useProjectStore } from "../state/projectStore";
import { useAIStatus } from "../state/useAIStatus";
import { fileIcon } from "../util/fileIcon";

// Horizontal tab strip above the editor. Mirrors VSCode-style ergonomics:
// click to switch; in editor mode X or middle-click closes a tab.
//
// Phase 22F2 prep — `mode` prop: in `"lesson"` mode we hide the close
// affordances (no X button, no middle-click handler). Lesson starter
// files are part of the curated experience; a beginner accidentally
// closing helper.py and getting "ModuleNotFoundError" on Run is exactly
// the friction we want to remove. Recovery via "Reset Code" still
// exists as a backstop. Free-roam editor mode keeps full freedom.
export interface EditorTabsProps {
  mode?: "editor" | "lesson";
}

export function EditorTabs({ mode = "editor" }: EditorTabsProps = {}) {
  const { openTabs, activeFile, setActive, closeTab } = useProjectStore();
  const hasKey = usePreferencesStore((s) => s.hasOpenaiKey);
  const selectedModel = useAIStore((s) => s.selectedModel);
  const asking = useAIStore((s) => s.asking);
  const setPendingAsk = useAIStore((s) => s.setPendingAsk);
  const requestTutorOpen = useAIStore((s) => s.requestTutorOpen);
  const { status } = useAIStatus();
  const onPlatform = status?.source === "platform";
  const tutorReady = onPlatform || (hasKey && !!selectedModel);
  const allowClose = mode === "editor";

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
            onAuxClick={
              allowClose
                ? (e) => {
                    if (e.button === 1) {
                      e.preventDefault();
                      closeTab(path);
                    }
                  }
                : undefined
            }
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
            <span className="max-w-[180px] truncate font-mono" aria-label={path}>{name}</span>
            {allowClose && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(path);
                }}
                title={`Close ${name}`}
                aria-label={`Close ${name}`}
                className={`ml-1 rounded px-1 text-[10px] leading-none transition ${
                  isActive
                    ? "text-muted hover:bg-danger/20 hover:text-danger"
                    : "text-faint hover:bg-danger/20 hover:text-danger"
                }`}
              >
                ✕
              </button>
            )}
          </div>
        );
      })}
      </div>
      {walkPrompt && tutorReady && (
        <button
          onClick={() => {
            requestTutorOpen();
            setPendingAsk(walkPrompt);
          }}
          disabled={asking}
          title={asking ? "Tutor is replying — try again in a moment." : `Walk through ${activeFile} step by step`}
          aria-label={asking ? `Walk me through ${activeFile} (tutor busy)` : `Walk me through ${activeFile}`}
          className="mx-2 shrink-0 rounded-md border border-accent/40 bg-accent/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-accent transition hover:bg-accent/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-accent/10"
        >
          Walk me through this →
        </button>
      )}
    </div>
  );
}
