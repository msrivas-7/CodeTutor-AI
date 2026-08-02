import { useProjectStore } from "../state/projectStore";
import { useSessionStore } from "../state/sessionStore";
import { useRunStore } from "../state/runStore";
import { useAIStore } from "../state/aiStore";
import { usePreferencesStore } from "../state/preferencesStore";
import { useAIStatus } from "../state/useAIStatus";
import { LANGUAGE_LABEL } from "../types";

const PHASE_DOT: Record<string, string> = {
  idle: "bg-faint",
  starting: "bg-warn animate-pulseDot",
  active: "bg-success",
  reconnecting: "bg-warn animate-pulseDot",
  error: "bg-danger",
  ended: "bg-faint",
};

const PHASE_LABEL: Record<string, string> = {
  idle: "Idle",
  starting: "Starting",
  active: "Active",
  reconnecting: "Reconnecting",
  error: "Error",
  ended: "Ended",
};

const ERR_STYLE: Record<string, string> = {
  none: "text-success",
  compile: "text-warn",
  runtime: "text-danger",
  timeout: "text-violet",
  system: "text-faint",
};

export function StatusBar() {
  const language = useProjectStore((s) => s.language);
  const activeFile = useProjectStore((s) => s.activeFile);
  const fileCount = useProjectStore((s) => s.order.length);
  const phase = useSessionStore((s) => s.phase);
  const sessionId = useSessionStore((s) => s.sessionId);
  const result = useRunStore((s) => s.result);
  const running = useRunStore((s) => s.running);
  const hasKey = usePreferencesStore((s) => s.hasOpenaiKey);
  const selectedModel = useAIStore((s) => s.selectedModel);
  const { status: aiStatus } = useAIStatus();
  const aiReady = hasKey || aiStatus?.source === "platform";

  return (
    <footer
      role="contentinfo"
      aria-label="Session status"
      className="flex min-h-7 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 overflow-x-auto border-t border-border bg-panel px-3 py-1 text-[11px] text-muted sm:gap-x-4 sm:flex-nowrap sm:py-0"
    >
      <div className="flex items-center gap-1.5">
        <span className={`inline-block h-2 w-2 rounded-full ${PHASE_DOT[phase]}`} />
        <span className="text-ink">{PHASE_LABEL[phase]}</span>
        {sessionId && (
          <span className="font-mono text-faint" title={`Session ${sessionId}`}>
            {sessionId.slice(0, 6)}
          </span>
        )}
      </div>

      <div className="h-3 w-px bg-border" />

      <div className="flex items-center gap-1.5">
        <span className="text-faint">Lang</span>
        <span className="text-ink">{LANGUAGE_LABEL[language]}</span>
      </div>

      <div className="flex items-center gap-1.5">
        <span className="text-faint">Files</span>
        <span className="text-ink">{fileCount}</span>
      </div>

      {activeFile && (
        <div className="hidden items-center gap-1.5 md:flex">
          <span className="text-faint">File</span>
          <span className="truncate font-mono text-ink" title={activeFile}>
            {activeFile}
          </span>
        </div>
      )}

      <div className="ml-auto flex items-center gap-4">
        {running && (
          <span className="flex items-center gap-1.5 text-accent">
            <span className="inline-block h-1.5 w-1.5 animate-pulseDot rounded-full bg-accent" />
            Running
          </span>
        )}
        {result && !running && (
          <span className="flex items-center gap-1.5">
            <span className="text-faint">Last run</span>
            <span className={ERR_STYLE[result.errorType]}>
              {result.errorType === "none" ? "ok" : result.errorType}
            </span>
            <span className="font-mono text-ink">{result.durationMs}ms</span>
            <span className="font-mono text-faint">exit {result.exitCode}</span>
          </span>
        )}

        <div className="h-3 w-px bg-border" />

        <div className="flex items-center gap-1.5">
          <span className="text-faint">AI</span>
          {aiStatus === null && !hasKey ? (
            <span className="text-muted">checking…</span>
          ) : aiReady ? (
            <span className="text-success">● ready</span>
          ) : (
            <span className="text-faint">not set</span>
          )}
          {selectedModel && (
            <span className="font-mono text-ink">{selectedModel}</span>
          )}
        </div>
      </div>
    </footer>
  );
}
