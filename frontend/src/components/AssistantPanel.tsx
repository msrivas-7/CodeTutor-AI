import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { api } from "../api/client";
import { useAIStore } from "../state/aiStore";
import { usePreferencesStore } from "../state/preferencesStore";
import { useProjectStore } from "../state/projectStore";
import { useRunStore } from "../state/runStore";
import { useAIStatus } from "../state/useAIStatus";
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
import { FreeTierPill } from "./FreeTierPill";
import { ExhaustionCard, formatReset } from "./ExhaustionCard";
import { SelectionPreview } from "./SelectionPreview";
import { useShortcutLabels } from "../util/platform";

export function AssistantPanel({ onCollapse, onOpenSettings }: { onCollapse?: () => void; onOpenSettings?: () => void }) {
  // P-C1: scoped selector + shallow equality. A no-arg `useAIStore()` re-renders
  // on every store mutation (noteEdit/noteRun each run fires the whole panel
  // tree). Shallow-comparing only the slice we actually consume keeps the
  // stream-delta loop from thrashing history + pending + usage every chunk.
  const {
    selectedModel,
    history,
    asking,
    askError,
    pending,
    runsSinceLastTurn,
    editsSinceLastTurn,
    pendingAsk,
    persona,
    conversationSummary,
    summarizedThrough,
    summarizing,
    activeSelection,
    focusComposerNonce,
    sessionUsage,
  } = useAIStore(
    useShallow((s) => ({
      selectedModel: s.selectedModel,
      history: s.history,
      asking: s.asking,
      askError: s.askError,
      pending: s.pending,
      runsSinceLastTurn: s.runsSinceLastTurn,
      editsSinceLastTurn: s.editsSinceLastTurn,
      pendingAsk: s.pendingAsk,
      persona: s.persona,
      conversationSummary: s.conversationSummary,
      summarizedThrough: s.summarizedThrough,
      summarizing: s.summarizing,
      activeSelection: s.activeSelection,
      focusComposerNonce: s.focusComposerNonce,
      sessionUsage: s.sessionUsage,
    })),
  );
  // Actions are stable function refs, so individual selectors don't re-render.
  const setAskError = useAIStore((s) => s.setAskError);
  const clearConversation = useAIStore((s) => s.clearConversation);
  const setPendingAsk = useAIStore((s) => s.setPendingAsk);
  const commitSummary = useAIStore((s) => s.commitSummary);
  const setSummarizing = useAIStore((s) => s.setSummarizing);
  const setActiveSelection = useAIStore((s) => s.setActiveSelection);

  const hasKey = usePreferencesStore((s) => s.hasOpenaiKey);
  const { status: aiStatus } = useAIStatus();

  const activeFile = useProjectStore((s) => s.activeFile);
  const language = useProjectStore((s) => s.language);
  const lastRun = useRunStore((s) => s.result);
  const stdin = useRunStore((s) => s.stdin);

  const [draft, setDraft] = useState("");
  const [exhaustionDismissed, setExhaustionDismissed] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const keys = useShortcutLabels();

  // Phase 20-P4: derive what kind of tutor funding is in play. `hasKey`
  // wins over whatever ai-status last said — if the user just pasted a
  // BYOK key, we shouldn't render the free-tier pill until the status
  // refetch lands. `source === "platform"` means free tier is active.
  const effectiveSource: "byok" | "platform" | "none" =
    hasKey ? "byok" : (aiStatus?.source ?? "byok");
  const onPlatform = effectiveSource === "platform";
  const exhausted = effectiveSource === "none" && aiStatus?.reason === "free_exhausted";
  // Drop stale "dismissed" state whenever the counter refreshes (new day,
  // BYOK added, etc.) so the next exhaustion re-shows the card.
  useEffect(() => {
    if (!exhausted) setExhaustionDismissed(false);
  }, [exhausted]);

  // P-H6: the post-ask /ai-status refetch is no longer needed — useTutorAsk
  // calls notePlatformQuestionConsumed() on success, which patches the
  // cached remainingToday in place and broadcasts to subscribers (including
  // the FreeTierPill). The 30s TTL + next natural fetch reconciles drift.

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

  // Configured = we have SOMETHING to ask against. Either the user pasted a
  // BYOK key (hasKey) AND the model list loaded (selectedModel), OR the
  // backend is willing to fund us on the platform key (onPlatform — the
  // model is implicit, server-picked `gpt-4.1-nano`).
  const configured = onPlatform || (hasKey && !!selectedModel);

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
          .summarizeHistory({
            model: selectedModel ?? "gpt-4.1-nano",
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
      // Platform users have no selectedModel — backend locks them to
      // `gpt-4.1-nano` via the allowlist, so we pass that name verbatim.
      model: selectedModel ?? "gpt-4.1-nano",
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
          {selectedModel && !onPlatform && (
            <span className="rounded border border-border bg-elevated px-1.5 py-[1px] font-mono text-[10px] text-muted">
              {selectedModel}
            </span>
          )}
          {onPlatform && aiStatus?.source === "platform" && aiStatus.remainingToday !== null && aiStatus.capToday !== null && aiStatus.resetAtUtc ? (
            <FreeTierPill
              remaining={aiStatus.remainingToday}
              cap={aiStatus.capToday}
              resetAtUtc={aiStatus.resetAtUtc}
            />
          ) : (
            !onPlatform && (sessionUsage.inputTokens > 0 || sessionUsage.outputTokens > 0) && (
              <UsageChip usage={sessionUsage} modelId={selectedModel} size="xs" />
            )
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
              aria-label="Collapse tutor"
              className="rounded p-1 text-muted transition hover:bg-elevated hover:text-ink"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M10.5 3.5L6 8l4.5 4.5L12 11 9 8l3-3z" />
              </svg>
            </button>
          )}
        </div>
      </div>

      <div
        ref={scrollRef}
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
        aria-atomic="false"
        aria-label="Tutor conversation"
        className="flex-1 space-y-3 overflow-auto p-3"
      >
        {!configured && !exhausted && (
          <TutorSetupWarning
            onOpenSettings={onOpenSettings}
            onDismiss={onCollapse}
            reason={aiStatus?.source === "none" ? aiStatus.reason : undefined}
          />
        )}
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
                  {m.role === "assistant" && m.usage && !onPlatform && (
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
        {exhausted && !exhaustionDismissed ? (
          <ExhaustionCard
            resetAtUtc={aiStatus?.resetAtUtc ?? null}
            onOpenSettings={onOpenSettings}
            onDismiss={() => setExhaustionDismissed(true)}
          />
        ) : (
          <>
        {activeSelection && (
          <SelectionPreview selection={activeSelection} onClear={() => setActiveSelection(null)} />
        )}
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKey}
          // Gate the composer on `configured` — mirror of GuidedTutorPanel's
          // behaviour. Previously this textarea was always enabled even when
          // source=none (quota exhausted, platform paused, denylisted,
          // missing BYOK key), and the Ask button below was only gated on
          // `!draft.trim()` — so a user could type, click Ask, and get a
          // silent no-op from useTutorAsk's early-return. That felt broken.
          //
          // Placeholder branches in order of specificity: selection > not
          // configured & exhausted (show reset time) > not configured &
          // no-key (existing copy) > configured (normal).
          placeholder={
            activeSelection
              ? "Ask about the selection…"
              : !configured && exhausted
                ? `Free tutor resets ${formatReset(aiStatus?.resetAtUtc ?? null)}`
                : !configured
                  ? "Configure API key first"
                  : "Ask about your project…"
          }
          disabled={!configured}
          rows={3}
          aria-label="Ask the tutor"
          className="w-full resize-none rounded-md border border-border bg-elevated px-2.5 py-2 text-xs text-ink transition placeholder:text-faint focus:border-accent/60 disabled:cursor-not-allowed disabled:bg-elevated/40 disabled:opacity-50"
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
              disabled={!draft.trim() || !configured}
              className="rounded-md bg-accent px-3 py-1 text-[11px] font-semibold text-bg transition hover:bg-accentMuted disabled:cursor-not-allowed disabled:bg-elevated disabled:text-faint"
            >
              Ask
            </button>
          )}
        </div>
          </>
        )}
      </div>
    </div>
  );
}
