import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { useAIStore } from "../state/aiStore";
import { useProjectStore } from "../state/projectStore";
import { useRunStore } from "../state/runStore";
import { SettingsPanel } from "./SettingsPanel";
import { parsePartialTutor } from "../util/partialJson";
import type { TutorSections } from "../types";

type Tone = "think" | "check" | "hint" | "step" | "stronger";

// Tokens per section keep accent colors consistent between the left border,
// the label pill, and any icons we add later.
const TONE: Record<
  Tone,
  { border: string; accent: string; pill: string; icon: string }
> = {
  think: {
    border: "border-accent/50",
    accent: "text-accent",
    pill: "bg-accent/10 text-accent",
    icon: "◆",
  },
  check: {
    border: "border-success/50",
    accent: "text-success",
    pill: "bg-success/10 text-success",
    icon: "?",
  },
  hint: {
    border: "border-warn/50",
    accent: "text-warn",
    pill: "bg-warn/10 text-warn",
    icon: "✦",
  },
  step: {
    border: "border-violet/50",
    accent: "text-violet",
    pill: "bg-violet/10 text-violet",
    icon: "→",
  },
  stronger: {
    border: "border-danger/50",
    accent: "text-danger",
    pill: "bg-danger/10 text-danger",
    icon: "!",
  },
};

function SectionView({ label, text, tone }: { label: string; text: string; tone: Tone }) {
  const t = TONE[tone];
  return (
    <div
      className={`rounded-md border-l-2 ${t.border} bg-elevated/60 px-3 py-2 shadow-soft`}
    >
      <div className="mb-1 flex items-center gap-1.5">
        <span className={`text-[10px] ${t.accent}`}>{t.icon}</span>
        <span className={`rounded px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-wider ${t.pill}`}>
          {label}
        </span>
      </div>
      <div className="whitespace-pre-wrap text-xs leading-relaxed text-ink/90">{text}</div>
    </div>
  );
}

function classifyAskError(raw: string): { kind: "quota" | "rateLimit" | "auth" | "generic"; title: string; hint?: string } {
  const m = raw.toLowerCase();
  if (m.includes("insufficient_quota") || m.includes("exceeded your current quota") || m.includes("billing")) {
    return {
      kind: "quota",
      title: "OpenAI quota exceeded",
      hint: "Your API key has no remaining credits. Check billing on the OpenAI dashboard, then try again.",
    };
  }
  if (m.includes("rate limit") || m.includes("rate_limit") || m.includes(" 429")) {
    return {
      kind: "rateLimit",
      title: "Rate limited",
      hint: "OpenAI is throttling requests. Wait a few seconds and try again.",
    };
  }
  if (m.includes("incorrect api key") || m.includes("invalid_api_key") || m.includes(" 401")) {
    return {
      kind: "auth",
      title: "Key rejected",
      hint: "The API key is no longer valid. Open Settings and validate a fresh key.",
    };
  }
  return { kind: "generic", title: "Request failed" };
}

function AskErrorView({ message }: { message: string }) {
  const { title, hint } = classifyAskError(message);
  return (
    <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs">
      <div className="mb-1 flex items-center gap-1.5">
        <span className="text-danger">!</span>
        <span className="rounded bg-danger/20 px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-wider text-danger">
          {title}
        </span>
      </div>
      {hint && <div className="mb-1.5 text-ink/90">{hint}</div>}
      <div className="whitespace-pre-wrap break-words font-mono text-[11px] text-muted">
        {message}
      </div>
    </div>
  );
}

function TutorResponseView({ sections }: { sections: TutorSections }) {
  const parts: { key: string; label: string; text: string; tone: Tone }[] = [];
  if (sections.whatIThink) parts.push({ key: "t", label: "What I think", text: sections.whatIThink, tone: "think" });
  if (sections.whatToCheck) parts.push({ key: "c", label: "What to check", text: sections.whatToCheck, tone: "check" });
  if (sections.hint) parts.push({ key: "h", label: "Hint", text: sections.hint, tone: "hint" });
  if (sections.nextStep) parts.push({ key: "n", label: "Next step", text: sections.nextStep, tone: "step" });
  if (sections.strongerHint) parts.push({ key: "s", label: "Stronger hint", text: sections.strongerHint, tone: "stronger" });

  if (parts.length === 0) {
    return <div className="text-xs italic text-faint">(empty response)</div>;
  }
  return (
    <div className="flex flex-col gap-2">
      {parts.map((p) => (
        <SectionView key={p.key} label={p.label} text={p.text} tone={p.tone} />
      ))}
    </div>
  );
}

// Shimmering placeholder that previews the section layout while the tutor is
// thinking. Two skeleton cards roughly the shape of "What I think" + "What to
// check" — the two sections the first turn always returns.
function ThinkingSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      <div className="rounded-md border-l-2 border-accent/30 bg-elevated/40 px-3 py-2">
        <div className="mb-2 h-3 w-24 skeleton" />
        <div className="mb-1 h-2.5 w-full skeleton" />
        <div className="mb-1 h-2.5 w-11/12 skeleton" />
        <div className="h-2.5 w-3/4 skeleton" />
      </div>
      <div className="rounded-md border-l-2 border-success/30 bg-elevated/40 px-3 py-2">
        <div className="mb-2 h-3 w-28 skeleton" />
        <div className="mb-1 h-2.5 w-5/6 skeleton" />
        <div className="h-2.5 w-2/3 skeleton" />
      </div>
    </div>
  );
}

export function AssistantPanel() {
  const {
    apiKey,
    keyStatus,
    selectedModel,
    history,
    asking,
    askError,
    pending,
    pushUser,
    pushAssistant,
    setAsking,
    setAskError,
    startStream,
    updateStream,
    clearStream,
    clearConversation,
  } = useAIStore();

  const { snapshot, activeFile, language } = useProjectStore();
  const lastRun = useRunStore((s) => s.result);

  const [draft, setDraft] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isMac, setIsMac] = useState(true);

  useEffect(() => {
    setIsMac(/Mac|iPhone|iPad/i.test(navigator.platform));
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [history.length, asking]);

  const configured = keyStatus === "valid" && !!selectedModel;
  const forceSettings = !configured;

  const handleAsk = async () => {
    const question = draft.trim();
    if (!question || !configured || asking) return;
    setDraft("");
    pushUser(question);
    setAsking(true);
    setAskError(null);
    startStream();
    let raw = "";
    try {
      const files = snapshot();
      const historyForSend = [...history, { role: "user" as const, content: question }];
      await api.askAIStream(
        apiKey,
        {
          model: selectedModel!,
          question,
          files,
          activeFile: activeFile ?? undefined,
          language,
          lastRun: lastRun ?? null,
          history: historyForSend.slice(0, -1),
        },
        {
          onDelta: (chunk) => {
            raw += chunk;
            updateStream(raw, parsePartialTutor(raw));
          },
          onDone: (finalRaw, sections) => {
            pushAssistant(finalRaw || raw, sections);
            clearStream();
          },
          onError: (message) => {
            setAskError(message);
            clearStream();
          },
        }
      );
    } catch (err) {
      setAskError((err as Error).message);
      clearStream();
    } finally {
      setAsking(false);
    }
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleAsk();
    }
  };

  if (forceSettings || showSettings) {
    return (
      <div className="flex h-full flex-col overflow-auto p-3">
        <SettingsPanel onClose={configured ? () => setShowSettings(false) : undefined} />
        {!configured && (
          <div className="mt-4 rounded-md border border-border bg-elevated/60 p-3 text-xs text-muted">
            Configure an OpenAI key above to enable the tutor. The key is sent with every request but never stored on the server.
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col border-l border-border">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">
            Tutor
          </span>
          {selectedModel && (
            <span className="rounded border border-border bg-elevated px-1.5 py-[1px] font-mono text-[10px] text-muted">
              {selectedModel}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={clearConversation}
            className="rounded px-2 py-0.5 text-[11px] text-muted transition hover:bg-elevated hover:text-ink disabled:opacity-40"
            disabled={history.length === 0}
            title="Clear conversation"
          >
            clear
          </button>
          <button
            onClick={() => setShowSettings(true)}
            className="rounded p-1 text-muted transition hover:bg-elevated hover:text-ink"
            title="Settings"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 5a3 3 0 100 6 3 3 0 000-6zm0 4.5a1.5 1.5 0 110-3 1.5 1.5 0 010 3z" />
              <path d="M13.87 9.4l1.09.64a.5.5 0 01.17.68l-1.5 2.6a.5.5 0 01-.68.18l-1.08-.63a5.44 5.44 0 01-1.78 1.03l-.17 1.25a.5.5 0 01-.5.44h-3a.5.5 0 01-.5-.44L5.75 13.9a5.44 5.44 0 01-1.78-1.03l-1.08.63a.5.5 0 01-.68-.17l-1.5-2.6a.5.5 0 01.17-.68l1.09-.64a5.38 5.38 0 010-2l-1.09-.65a.5.5 0 01-.17-.68l1.5-2.6a.5.5 0 01.68-.17l1.08.63A5.44 5.44 0 015.75 2.1l.17-1.25A.5.5 0 016.42.4h3a.5.5 0 01.5.44l.17 1.26c.67.25 1.28.6 1.78 1.03l1.08-.63a.5.5 0 01.68.17l1.5 2.6a.5.5 0 01-.17.68l-1.09.65a5.38 5.38 0 010 2z" />
            </svg>
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-auto p-3">
        {history.length === 0 && !asking && (
          <div className="rounded-md border border-border bg-elevated/60 p-3 text-xs leading-relaxed text-muted">
            <div className="mb-1.5 font-semibold text-ink">Ask about your code.</div>
            The tutor points you at issues rather than writing the fix.
            <div className="mt-2 text-[11px] text-faint">
              Try: <span className="italic">"why is my variance so large?"</span>
            </div>
          </div>
        )}
        {history.map((m, i) => (
          <div key={i} className="flex flex-col gap-1">
            {m.role === "user" ? (
              <div className="self-end max-w-[90%] rounded-md bg-accent/15 px-3 py-1.5 text-xs text-ink ring-1 ring-accent/30">
                {m.content}
              </div>
            ) : m.sections ? (
              <TutorResponseView sections={m.sections} />
            ) : (
              <div className="whitespace-pre-wrap rounded-md border border-border bg-elevated/60 px-3 py-2 text-xs text-ink/90">
                {m.content}
              </div>
            )}
          </div>
        ))}
        {asking && (
          pending && (pending.sections.whatIThink || pending.sections.whatToCheck || pending.sections.hint || pending.sections.nextStep || pending.sections.strongerHint)
            ? <TutorResponseView sections={pending.sections} />
            : <ThinkingSkeleton />
        )}
        {askError && <AskErrorView message={askError} />}
      </div>

      <div className="border-t border-border bg-panel p-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Ask about your project…"
          rows={3}
          className="w-full resize-none rounded-md border border-border bg-elevated px-2.5 py-2 text-xs text-ink transition placeholder:text-faint focus:border-accent/60"
        />
        <div className="mt-1.5 flex items-center justify-between text-[10px] text-faint">
          <div className="flex items-center gap-1">
            <span className="kbd">↵</span>
            <span>send</span>
            <span className="mx-1">·</span>
            <span className="kbd">{isMac ? "⇧↵" : "Shift+↵"}</span>
            <span>newline</span>
          </div>
          <button
            onClick={handleAsk}
            disabled={!draft.trim() || asking}
            className="rounded-md bg-accent px-3 py-1 text-[11px] font-semibold text-bg transition hover:bg-accentMuted disabled:cursor-not-allowed disabled:bg-elevated disabled:text-faint"
          >
            {asking ? "asking…" : "Ask"}
          </button>
        </div>
      </div>
    </div>
  );
}
