import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { useAIStore } from "../state/aiStore";
import { useProjectStore } from "../state/projectStore";
import { useRunStore } from "../state/runStore";
import { SettingsPanel } from "./SettingsPanel";
import { parsePartialTutor } from "../util/partialJson";
import { linkifyRefs } from "../util/linkifyRefs";
import { computeDiffSinceLast } from "../util/diffSinceLast";
import { planSend } from "../util/summarizeHistory";
import { estimateCost, formatCost, formatTokens } from "../util/pricing";
import type {
  Stuckness,
  TokenUsage,
  TutorCitation,
  TutorIntent,
  TutorSections,
  TutorWalkStep,
} from "../types";

type Tone =
  | "think"
  | "check"
  | "hint"
  | "step"
  | "stronger"
  | "explain"
  | "example"
  | "pitfall";

// Tokens per section keep accent colors consistent between the left border,
// the label pill, and any icons we add later. Palette reuses the five semantic
// colors; sections are differentiated by icon + label even when they share a
// color (e.g. hint and pitfall both lean warn).
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
  explain: {
    border: "border-violet/50",
    accent: "text-violet",
    pill: "bg-violet/10 text-violet",
    icon: "◈",
  },
  example: {
    border: "border-accent/50",
    accent: "text-accent",
    pill: "bg-accent/10 text-accent",
    icon: "‹›",
  },
  pitfall: {
    border: "border-warn/50",
    accent: "text-warn",
    pill: "bg-warn/10 text-warn",
    icon: "⚠",
  },
};

const INTENT_LABEL: Record<TutorIntent, string> = {
  debug: "Debug",
  concept: "Concept",
  howto: "How-to",
  walkthrough: "Walkthrough",
  checkin: "Check-in",
};

function SectionView({ label, text, tone }: { label: string; text: string; tone: Tone }) {
  const t = TONE[tone];
  const order = useProjectStore((s) => s.order);
  const revealAt = useProjectStore((s) => s.revealAt);
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
      <div className="whitespace-pre-wrap text-xs leading-relaxed text-ink/90">
        {linkifyRefs(text, order, revealAt)}
      </div>
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

function IntentBadge({ intent }: { intent?: TutorIntent | null }) {
  if (!intent) return null;
  return (
    <span className="rounded-full border border-border bg-elevated px-2 py-[1px] text-[9px] font-semibold uppercase tracking-wider text-muted">
      {INTENT_LABEL[intent]}
    </span>
  );
}

const STUCKNESS_STYLE: Record<Stuckness, { label: string; cls: string }> = {
  low: {
    label: "Making progress",
    cls: "border-success/40 bg-success/10 text-success",
  },
  medium: {
    label: "Spinning",
    cls: "border-warn/40 bg-warn/10 text-warn",
  },
  high: {
    label: "Stuck — escalating",
    cls: "border-danger/40 bg-danger/10 text-danger",
  },
};

function StucknessBadge({ level }: { level?: Stuckness | null }) {
  if (!level) return null;
  const s = STUCKNESS_STYLE[level];
  return (
    <span
      className={`rounded-full border px-2 py-[1px] text-[9px] font-semibold uppercase tracking-wider ${s.cls}`}
      title="The tutor's read on how stuck you are"
    >
      {s.label}
    </span>
  );
}

function WalkthroughView({ steps }: { steps: TutorWalkStep[] }) {
  const order = useProjectStore((s) => s.order);
  const revealAt = useProjectStore((s) => s.revealAt);
  return (
    <div className="rounded-md border-l-2 border-violet/50 bg-elevated/60 px-3 py-2 shadow-soft">
      <div className="mb-2 flex items-center gap-1.5">
        <span className="text-[10px] text-violet">→</span>
        <span className="rounded px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-wider bg-violet/10 text-violet">
          Walkthrough
        </span>
      </div>
      <ol className="space-y-1.5 text-xs leading-relaxed text-ink/90">
        {steps.map((s, i) => (
          <li key={i} className="flex gap-2">
            <span className="mt-[1px] shrink-0 font-mono text-[10px] text-faint">{i + 1}.</span>
            <div className="min-w-0 flex-1">
              <span className="whitespace-pre-wrap">
                {linkifyRefs(s.body, order, revealAt)}
              </span>
              {s.path && s.line != null && order.includes(s.path) && (
                <button
                  onClick={() => revealAt(s.path!, s.line!)}
                  className="ml-1.5 rounded bg-violet/10 px-1 py-0 font-mono text-[10px] text-violet transition hover:bg-violet/20"
                  title={`Jump to ${s.path}:${s.line}`}
                >
                  {s.path}:{s.line}
                </button>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function CheckQuestionsView({
  questions,
  onAsk,
  disabled,
}: {
  questions: string[];
  onAsk?: (q: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="rounded-md border-l-2 border-success/50 bg-elevated/60 px-3 py-2 shadow-soft">
      <div className="mb-1.5 flex items-center gap-1.5">
        <span className="text-[10px] text-success">?</span>
        <span className="rounded bg-success/10 px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-wider text-success">
          Check these
        </span>
      </div>
      <ul className="space-y-1 text-xs leading-relaxed text-ink/90">
        {questions.map((q, i) => (
          <li key={i} className="flex gap-2">
            <span className="mt-[1px] shrink-0 text-success">•</span>
            {onAsk ? (
              <button
                onClick={() => onAsk(q)}
                disabled={disabled}
                className="flex-1 cursor-pointer rounded px-1 py-0 text-left transition hover:bg-success/10 hover:text-success disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent disabled:hover:text-inherit"
                title="Ask this directly"
              >
                {q}
              </button>
            ) : (
              <span>{q}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ComprehensionCheckView({
  text,
  onAsk,
  disabled,
}: {
  text: string;
  onAsk?: (q: string) => void;
  disabled?: boolean;
}) {
  const body = (
    <div className="text-xs leading-relaxed text-ink/90">{text}</div>
  );
  return (
    <div className="rounded-md border border-accent/40 bg-accent/5 px-3 py-2 shadow-soft">
      <div className="mb-1.5 flex items-center gap-1.5">
        <span className="text-[10px] text-accent">↻</span>
        <span className="rounded bg-accent/15 px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-wider text-accent">
          Your turn
        </span>
      </div>
      {onAsk ? (
        <button
          onClick={() => onAsk(`Answering your check: ${text}`)}
          disabled={disabled}
          className="w-full cursor-pointer rounded text-left transition hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent"
          title="Answer this now — the tutor will guide you"
        >
          {body}
          <div className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-accent/80">
            tap to take a swing →
          </div>
        </button>
      ) : (
        body
      )}
    </div>
  );
}

const CHIPS: { label: string; prompt: string }[] = [
  {
    label: "still stuck",
    prompt: "I'm still stuck on this — can you give me a stronger hint?",
  },
  {
    label: "explain more",
    prompt: "Can you explain that in more detail?",
  },
  {
    label: "concrete example",
    prompt: "Can you show me a concrete example of that in my code?",
  },
  {
    label: "why it matters",
    prompt: "Why does this matter for what I'm trying to do?",
  },
];

function ActionChips({
  onAsk,
  disabled,
}: {
  onAsk: (q: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {CHIPS.map((c) => (
        <button
          key={c.label}
          onClick={() => onAsk(c.prompt)}
          disabled={disabled}
          className="rounded-full border border-border bg-elevated/60 px-2 py-[2px] text-[10px] text-muted transition hover:border-accent/60 hover:bg-accent/10 hover:text-accent disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-border disabled:hover:bg-elevated disabled:hover:text-muted"
          title={c.prompt}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}

function UsageChip({
  usage,
  modelId,
  size = "sm",
}: {
  usage: TokenUsage;
  modelId?: string | null;
  size?: "sm" | "xs";
}) {
  const total = usage.inputTokens + usage.outputTokens;
  const cost = modelId ? estimateCost(modelId, usage) : null;
  const title =
    cost !== null
      ? `${usage.inputTokens.toLocaleString()} input + ${usage.outputTokens.toLocaleString()} output tokens · approx ${formatCost(cost)}`
      : `${usage.inputTokens.toLocaleString()} input + ${usage.outputTokens.toLocaleString()} output tokens`;
  const textCls = size === "xs" ? "text-[9px]" : "text-[10px]";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border border-border bg-elevated/70 px-1.5 py-[1px] ${textCls} text-faint`}
      title={title}
    >
      <span className="font-mono">{formatTokens(total)}</span>
      <span className="text-muted">tokens</span>
      {cost !== null && (
        <>
          <span className="text-border">·</span>
          <span className="font-mono text-muted">~{formatCost(cost)}</span>
        </>
      )}
    </span>
  );
}

function CitationsStrip({ citations }: { citations: TutorCitation[] }) {
  const order = useProjectStore((s) => s.order);
  const revealAt = useProjectStore((s) => s.revealAt);
  const valid = citations.filter((c) => order.includes(c.path));
  if (valid.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1 pt-0.5">
      <span className="text-[9px] font-semibold uppercase tracking-wider text-faint">
        Refs
      </span>
      {valid.map((c, i) => (
        <button
          key={i}
          onClick={() => revealAt(c.path, c.line, c.column ?? undefined)}
          className="rounded-full border border-border bg-elevated px-2 py-[1px] font-mono text-[10px] text-accent transition hover:border-accent/60 hover:bg-accent/10"
          title={c.reason}
        >
          {c.path}:{c.line}
          {c.column ? `:${c.column}` : ""}
        </button>
      ))}
    </div>
  );
}

function hasTutorContent(s: TutorSections): boolean {
  return Boolean(
    s.summary ||
      s.diagnose ||
      s.explain ||
      s.example ||
      (s.walkthrough && s.walkthrough.length > 0) ||
      (s.checkQuestions && s.checkQuestions.length > 0) ||
      s.hint ||
      s.nextStep ||
      s.strongerHint ||
      s.pitfalls ||
      s.comprehensionCheck ||
      (s.citations && s.citations.length > 0),
  );
}

function TutorResponseView({
  sections,
  onAsk,
  disabled,
}: {
  sections: TutorSections;
  onAsk?: (q: string) => void;
  disabled?: boolean;
}) {
  if (!hasTutorContent(sections)) {
    return <div className="text-xs italic text-faint">(empty response)</div>;
  }

  return (
    <div className="flex flex-col gap-2">
      {(sections.intent || sections.summary || sections.stuckness) && (
        <div className="flex flex-wrap items-start gap-2">
          <IntentBadge intent={sections.intent} />
          <StucknessBadge level={sections.stuckness} />
          {sections.summary && (
            <span className="flex-1 text-xs italic text-ink/80">{sections.summary}</span>
          )}
        </div>
      )}
      {sections.diagnose && (
        <SectionView label="What I think" text={sections.diagnose} tone="think" />
      )}
      {sections.explain && (
        <SectionView label="Explanation" text={sections.explain} tone="explain" />
      )}
      {sections.example && (
        <SectionView label="Example" text={sections.example} tone="example" />
      )}
      {sections.walkthrough && sections.walkthrough.length > 0 && (
        <WalkthroughView steps={sections.walkthrough} />
      )}
      {sections.checkQuestions && sections.checkQuestions.length > 0 && (
        <CheckQuestionsView
          questions={sections.checkQuestions}
          onAsk={onAsk}
          disabled={disabled}
        />
      )}
      {sections.hint && <SectionView label="Hint" text={sections.hint} tone="hint" />}
      {sections.nextStep && (
        <SectionView label="Next step" text={sections.nextStep} tone="step" />
      )}
      {sections.strongerHint && (
        <SectionView
          label="Stronger hint"
          text={sections.strongerHint}
          tone="stronger"
        />
      )}
      {sections.pitfalls && (
        <SectionView label="Pitfalls" text={sections.pitfalls} tone="pitfall" />
      )}
      {sections.comprehensionCheck && (
        <ComprehensionCheckView
          text={sections.comprehensionCheck}
          onAsk={onAsk}
          disabled={disabled}
        />
      )}
      {sections.citations && sections.citations.length > 0 && (
        <CitationsStrip citations={sections.citations} />
      )}
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

export function AssistantPanel({ onCollapse }: { onCollapse?: () => void }) {
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
    commitTurnSnapshot,
    lastTurnFiles,
    runsSinceLastTurn,
    editsSinceLastTurn,
    pendingAsk,
    setPendingAsk,
    persona,
    conversationSummary,
    summarizedThrough,
    summarizing,
    commitSummary,
    setSummarizing,
    activeSelection,
    setActiveSelection,
    focusComposerNonce,
    sessionUsage,
  } = useAIStore();

  const { snapshot, activeFile, language } = useProjectStore();
  const lastRun = useRunStore((s) => s.result);
  const stdin = useRunStore((s) => s.stdin);

  const [draft, setDraft] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [isMac, setIsMac] = useState(true);

  useEffect(() => {
    setIsMac(/Mac|iPhone|iPad/i.test(navigator.platform));
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [history.length, asking]);

  // Cmd+K from the editor bumps `focusComposerNonce`. Pull focus into the
  // composer so the student can immediately type the ask about their selection.
  // Skip the very first mount (nonce starts at 0).
  useEffect(() => {
    if (focusComposerNonce === 0) return;
    textareaRef.current?.focus();
  }, [focusComposerNonce]);

  const configured = keyStatus === "valid" && !!selectedModel;
  const forceSettings = !configured;

  const submitAsk = async (question: string) => {
    if (!question || !configured || asking) return;
    // Snapshot + clear the selection now so fast-follow asks don't accidentally
    // reuse stale editor context from a previous question.
    const selectionForTurn = activeSelection;
    setActiveSelection(null);
    pushUser(question);
    setAsking(true);
    setAskError(null);
    startStream();
    const controller = new AbortController();
    abortRef.current = controller;
    let raw = "";
    let committed = false;
    try {
      const files = snapshot();
      const diffSinceLastTurn = computeDiffSinceLast(lastTurnFiles, files);
      // Snapshot BEFORE the request goes out so that any edits/runs during the
      // model's thinking time are correctly attributed to the NEXT turn. If the
      // request errors we still keep the snapshot — it represents "last sent",
      // not "last successful".
      commitTurnSnapshot(files);

      // Phase 4 — decide what slice of history to ship. If we've crossed the
      // soft cap, fire a summarize round-trip in the background and proceed
      // with the best context we already have. The new summary lands on the
      // next turn; this keeps the user waiting on one round-trip, not two.
      const plan = planSend({
        history,
        summary: conversationSummary,
        summarizedThrough,
      });
      if (plan.shouldSummarize && !summarizing) {
        setSummarizing(true);
        // Deliberately not awaited — the summarize result is cached for the
        // next ask, so the CURRENT ask doesn't block on it.
        api
          .summarizeHistory(apiKey, {
            model: selectedModel!,
            history: plan.summarizeSlice.map((m) => ({
              role: m.role,
              content: m.content,
            })),
          })
          .then((r) => {
            if (r.summary) commitSummary(r.summary, plan.nextSummarizedThrough);
          })
          .catch(() => {
            // Soft failure — we just keep using the old summary (or none).
          })
          .finally(() => setSummarizing(false));
      }
      const historyToSend = [
        ...plan.historyForSend,
        { role: "user" as const, content: question },
      ];

      await api.askAIStream(
        apiKey,
        {
          model: selectedModel!,
          question,
          files,
          activeFile: activeFile ?? undefined,
          language,
          lastRun: lastRun ?? null,
          history: historyToSend.slice(0, -1),
          stdin: stdin || null,
          diffSinceLastTurn,
          runsSinceLastTurn,
          editsSinceLastTurn,
          persona,
          selection: selectionForTurn,
        },
        {
          signal: controller.signal,
          onDelta: (chunk) => {
            raw += chunk;
            updateStream(raw, parsePartialTutor(raw));
          },
          onDone: (finalRaw, sections, usage) => {
            pushAssistant(finalRaw || raw, sections, usage);
            clearStream();
            committed = true;
          },
          onError: (message) => {
            setAskError(message);
            clearStream();
            committed = true;
          },
        }
      );
      // Abort path: askAIStream returns without firing onDone/onError. Commit
      // whatever partial text we received so the student keeps the context
      // rather than losing it when they click Stop.
      if (!committed && controller.signal.aborted) {
        if (raw.trim()) {
          pushAssistant(raw, parsePartialTutor(raw));
        }
        clearStream();
      }
    } catch (err) {
      setAskError((err as Error).message);
      clearStream();
    } finally {
      setAsking(false);
      abortRef.current = null;
    }
  };

  const cancelAsk = () => {
    abortRef.current?.abort();
  };

  const handleAsk = () => {
    const question = draft.trim();
    if (!question) return;
    setDraft("");
    submitAsk(question);
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleAsk();
    }
  };

  // External submit signal: action chips, clickable check questions, and the
  // "walk me through this" header button all set `pendingAsk`. We consume it
  // here and fire immediately — no composer detour.
  useEffect(() => {
    if (pendingAsk && configured && !asking) {
      const q = pendingAsk;
      setPendingAsk(null);
      submitAsk(q);
    }
    // submitAsk closes over a lot of state; we intentionally depend only on
    // the trigger + readiness gates so we don't re-fire on unrelated re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAsk, configured, asking]);

  if (forceSettings || showSettings) {
    return (
      <div className="flex h-full flex-col border-l border-border">
        {onCollapse && (
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">
              {configured ? "Settings" : "Setup"}
            </span>
            <button
              onClick={onCollapse}
              title="Collapse tutor"
              className="rounded p-1 text-muted transition hover:bg-elevated hover:text-ink"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                <path d="M10.5 3.5L6 8l4.5 4.5L12 11 9 8l3-3z" />
              </svg>
            </button>
          </div>
        )}
        <div className="flex-1 overflow-auto p-3">
          <SettingsPanel onClose={configured ? () => setShowSettings(false) : undefined} />
          {!configured && (
            <div className="mt-4 rounded-md border border-border bg-elevated/60 p-3 text-xs text-muted">
              Configure an OpenAI key above to enable the tutor. The key is sent with every request but never stored on the server.
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col border-l border-border">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          {selectedModel && (
            <span className="rounded border border-border bg-elevated px-1.5 py-[1px] font-mono text-[10px] text-muted">
              {selectedModel}
            </span>
          )}
          {(sessionUsage.inputTokens > 0 || sessionUsage.outputTokens > 0) && (
            <UsageChip usage={sessionUsage} modelId={selectedModel} size="xs" />
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
          {onCollapse && (
            <button
              onClick={onCollapse}
              title="Collapse tutor"
              className="rounded p-1 text-muted transition hover:bg-elevated hover:text-ink"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                <path d="M10.5 3.5L6 8l4.5 4.5L12 11 9 8l3-3z" />
              </svg>
            </button>
          )}
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
            <div className="mt-1.5 text-[11px] text-faint">
              Tip: highlight code in the editor to attach it to your question, or press{" "}
              <span className="kbd">{isMac ? "⌘K" : "Ctrl+K"}</span> to jump here.
            </div>
          </div>
        )}
        {history.map((m, i) => {
          // Only the most-recent assistant turn gets interactive handlers —
          // older chips/questions in the scrollback would be confusing to
          // fire against the current editor state.
          const isLatestAssistant =
            m.role === "assistant" &&
            i === history.length - 1 &&
            !asking;
          return (
            <div key={i} className="flex flex-col gap-2">
              {m.role === "user" ? (
                <div className="self-end max-w-[90%] rounded-md bg-accent/15 px-3 py-1.5 text-xs text-ink ring-1 ring-accent/30">
                  {m.content}
                </div>
              ) : m.sections ? (
                <TutorResponseView
                  sections={m.sections}
                  onAsk={isLatestAssistant ? setPendingAsk : undefined}
                  disabled={asking}
                />
              ) : (
                <div className="whitespace-pre-wrap rounded-md border border-border bg-elevated/60 px-3 py-2 text-xs text-ink/90">
                  {m.content}
                </div>
              )}
              {(isLatestAssistant || (m.role === "assistant" && m.usage)) && (
                <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                  {isLatestAssistant ? (
                    <ActionChips onAsk={setPendingAsk} disabled={asking} />
                  ) : (
                    <span />
                  )}
                  {m.role === "assistant" && m.usage && (
                    <UsageChip usage={m.usage} modelId={selectedModel} />
                  )}
                </div>
              )}
            </div>
          );
        })}
        {asking && (
          pending && hasTutorContent(pending.sections)
            ? <TutorResponseView sections={pending.sections} disabled />
            : <ThinkingSkeleton />
        )}
        {askError && <AskErrorView message={askError} />}
      </div>

      <div className="border-t border-border bg-panel p-2">
        {activeSelection && (
          <div className="mb-1.5 rounded-md border border-accent/40 bg-accent/5 px-2 py-1.5">
            <div className="flex items-center gap-1.5">
              <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wider text-accent">
                Selection
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-accent/90">
                {activeSelection.path}:
                {activeSelection.startLine === activeSelection.endLine
                  ? activeSelection.startLine
                  : `${activeSelection.startLine}-${activeSelection.endLine}`}
              </span>
              <button
                onClick={() => setActiveSelection(null)}
                title="Remove selection"
                className="shrink-0 rounded px-1 text-[11px] leading-none text-muted transition hover:bg-elevated hover:text-ink"
              >
                ×
              </button>
            </div>
            <pre className="mt-1 max-h-10 overflow-hidden whitespace-pre rounded bg-bg/60 px-1.5 py-1 font-mono text-[10px] leading-snug text-ink/80">
              {activeSelection.text
                .replace(/\t/g, "  ")
                .split("\n")
                .slice(0, 2)
                .map((l) => (l.length > 80 ? l.slice(0, 80) + "…" : l))
                .join("\n")}
              {activeSelection.text.split("\n").length > 2 ? "\n…" : ""}
            </pre>
          </div>
        )}
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKey}
          placeholder={activeSelection ? "Ask about the selection…" : "Ask about your project…"}
          rows={3}
          className="w-full resize-none rounded-md border border-border bg-elevated px-2.5 py-2 text-xs text-ink transition placeholder:text-faint focus:border-accent/60"
        />
        <div className="mt-1.5 flex items-center justify-between gap-2 text-[10px] text-faint">
          <div className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5">
            <span className="kbd">↵</span>
            <span>send</span>
            <span className="text-border">·</span>
            <span className="kbd">{isMac ? "⇧↵" : "Shift+↵"}</span>
            <span>newline</span>
            <span className="text-border">·</span>
            <span className="kbd">{isMac ? "⌘K" : "Ctrl+K"}</span>
            <span>focus</span>
          </div>
          {asking ? (
            <button
              onClick={cancelAsk}
              title="Stop the current response"
              className="inline-flex items-center gap-1.5 rounded-md bg-danger/15 px-3 py-1 text-[11px] font-semibold text-danger ring-1 ring-danger/30 transition hover:bg-danger/25"
            >
              <span className="inline-block h-2 w-2 rounded-sm bg-danger" />
              Stop
            </button>
          ) : (
            <button
              onClick={handleAsk}
              disabled={!draft.trim()}
              className="rounded-md bg-accent px-3 py-1 text-[11px] font-semibold text-bg transition hover:bg-accentMuted disabled:cursor-not-allowed disabled:bg-elevated disabled:text-faint"
            >
              Ask
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
