import { useEffect, useState, type Ref } from "react";
import { useProjectStore, starterStdin } from "../state/projectStore";
import { useSessionStore } from "../state/sessionStore";
import { useRunStore } from "../state/runStore";
import { api } from "../api/client";
import { LANGUAGES, LANGUAGE_LABEL, type Language } from "../types";

interface ToolbarProps {
  langPickerRef?: Ref<HTMLLabelElement>;
  runButtonRef?: Ref<HTMLButtonElement>;
}

export function Toolbar({ langPickerRef, runButtonRef }: ToolbarProps = {}) {
  const { language, resetToStarter, snapshot } = useProjectStore();
  const sessionId = useSessionStore((s) => s.sessionId);
  const phase = useSessionStore((s) => s.phase);
  const { running, setRunning, setResult, setError, stdin, setStdin } = useRunStore();
  const [isMac, setIsMac] = useState(true);

  useEffect(() => {
    setIsMac(/Mac|iPhone|iPad/i.test(navigator.platform));
  }, []);

  const canRun = Boolean(sessionId) && phase === "active" && !running;
  const shortcut = isMac ? "⌘↵" : "Ctrl+↵";

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
    if (
      confirm(
        `Switch to ${LANGUAGE_LABEL[next]}? This replaces the current project with the ${LANGUAGE_LABEL[next]} starter.`
      )
    ) {
      resetToStarter(next);
      // Starters read stdin; pre-fill the textarea so first-run "just works".
      setStdin(starterStdin(next));
    }
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
        title={canRun ? `Run project (${shortcut})` : "Waiting for session…"}
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
        {canRun && !running && <span className="kbd">{shortcut}</span>}
      </button>
    </div>
  );
}
