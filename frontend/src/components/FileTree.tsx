import { useState } from "react";
import { useProjectStore } from "../state/projectStore";
import { LANGUAGE_ENTRYPOINT } from "../types";
import { fileIcon } from "../util/fileIcon";

export function FileTree({ onCollapse }: { onCollapse?: () => void }) {
  const { order, activeFile, language, openFile, createFile, deleteFile, renameFile } =
    useProjectStore();

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const entrypoint = LANGUAGE_ENTRYPOINT[language];

  const commitCreate = () => {
    const trimmed = newName.trim();
    if (!trimmed) {
      setCreating(false);
      setNewName("");
      return;
    }
    const result = createFile(trimmed);
    if (!result.ok) {
      setErr(result.error ?? "create failed");
      return;
    }
    setErr(null);
    setCreating(false);
    setNewName("");
  };

  const commitRename = (from: string) => {
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === from) {
      setRenaming(null);
      return;
    }
    const result = renameFile(from, trimmed);
    if (!result.ok) {
      setErr(result.error ?? "rename failed");
      return;
    }
    setErr(null);
    setRenaming(null);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">
          Files
        </span>
        <div className="flex items-center gap-1">
          <button
            title="New file"
            onClick={() => {
              setCreating(true);
              setNewName("");
            }}
            className="rounded p-1 text-muted transition hover:bg-elevated hover:text-ink"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
              <path d="M7 2v5H2v2h5v5h2V9h5V7H9V2H7z" />
            </svg>
          </button>
          {onCollapse && (
            <button
              onClick={onCollapse}
              title="Collapse files"
              className="rounded p-1 text-muted transition hover:bg-elevated hover:text-ink"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                <path d="M5.5 3.5L10 8l-4.5 4.5L4 11l3-3-3-3z" />
              </svg>
            </button>
          )}
        </div>
      </div>

      <ul className="flex-1 space-y-0.5 overflow-y-auto">
        {order.map((p) => {
          const isEntry = p === entrypoint;
          const isActive = p === activeFile;
          const icon = fileIcon(p);
          if (renaming === p) {
            return (
              <li key={p}>
                <input
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={() => commitRename(p)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename(p);
                    if (e.key === "Escape") setRenaming(null);
                  }}
                  className="w-full rounded bg-elevated px-2 py-1 font-mono text-xs text-ink outline-none ring-1 ring-accent"
                />
              </li>
            );
          }
          return (
            <li key={p}>
              <div
                className={`group flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition ${
                  isActive
                    ? "bg-elevated text-ink ring-1 ring-border"
                    : "text-muted hover:bg-elevated/60 hover:text-ink"
                }`}
              >
                <span
                  className={`w-7 shrink-0 font-mono text-[10px] font-semibold ${icon.color}`}
                >
                  {icon.label}
                </span>
                <button
                  onClick={() => openFile(p)}
                  onDoubleClick={() => {
                    setRenaming(p);
                    setRenameValue(p);
                  }}
                  className="flex-1 truncate text-left font-mono"
                  title={`${p}${isEntry ? " — entrypoint" : ""}`}
                >
                  {p}
                </button>
                {isEntry && (
                  <span
                    title="Required entrypoint"
                    className="rounded bg-accent/15 px-1 text-[9px] font-semibold uppercase tracking-wider text-accent"
                  >
                    main
                  </span>
                )}
                <button
                  onClick={() => {
                    if (confirm(`Delete ${p}?`)) deleteFile(p);
                  }}
                  title="Delete"
                  className="ml-0.5 hidden shrink-0 rounded px-1 py-0.5 text-muted transition hover:bg-danger/20 hover:text-danger group-hover:inline-block"
                >
                  ✕
                </button>
              </div>
            </li>
          );
        })}

        {creating && (
          <li>
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onBlur={commitCreate}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitCreate();
                if (e.key === "Escape") {
                  setCreating(false);
                  setNewName("");
                }
              }}
              placeholder="file.py"
              className="w-full rounded bg-elevated px-2 py-1 font-mono text-xs text-ink outline-none ring-1 ring-accent"
            />
          </li>
        )}
      </ul>

      {err && <div className="mt-2 text-[11px] text-danger">{err}</div>}
      <div className="mt-2 space-y-0.5 text-[10px] leading-tight text-faint">
        <div>
          <span className="rounded bg-accent/15 px-1 text-[9px] font-semibold uppercase tracking-wider text-accent">
            main
          </span>{" "}
          entrypoint for the current language
        </div>
        <div>
          <span className="kbd">dbl-click</span> to rename
        </div>
      </div>
    </div>
  );
}
