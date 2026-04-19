import { useState, type Ref } from "react";
import { useProjectStore, starterStdin } from "../state/projectStore";
import { useSessionStore } from "../state/sessionStore";
import { useRunStore } from "../state/runStore";
import { api } from "../api/client";
import { LANGUAGES, LANGUAGE_LABEL, type Language } from "../types";
import { useShortcutLabels } from "../util/platform";
import { Modal } from "./Modal";

interface ToolbarProps {
  langPickerRef?: Ref<HTMLLabelElement>;
  runButtonRef?: Ref<HTMLButtonElement>;
}

export function Toolbar({ langPickerRef, runButtonRef }: ToolbarProps = {}) {
  const { language, resetToStarter, snapshot } = useProjectStore();
  const sessionId = useSessionStore((s) => s.sessionId);
  const phase = useSessionStore((s) => s.phase);
  const { running, setRunning, setResult, setError, stdin, setStdin } = useRunStore();
  const keys = useShortcutLabels();
  const [pendingLang, setPendingLang] = useState<Language | null>(null);

  const canRun = Boolean(sessionId) && phase === "active" && !running;

  const handleRun = async () => {
    if (!sessionId) return;
    setRunning(true);
    setError(null);
    try {
      const files = snapshot();
      await api.snapshotProject(sessionId, files);
      const result = await api.execute(sessionId, language, stdin || undefined);
      setResult(result);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const handleLanguageChange = (next: Language) => {
    if (next === language) return;
    setPendingLang(next);
  };

  const confirmLanguageSwitch = () => {
    if (!pendingLang) return;
    resetToStarter(pendingLang);
    setStdin(starterStdin(pendingLang));
    setPendingLang(null);
  };

  return (
    <div className="flex items-center gap-2">
      <label ref={langPickerRef} className="relative">
        <select
          value={language}
          onChange={(e) => handleLanguageChange(e.target.value as Language)}
          className="appearance-none rounded-md border border-border bg-elevated px-2.5 py-1 pr-7 text-xs text-ink transition hover:border-accent/60"
          aria-label="Language"
        >
          {LANGUAGES.map((l) => (
            <option key={l} value={l}>
              {LANGUAGE_LABEL[l]}
            </option>
          ))}
        </select>
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted">
          ▾
        </span>
      </label>

      <button
        ref={runButtonRef}
        onClick={handleRun}
        disabled={!canRun}
        className={`group flex items-center gap-2 rounded-md px-3 py-1 text-xs font-semibold transition ${
          canRun
            ? "bg-success/15 text-success ring-1 ring-success/40 hover:bg-success/25 hover:shadow-glow"
            : "cursor-not-allowed bg-elevated text-muted ring-1 ring-border"
        }`}
        title={canRun ? `Run project (${keys.run})` : "Waiting for session…"}
      >
        <span className="text-[11px]">
          {running ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-1.5 w-1.5 animate-pulseDot rounded-full bg-success" />
              Running
            </span>
          ) : (
            "▶ Run"
          )}
        </span>
        {canRun && !running && <kbd className="kbd">{keys.run}</kbd>}
      </button>

      {pendingLang && (
        <Modal
          onClose={() => setPendingLang(null)}
          role="alertdialog"
          labelledBy="lang-switch-title"
          position="center"
          panelClassName="mx-4 w-full max-w-sm rounded-xl border border-warn/30 bg-panel p-5 shadow-xl"
        >
          <h2 id="lang-switch-title" className="text-sm font-bold text-ink">
            Switch to {LANGUAGE_LABEL[pendingLang]}?
          </h2>
          <p className="mt-2 text-xs leading-relaxed text-muted">
            This replaces your current project files with the{" "}
            <span className="font-semibold text-ink">{LANGUAGE_LABEL[pendingLang]}</span>{" "}
            starter. Any unsaved code in the editor will be lost.
          </p>
          <div className="mt-4 flex items-center gap-2">
            <button
              onClick={() => setPendingLang(null)}
              className="flex-1 rounded-lg border border-border px-4 py-2 text-xs font-medium text-muted transition hover:bg-elevated hover:text-ink"
            >
              Cancel
            </button>
            <button
              onClick={confirmLanguageSwitch}
              className="flex-1 rounded-lg bg-warn/20 px-4 py-2 text-xs font-semibold text-warn ring-1 ring-warn/40 transition hover:bg-warn/30"
            >
              Switch
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
