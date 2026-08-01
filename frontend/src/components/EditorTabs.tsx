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
      <div
        role="toolbar"
        aria-label="Open files"
        className="flex flex-1 overflow-x-auto"
      >
      {openTabs.map((path) => {
        const icon = fileIcon(path);
        const isActive = path === activeFile;
        const name = path.split("/").pop() ?? path;
        return (
          <div
            key={path}
            role="presentation"
            className={`group flex shrink-0 items-center border-r border-border transition ${
              isActive
                ? "bg-bg text-ink"
                : "text-muted hover:bg-elevated/60 hover:text-ink"
            }`}
          >
            <button
              type="button"
              onClick={() => setActive(path)}
              onKeyDown={(event) => {
                if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
                  return;
                }
                event.preventDefault();
                const tabs = Array.from(
                  event.currentTarget
                    .closest('[role="toolbar"]')
                    ?.querySelectorAll<HTMLButtonElement>('[data-editor-file]') ?? [],
                );
                const current = tabs.indexOf(event.currentTarget);
                const next = event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? tabs.length - 1
                    : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length)
                      % tabs.length;
                const nextTab = tabs[next];
                const nextPath = openTabs[next];
                if (nextTab && nextPath) {
                  setActive(nextPath);
                  nextTab.focus();
                }
              }}
              onAuxClick={
                allowClose
                  ? (event) => {
                      if (event.button === 1) {
                        event.preventDefault();
                        closeTab(path);
                      }
                    }
                  : undefined
              }
              title={path}
              data-editor-file
              tabIndex={isActive ? 0 : -1}
              aria-pressed={isActive}
              aria-label={isActive ? `Active file ${path}` : `Open file ${path}`}
              className="flex min-h-11 items-center gap-1.5 px-3 py-1.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
            >
              <span className={`font-mono text-[10px] font-semibold ${icon.color}`}>
                {icon.label}
              </span>
              <span className="max-w-[180px] truncate font-mono" aria-label={path}>{name}</span>
            </button>
            {allowClose && (
              <button
                type="button"
                onClick={(e) => {
                  const tabList = e.currentTarget.closest('[role="toolbar"]');
                  closeTab(path);
                  requestAnimationFrame(() => {
                    tabList
                      ?.querySelector<HTMLButtonElement>(
                        '[data-editor-file][aria-pressed="true"]',
                      )
                      ?.focus();
                  });
                }}
                title={`Close ${name}`}
                aria-label={`Close ${name}`}
                className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded text-[10px] leading-none transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger ${
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
          className="mx-2 min-h-11 shrink-0 rounded-md border border-accent/40 bg-accent/10 px-2.5 py-2 text-[10px] font-semibold uppercase tracking-wider text-accent transition hover:bg-accent/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-accent/10"
        >
          Walk me through this →
        </button>
      )}
    </div>
  );
}
