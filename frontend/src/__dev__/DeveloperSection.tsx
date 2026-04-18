// The "Developer" block that appears inside SettingsPanel when dev mode is
// on. Stripped from prod by import.meta.env.DEV dead-code elimination at the
// SettingsPanel call site.

import { useState } from "react";
import { currentSnapshotJson } from "./applyProfile";
import { useDevModeStore, profileForId } from "./devModeStore";
import { PROFILES } from "./profiles";

export function DeveloperSection() {
  const { enabled, activeProfileId, applyProfileById, reapplyCurrent, exitActive, clearAll, pasteSnapshot, disable } =
    useDevModeStore();

  const [selected, setSelected] = useState<string>(activeProfileId ?? PROFILES[0].id);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  if (!enabled) return null;

  const activeProfile = profileForId(activeProfileId);
  const selectedProfile = profileForId(selected);

  const flashToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 1800);
  };

  const handleApply = () => {
    if (!selectedProfile) return;
    const activeIsSandbox = activeProfile && !activeProfile.frozen;
    if (activeIsSandbox && selected !== activeProfileId) {
      if (!window.confirm("Leave sandbox? Its state will be saved — switching back restores it.")) return;
    }
    applyProfileById(selected);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(currentSnapshotJson());
      flashToast("Snapshot copied");
    } catch {
      flashToast("Clipboard unavailable");
    }
  };

  const handlePasteApply = () => {
    setPasteError(null);
    try {
      pasteSnapshot(pasteText);
    } catch (e) {
      setPasteError((e as Error).message);
      return;
    }
    setPasteOpen(false);
    setPasteText("");
  };

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-violet/30 bg-violet/5 p-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-violet">
          Developer — dev profiles
        </span>
        <span className="text-[10px] text-faint">Cmd+Shift+Alt+D to exit</span>
      </div>

      <div className="text-[11px] leading-relaxed text-ink/80">
        Active:{" "}
        {activeProfile ? (
          <>
            <code className="rounded bg-elevated px-1 py-0.5 font-mono text-[10px] text-violet">
              {activeProfile.label}
            </code>{" "}
            <span className="text-faint">
              [{activeProfile.frozen ? "frozen" : "sandbox"}]
            </span>
          </>
        ) : (
          <span className="text-faint">none (real user mode)</span>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-[10px] font-medium uppercase tracking-wide text-muted">
          Profile
        </label>
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="rounded-md border border-border bg-elevated px-2.5 py-1.5 text-xs text-ink transition hover:border-violet/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet"
        >
          {PROFILES.map((p, i) => (
            <option key={p.id} value={p.id}>
              {i + 1}. {p.label} {p.frozen ? "" : "— persistent"}
            </option>
          ))}
        </select>
        {selectedProfile && (
          <p className="text-[10px] leading-relaxed text-faint">
            {selectedProfile.description}
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        <button
          onClick={handleApply}
          className="rounded-md bg-violet px-2.5 py-1 text-[11px] font-semibold text-bg transition hover:bg-violet/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet"
        >
          Apply
        </button>
        <button
          onClick={reapplyCurrent}
          disabled={!activeProfile}
          title={activeProfile ? "Re-apply the current profile's seed (resets frozen state)" : "No profile active"}
          className="rounded-md border border-violet/40 px-2.5 py-1 text-[11px] font-semibold text-violet transition hover:bg-violet/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet disabled:opacity-40"
        >
          Re-apply
        </button>
        <button
          onClick={exitActive}
          disabled={!activeProfile}
          title="Restore your real user state (dev mode stays on)"
          className="rounded-md border border-border px-2.5 py-1 text-[11px] font-semibold text-ink transition hover:border-violet/40 hover:text-violet focus:outline-none focus-visible:ring-2 focus-visible:ring-violet disabled:opacity-40"
        >
          Exit profile
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5 border-t border-violet/20 pt-2">
        <button
          onClick={handleCopy}
          className="rounded-md border border-border px-2.5 py-1 text-[10px] font-medium text-muted transition hover:border-violet/40 hover:text-violet focus:outline-none focus-visible:ring-2 focus-visible:ring-violet"
        >
          Snapshot → clipboard
        </button>
        <button
          onClick={() => setPasteOpen((v) => !v)}
          className="rounded-md border border-border px-2.5 py-1 text-[10px] font-medium text-muted transition hover:border-violet/40 hover:text-violet focus:outline-none focus-visible:ring-2 focus-visible:ring-violet"
        >
          {pasteOpen ? "Cancel paste" : "Paste snapshot"}
        </button>
        <button
          onClick={() => {
            if (window.confirm("Wipe ALL lesson/progress state? (API keys + theme preserved.)")) {
              clearAll();
            }
          }}
          className="rounded-md border border-danger/40 px-2.5 py-1 text-[10px] font-medium text-danger transition hover:bg-danger/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-danger"
        >
          Clear everything
        </button>
        <button
          onClick={() => {
            if (window.confirm("Disable dev mode and restore your real user state?")) {
              disable();
            }
          }}
          className="ml-auto rounded-md border border-border px-2.5 py-1 text-[10px] font-medium text-muted transition hover:border-ink hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Disable dev mode
        </button>
      </div>

      {pasteOpen && (
        <div className="flex flex-col gap-1.5 rounded-md border border-border bg-elevated p-2">
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder="Paste a snapshot JSON blob here…"
            rows={4}
            className="w-full resize-y rounded border border-border bg-bg px-2 py-1 font-mono text-[10px] text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-violet"
          />
          {pasteError && (
            <span className="text-[10px] text-danger">{pasteError}</span>
          )}
          <button
            onClick={handlePasteApply}
            disabled={!pasteText.trim()}
            className="self-start rounded-md bg-violet px-2.5 py-1 text-[10px] font-semibold text-bg transition hover:bg-violet/80 disabled:opacity-40"
          >
            Apply snapshot
          </button>
        </div>
      )}

      {toast && (
        <div className="text-[10px] text-violet" role="status" aria-live="polite">
          {toast}
        </div>
      )}

      <p className="text-[10px] leading-relaxed text-faint">
        Frozen profiles auto-restore on every reload — great for verifying one UI state. Sandbox
        persists across sessions under its own snapshot slot, so multi-step walkthroughs aren't lost.
      </p>
    </div>
  );
}
