import { useState } from "react";
import { useRunStore } from "../state/runStore";
import { useProjectStore } from "../state/projectStore";
import { linkifyRefs } from "../util/linkifyRefs";
import { useShortcutLabels } from "../util/platform";
import type { ErrorType } from "../types";

const TYPE_LABEL: Record<ErrorType, string> = {
  none: "OK",
  compile: "Compile error",
  runtime: "Runtime error",
  timeout: "Timed out",
  system: "System error",
};

const TYPE_STYLE: Record<ErrorType, string> = {
  none: "bg-success/15 text-success ring-success/30",
  compile: "bg-warn/15 text-warn ring-warn/30",
  runtime: "bg-danger/15 text-danger ring-danger/30",
  timeout: "bg-violet/15 text-violet ring-violet/40",
  system: "bg-muted/15 text-muted ring-muted/30",
};

type Tab = "combined" | "stdout" | "stderr" | "stdin";

export function OutputPanel() {
  const { running, result, error, stdin, setStdin } = useRunStore();
  const { order, revealAt } = useProjectStore();
  const [tab, setTab] = useState<Tab>("combined");
  const [copied, setCopied] = useState(false);
  const keys = useShortcutLabels();

  const hasResult = Boolean(result);

  const stdout = result?.stdout ?? "";
  const stderr = result?.stderr ?? "";
  const combined = [
    stderr && `--- stderr ---\n${stderr}`,
    stdout && `--- stdout ---\n${stdout}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const body =
    tab === "stdout" ? stdout : tab === "stderr" ? stderr : combined || stdout || stderr;

  const copy = async () => {
    if (!body) return;
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard API unavailable — ignore */
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      <div className="flex items-center gap-3 border-b border-border px-3 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">
          Output
        </span>
        <div
          role="tablist"
          aria-label="Output view"
          className="flex gap-0.5 rounded-md bg-elevated p-0.5 text-[11px]"
        >
          {(["combined", "stdout", "stderr", "stdin"] as Tab[]).map((t) => (
            <button
              key={t}
              role="tab"
              id={`output-tab-${t}`}
              aria-selected={tab === t}
              aria-controls="output-panel-body"
              tabIndex={tab === t ? 0 : -1}
              onClick={() => setTab(t)}
              className={`rounded px-2 py-1 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                tab === t
                  ? "bg-bg text-ink shadow-soft ring-1 ring-accent/40"
                  : "text-muted hover:bg-bg/40 hover:text-ink"
              }`}
              title={
                t === "stdin"
                  ? "Input sent to the program's stdin (piped and EOF'd before the program starts)"
                  : undefined
              }
            >
              {t}
              {t === "stdin" && stdin.length > 0 && (
                <span className="ml-1 rounded bg-accent/20 px-1 text-[9px] text-accent">
                  {stdin.length}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2 text-[11px]">
          {running && stdin.length > 0 && tab !== "stdin" && (
            <button
              onClick={() => setTab("stdin")}
              title="View the stdin buffer being piped to the program"
              className="rounded bg-accent/20 px-1.5 py-0.5 text-[10px] font-medium text-accent ring-1 ring-accent/40 transition hover:bg-accent/30"
            >
              ▸ piping {stdin.length}c to stdin
            </button>
          )}
          {running && (
            <span className="flex items-center gap-1.5 text-accent">
              <span className="inline-block h-1.5 w-1.5 animate-pulseDot rounded-full bg-accent" />
              Running…
            </span>
          )}
          {error && !hasResult && (
            <span
              role="alert"
              className="rounded bg-danger/15 px-1.5 py-0.5 text-[10px] font-semibold text-danger ring-1 ring-danger/30"
              title={error}
              aria-label={`Request failed: ${error}`}
            >
              Request failed
            </span>
          )}
          {hasResult && (
            <>
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 ${TYPE_STYLE[result!.errorType]}`}
              >
                {TYPE_LABEL[result!.errorType]}
              </span>
              <span className="font-mono text-faint">
                exit {result!.exitCode} · {result!.durationMs}ms · {result!.stage}
              </span>
              <button
                onClick={copy}
                className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted transition hover:border-accent/60 hover:text-ink"
                title="Copy output to clipboard"
              >
                {copied ? "✓ copied" : "copy"}
              </button>
            </>
          )}
        </div>
      </div>
      {tab === "stdin" ? (
        <textarea
          id="output-panel-body"
          role="tabpanel"
          aria-labelledby={`output-tab-${tab}`}
          value={stdin}
          onChange={(e) => setStdin(e.target.value)}
          spellCheck={false}
          placeholder={"Type input here — it will be piped to stdin on the next Run.\nOne line per prompt for programs that read with input()/scanf/fgets."}
          className="min-h-0 flex-1 resize-none bg-bg p-3 font-mono text-[13px] leading-relaxed text-ink outline-none placeholder:text-faint sm:text-xs"
        />
      ) : (
        <pre
          id="output-panel-body"
          role="tabpanel"
          aria-labelledby={`output-tab-${tab}`}
          className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap bg-bg p-3 font-mono text-[13px] leading-relaxed text-ink sm:text-xs">
          {error ? (
            <span className="text-danger">{error}</span>
          ) : hasResult ? (
            body ? (
              linkifyRefs(body, order, revealAt)
            ) : (
              <span className="text-faint">
                (no output)
                {result!.exitCode === 0 && stdin.length === 0 && (
                  <>
                    {" "}
                    — if this program reads input, try the{" "}
                    <button
                      onClick={() => setTab("stdin")}
                      className="text-accent underline underline-offset-2 transition hover:text-accentMuted focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      stdin
                    </button>{" "}
                    tab.
                  </>
                )}
              </span>
            )
          ) : running ? (
            <span className="text-muted">Running…</span>
          ) : (
            <span className="text-faint">
              Press <kbd className="kbd">{keys.run}</kbd> or click{" "}
              <span className="text-ink">▶ Run</span> to execute the current project.
            </span>
          )}
        </pre>
      )}
    </div>
  );
}
