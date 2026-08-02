import { useState, type Ref } from "react";
import {
  beginProjectOperation,
  isProjectOperationCurrent,
  useProjectStore,
  starterStdin,
} from "../state/projectStore";
import { useSessionStore } from "../state/sessionStore";
import { useRunStore } from "../state/runStore";
import { abortSessionRequests, api } from "../api/client";
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
  const { running, stopping, stdin, setStdin } = useRunStore();
  const keys = useShortcutLabels();
  const [pendingLang, setPendingLang] = useState<Language | null>(null);

  const canRun = Boolean(sessionId) && phase === "active" && !running;

  const handleRun = async () => {
    if (!sessionId) return;
    const operation = beginProjectOperation();
    if (!useRunStore.getState().beginRun(operation.id)) return;
    try {
      const files = snapshot();
      await api.snapshotProject(sessionId, files);
      if (!isProjectOperationCurrent(operation)) return;
      const result = await api.execute(sessionId, language, stdin || undefined);
      if (!isProjectOperationCurrent(operation)) return;
      useRunStore.getState().commitRunResult(operation.id, result);
    } catch (err) {
      if (isProjectOperationCurrent(operation)) {
        useRunStore.getState().commitRunError(operation.id, (err as Error).message);
      }
    } finally {
      useRunStore.getState().finishRun(operation.id);
    }
  };

  const handleStop = async () => {
    if (!sessionId || !useRunStore.getState().requestStop()) return;
    try {
      await api.cancelExecution(sessionId);
      abortSessionRequests(sessionId);
      useRunStore.getState().finishStop();
    } catch (error) {
      useRunStore.getState().failStop(
        `Couldn't stop the run yet. It will still end at the safety limit. ${(error as Error).message}`,
      );
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
          className="min-h-11 appearance-none rounded-lg border border-border bg-elevated px-3 py-2 pr-8 text-sm text-ink transition hover:border-accent/60"
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
        onClick={running ? handleStop : handleRun}
        disabled={stopping || (!running && !canRun)}
        className={`group flex min-h-11 items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition ${
          running && !stopping
            ? "bg-danger/15 text-danger ring-1 ring-danger/40 hover:bg-danger/25"
            : canRun
              ? "bg-success/15 text-success ring-1 ring-success/40 hover:bg-success/25 hover:shadow-glow"
            : "cursor-not-allowed bg-elevated text-muted ring-1 ring-border"
        }`}
        title={running ? "Stop the running program" : canRun ? `Run project (${keys.run})` : "Waiting for session…"}
      >
        <span className="text-sm">
          {running ? (
            <span className="inline-flex items-center gap-1.5">
              <span className={`inline-block h-2 w-2 rounded-sm ${stopping ? "animate-pulse bg-muted" : "bg-danger"}`} />
              {stopping ? "Stopping…" : "Stop"}
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
          <h2 id="lang-switch-title" className="text-lg font-bold text-ink">
            Switch to {LANGUAGE_LABEL[pendingLang]}?
          </h2>
          <p className="mt-2 text-base leading-relaxed text-muted sm:text-body">
            This replaces your current project files with the{" "}
            <span className="font-semibold text-ink">{LANGUAGE_LABEL[pendingLang]}</span>{" "}
            starter. Any unsaved code in the editor will be lost.
          </p>
          <div className="mt-4 flex items-center gap-2">
            <button
              onClick={() => setPendingLang(null)}
              className="min-h-11 flex-1 rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted transition hover:bg-elevated hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Cancel
            </button>
            <button
              onClick={confirmLanguageSwitch}
              className="min-h-11 flex-1 rounded-lg bg-warn/20 px-4 py-2 text-sm font-semibold text-warn ring-1 ring-warn/40 transition hover:bg-warn/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warn"
            >
              Switch
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
