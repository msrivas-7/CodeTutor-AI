import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { useAIStore } from "../state/aiStore";
import { useProjectStore } from "../state/projectStore";
import { useRunStore } from "../state/runStore";
import { planSend } from "../util/summarizeHistory";
import { useTutorAsk } from "../util/useTutorAsk";
import {
  TutorResponseView,
  ActionChips,
  UsageChip,
  ThinkingSkeleton,
  AskErrorView,
  hasTutorContent,
} from "./TutorResponseViews";
import { TutorSetupWarning } from "./TutorSetupWarning";
import { SelectionPreview } from "./SelectionPreview";
import { useShortcutLabels } from "../util/platform";

export function AssistantPanel({ onCollapse, onOpenSettings }: { onCollapse?: () => void; onOpenSettings?: () => void }) {
  const {
    apiKey,
    keyStatus,
    selectedModel,
    history,
    asking,
    askError,
    pending,
    setAskError,
    clearConversation,
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

  const { activeFile, language } = useProjectStore();
  const lastRun = useRunStore((s) => s.result);
  const stdin = useRunStore((s) => s.stdin);

  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const keys = useShortcutLabels();

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

  const { submitAsk, cancelAsk } = useTutorAsk({
    beforeSend: () => {
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
      return plan.historyForSend;
    },
    buildBody: ({ question, files, diffSinceLastTurn, historyForSend, selection }) => ({
      model: selectedModel!,
      question,
      files,
      activeFile: activeFile ?? undefined,
      language,
      lastRun: lastRun ?? null,
      history: historyForSend,
      stdin: stdin || null,
      diffSinceLastTurn,
      runsSinceLastTurn,
      editsSinceLastTurn,
      persona,
      selection,
    }),
  });

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
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-auto p-3">
        {!configured && <TutorSetupWarning onOpenSettings={onOpenSettings} />}
        {history.length === 0 && !asking && configured && (
          <div className="rounded-md border border-border bg-elevated/60 p-3 text-xs leading-relaxed text-muted">
            <div className="mb-1.5 font-semibold text-ink">Ask about your code.</div>
            The tutor points you at issues rather than writing the fix.
            <div className="mt-2 text-[11px] text-faint">
              Try: <span className="italic">"why is my variance so large?"</span>
            </div>
            <div className="mt-1.5 text-[11px] text-faint">
              Tip: highlight code in the editor to attach it to your question, or press{" "}
              <kbd className="kbd">{keys.focusAsk}</kbd> to jump here.
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
            <div key={i} className="flex flex-col gap-2 motion-safe:animate-fadeInUp">
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
        {askError && (
          <AskErrorView
            message={askError}
            onRetry={() => {
              const lastUser = [...history].reverse().find((m) => m.role === "user");
              if (lastUser) {
                setAskError(null);
                setPendingAsk(lastUser.content);
              }
            }}
            retryDisabled={asking || !configured}
          />
        )}
      </div>

      <div className="border-t border-border bg-panel p-2">
        {activeSelection && (
          <SelectionPreview selection={activeSelection} onClear={() => setActiveSelection(null)} />
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
          <div
            role="group"
            aria-label="Keyboard shortcuts"
            className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5"
          >
            <kbd className="kbd">↵</kbd>
            <span>send</span>
            <span aria-hidden="true" className="text-border">·</span>
            <kbd className="kbd">{keys.newline}</kbd>
            <span>newline</span>
            <span aria-hidden="true" className="text-border">·</span>
            <kbd className="kbd">{keys.focusAsk}</kbd>
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
