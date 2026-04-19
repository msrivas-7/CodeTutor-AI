import { useState } from "react";
import { useProjectStore } from "../state/projectStore";
import { LANGUAGE_ENTRYPOINT } from "../types";
import { fileIcon } from "../util/fileIcon";
import { Modal } from "./Modal";

export function FileTree({ onCollapse }: { onCollapse?: () => void }) {
  const { order, activeFile, language, openFile, createFile, deleteFile, renameFile } =
    useProjectStore();

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

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
            type="button"
            tabIndex={0}
            title={`main = entrypoint for the current language (${entrypoint})\nDouble-click a filename to rename.`}
            aria-label="File tree help — main is the entrypoint for the current language; double-click a filename to rename"
            className="rounded px-1.5 text-[10px] font-semibold text-muted transition hover:bg-elevated hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <span aria-hidden="true">?</span>
          </button>
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
                  onBlur={() => {
                    setRenaming(null);
                    setErr(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename(p);
                    if (e.key === "Escape") {
                      setRenaming(null);
                      setErr(null);
                    }
                  }}
                  title="Enter to save, Esc or click away to cancel"
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
                    if (order.length <= 1) {
                      setErr("Keep at least one file — it's the entrypoint.");
                      return;
                    }
                    setErr(null);
                    setPendingDelete(p);
                  }}
                  title={`Delete ${p}`}
                  aria-label={`Delete ${p}`}
                  className="ml-0.5 inline-block shrink-0 rounded px-1.5 py-1 text-muted transition hover:bg-danger/20 hover:text-danger focus:outline-none focus-visible:ring-2 focus-visible:ring-danger md:hidden md:px-1 md:py-0.5 md:group-hover:inline-block md:group-focus-within:inline-block"
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

      {err && (
        <div role="alert" className="mt-2 text-[11px] text-danger">
          {err}
        </div>
      )}

      {pendingDelete && (
        <Modal
          onClose={() => setPendingDelete(null)}
          role="alertdialog"
          labelledBy="delete-file-title"
          position="center"
          panelClassName="mx-4 w-full max-w-sm rounded-xl border border-danger/30 bg-panel p-5 shadow-xl"
        >
          <h2 id="delete-file-title" className="text-sm font-bold text-ink">
            Delete file?
          </h2>
          <p className="mt-2 text-xs leading-relaxed text-muted">
            Permanently delete <span className="font-mono font-semibold text-ink">{pendingDelete}</span>? This can't be undone.
          </p>
          <div className="mt-4 flex items-center gap-2">
            <button
              onClick={() => setPendingDelete(null)}
              className="flex-1 rounded-lg border border-border px-4 py-2 text-xs font-medium text-muted transition hover:bg-elevated hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                deleteFile(pendingDelete);
                setPendingDelete(null);
              }}
              className="flex-1 rounded-lg bg-danger/20 px-4 py-2 text-xs font-semibold text-danger ring-1 ring-danger/40 transition hover:bg-danger/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-danger"
            >
              Delete
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
