import { useRef, useState } from "react";
import { Modal } from "./Modal";
import { currentSnapshotJson, pasteSnapshot } from "../util/progressSnapshot";

// User-facing Export / Import for the same allow-listed localStorage data the
// dev profile switcher operates on. Lets learners round-trip their progress
// between browsers without a backend. Import is destructive (replaces current
// state), so it goes through a confirm modal and a full page reload so all
// Zustand stores re-hydrate cleanly.
export function ProgressIOControls() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingImport, setPendingImport] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exportedAt, setExportedAt] = useState<number | null>(null);

  const handleExport = () => {
    setError(null);
    try {
      const json = currentSnapshotJson();
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const stamp = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `codetutor-progress-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setExportedAt(Date.now());
      setTimeout(() => setExportedAt((t) => (t === Date.now() ? null : t)), 2500);
    } catch (e) {
      setError(`Export failed: ${(e as Error).message}`);
    }
  };

  const handlePickFile = () => {
    setError(null);
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      setPendingImport(text);
    } catch (err) {
      setError(`Could not read file: ${(err as Error).message}`);
    }
  };

  const confirmImport = () => {
    if (pendingImport === null) return;
    try {
      pasteSnapshot(pendingImport);
    } catch (err) {
      setError((err as Error).message);
      setPendingImport(null);
      return;
    }
    setPendingImport(null);
    window.location.reload();
  };

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium text-muted">Progress</span>
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={handleExport}
          className="rounded-md border border-border bg-elevated px-2.5 py-1 text-[11px] font-medium text-ink transition hover:border-accent/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Export progress
        </button>
        <button
          type="button"
          onClick={handlePickFile}
          className="rounded-md border border-border bg-elevated px-2.5 py-1 text-[11px] font-medium text-ink transition hover:border-accent/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Import progress…
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={handleFileChange}
          aria-hidden="true"
        />
      </div>
      <span className="text-[10px] leading-relaxed text-faint">
        Downloads or restores lesson progress as a JSON file. API keys, theme, and layout
        preferences are never included.
      </span>
      {exportedAt && (
        <span className="text-[10px] text-success" role="status" aria-live="polite">
          Exported.
        </span>
      )}
      {error && (
        <span className="text-[10px] text-danger" role="status" aria-live="polite">
          {error}
        </span>
      )}
      {pendingImport !== null && (
        <Modal
          onClose={() => setPendingImport(null)}
          role="alertdialog"
          labelledBy="import-progress-title"
          position="center"
          panelClassName="mx-4 w-full max-w-sm rounded-xl border border-warn/30 bg-panel p-5 shadow-xl"
        >
          <h2 id="import-progress-title" className="text-sm font-bold text-ink">
            Replace current progress?
          </h2>
          <p className="mt-2 text-xs leading-relaxed text-muted">
            Importing will overwrite all lesson progress, saved code, and practice state in this
            browser with the contents of the file. This can't be undone.
          </p>
          <div className="mt-4 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPendingImport(null)}
              className="flex-1 rounded-lg border border-border px-4 py-2 text-xs font-medium text-muted transition hover:bg-elevated hover:text-ink"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmImport}
              className="flex-1 rounded-lg bg-warn/20 px-4 py-2 text-xs font-semibold text-warn ring-1 ring-warn/40 transition hover:bg-warn/30"
            >
              Replace
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
