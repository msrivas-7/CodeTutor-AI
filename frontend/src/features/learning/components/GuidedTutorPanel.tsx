import { useEffect, useRef, useState } from "react";
import { useAIStore } from "../../../state/aiStore";
import { usePreferencesStore } from "../../../state/preferencesStore";
import { useProjectStore } from "../../../state/projectStore";
import { useRunStore } from "../../../state/runStore";
import { useAIStatus } from "../../../state/useAIStatus";
import { useTutorAsk } from "../../../util/useTutorAsk";
import {
  TutorResponseView,
  ActionChips,
  UsageChip,
  ThinkingSkeleton,
  AskErrorView,
  hasTutorContent,
} from "../../../components/TutorResponseViews";
import { TutorSetupWarning } from "../../../components/TutorSetupWarning";
import { FreeTierPill } from "../../../components/FreeTierPill";
import { ExhaustionCard, formatReset } from "../../../components/ExhaustionCard";
import { SelectionPreview } from "../../../components/SelectionPreview";
import { useShortcutLabels } from "../../../util/platform";
import { useProgressStore } from "../stores/progressStore";
import type { LessonMeta } from "../types";

interface GuidedTutorPanelProps {
  lessonMeta: LessonMeta;
  totalLessons: number;
  progressSummary: string;
  // Concepts taught in earlier lessons + course baseVocabulary. Used to scope
  // the tutor's explanations ("safe to reference") vs. future material.
  priorConcepts: string[];
  onCollapse?: () => void;
  onOpenSettings?: () => void;
  resetNonce?: number;
}

export function GuidedTutorPanel({ lessonMeta, totalLessons, progressSummary, priorConcepts, onCollapse, onOpenSettings, resetNonce }: GuidedTutorPanelProps) {
  const incrementHint = useProgressStore((s) => s.incrementHint);
  // Derive the hint cap from the DB-backed hint_count (not local component
  // state) so the limit survives navigation + reload. Local state rewinds on
  // remount; hint_count is the authoritative counter.
  const hintCount = useProgressStore(
    (s) => s.lessonProgress[`${lessonMeta.courseId}/${lessonMeta.id}`]?.hintCount ?? 0,
  );
  const hintLevel = Math.min(hintCount, 3);
  const keys = useShortcutLabels();
  const {
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
    activeSelection,
    setActiveSelection,
    focusComposerNonce,
    sessionUsage,
  } = useAIStore();
  const hasKey = usePreferencesStore((s) => s.hasOpenaiKey);
  const { status: aiStatus } = useAIStatus();

  const { activeFile } = useProjectStore();
  const lastRun = useRunStore((s) => s.result);
  const stdin = useRunStore((s) => s.stdin);

  const [draft, setDraft] = useState("");
  const [exhaustionDismissed, setExhaustionDismissed] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // QA-C1: hint-counter rollback. The Hint button stages intent here at
  // click-time instead of incrementing the counter directly. If the ask
  // succeeds (onAskComplete ok=true) we commit the bump; on error / cancel /
  // abort we drop it. Without this, a student who hit 429 or Stop would
  // burn hint capacity for help they never saw.
  const pendingHintRef = useRef<boolean>(false);

  // Phase 20-P4: BYOK wins; otherwise mirror what ai-status tells us.
  const effectiveSource: "byok" | "platform" | "none" =
    hasKey ? "byok" : (aiStatus?.source ?? "byok");
  const onPlatform = effectiveSource === "platform";
  const exhausted = effectiveSource === "none" && aiStatus?.reason === "free_exhausted";
  useEffect(() => {
    if (!exhausted) setExhaustionDismissed(false);
  }, [exhausted]);
  // P-H6: post-ask /ai-status refetch dropped — useTutorAsk's onDone calls
  // notePlatformQuestionConsumed() which patches cached remainingToday + fans
  // out to subscribers in-process. The 30s TTL reconciles drift on the next
  // natural poll.

  const configured = onPlatform || (hasKey && !!selectedModel);

  useEffect(() => {
    if (!resetNonce) return;
    setDraft("");
    clearConversation();
  }, [resetNonce]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [history.length, asking]);

  useEffect(() => {
    if (focusComposerNonce === 0) return;
    textareaRef.current?.focus();
  }, [focusComposerNonce]);

  const { submitAsk, cancelAsk } = useTutorAsk({
    onAskComplete: ({ ok }) => {
      if (pendingHintRef.current) {
        pendingHintRef.current = false;
        if (ok) incrementHint(lessonMeta.courseId, lessonMeta.id);
      }
    },
    buildBody: ({ question, files, diffSinceLastTurn, historyForSend, selection }) => ({
      // Platform users have no selectedModel — backend locks them to
      // `gpt-4.1-nano` via the allowlist, so we pass that name verbatim.
      model: selectedModel ?? "gpt-4.1-nano",
      question,
      files,
      activeFile: activeFile ?? undefined,
      language: lessonMeta.language,
      lastRun: lastRun ?? null,
      history: historyForSend,
      stdin: stdin || null,
      diffSinceLastTurn,
      runsSinceLastTurn,
      editsSinceLastTurn,
      persona: "beginner",
      selection,
      lessonContext: {
        courseId: lessonMeta.courseId,
        lessonId: lessonMeta.id,
        lessonTitle: lessonMeta.title,
        language: lessonMeta.language,
        lessonObjectives: lessonMeta.objectives,
        teachesConceptTags: lessonMeta.teachesConceptTags,
        usesConceptTags: lessonMeta.usesConceptTags,
        priorConcepts,
        completionRules: lessonMeta.completionRules,
        studentProgressSummary: progressSummary,
        lessonOrder: lessonMeta.order,
        totalLessons,
      },
    }),
  });

  const handleSubmit = () => {
    if (!draft.trim()) return;
    const q = draft.trim();
    setDraft("");
    submitAsk(q);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  useEffect(() => {
    if (pendingAsk && configured && !asking) {
      const q = pendingAsk;
      setPendingAsk(null);
      submitAsk(q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAsk, configured, asking]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <svg className="h-4 w-4 shrink-0 text-violet" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <span className="text-xs font-semibold">Lesson Tutor</span>
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
            onClick={() => { clearConversation(); setDraft(""); }}
            className="rounded px-2 py-0.5 text-[11px] text-muted transition hover:bg-elevated hover:text-ink disabled:opacity-40"
            disabled={history.length === 0 || asking}
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
      </header>

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
            <div className="mb-1.5 font-semibold text-ink">
              Lesson {lessonMeta.order}: {lessonMeta.title}
            </div>
            Your tutor is here to help — ask anything about this lesson. I'll guide you without giving away the answer.
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              <button
                onClick={() => setPendingAsk("What should I do in this lesson?")}
                className="rounded-md border border-border bg-bg/60 px-2 py-1 text-[11px] text-ink/80 transition hover:border-accent/40 hover:bg-accent/10 hover:text-accent"
              >
                What should I do?
              </button>
              <button
                onClick={() => setPendingAsk("I don't understand the instructions. Can you explain?")}
                className="rounded-md border border-border bg-bg/60 px-2 py-1 text-[11px] text-ink/80 transition hover:border-accent/40 hover:bg-accent/10 hover:text-accent"
              >
                Explain the task
              </button>
              <button
                onClick={() => setPendingAsk("Give me a hint to get started.")}
                className="rounded-md border border-border bg-bg/60 px-2 py-1 text-[11px] text-ink/80 transition hover:border-accent/40 hover:bg-accent/10 hover:text-accent"
              >
                Give me a hint
              </button>
            </div>
          </div>
        )}

        {history.map((m, i) => {
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
                <div className="flex flex-col gap-1.5 pt-0.5">
                  {isLatestAssistant && (
                    <div className="flex flex-wrap items-center gap-1">
                      {hintLevel < 3 ? (
                        <button
                          onClick={() => {
                            const prompts = [
                              "Give me a gentle hint — don't reveal the answer.",
                              "I need a stronger hint. Point me in the right direction without giving the full solution.",
                              "I'm really stuck. Walk me through the approach step by step.",
                            ];
                            const idx = Math.min(hintLevel, prompts.length - 1);
                            pendingHintRef.current = true;
                            setPendingAsk(prompts[idx]);
                          }}
                          disabled={asking}
                          aria-label={`${hintLevel === 0 ? "Hint" : hintLevel === 1 ? "Stronger hint" : "Show approach"} — level ${hintLevel + 1} of 3`}
                          title={`Hint ${hintLevel + 1} of 3 — gentler first, stronger on each tap`}
                          className="flex items-center gap-1 rounded-full border border-warn/40 bg-warn/10 px-2 py-[2px] text-[10px] font-medium text-warnInk transition hover:bg-warn/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-warn disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <span aria-hidden="true">💡</span>
                          <span>{hintLevel === 0 ? "Hint" : hintLevel === 1 ? "Stronger hint" : "Show approach"}</span>
                          <span className="rounded-full bg-warn/25 px-1 text-[9px] font-bold tabular-nums">
                            {hintLevel + 1}/3
                          </span>
                        </button>
                      ) : (
                        <span
                          className="flex items-center gap-1 rounded-full border border-border bg-elevated/60 px-2 py-[2px] text-[10px] font-medium text-faint"
                          title="You've used all three hint levels. Keep exploring — or ask a specific follow-up question."
                        >
                          <span aria-hidden="true">💡</span>
                          <span>All hints used</span>
                        </span>
                      )}
                      <ActionChips onAsk={setPendingAsk} disabled={asking} />
                    </div>
                  )}
                  <div className="flex items-center justify-end">
                    {m.role === "assistant" && m.usage && !onPlatform && (
                      <UsageChip usage={m.usage} modelId={selectedModel} />
                    )}
                  </div>
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
              onKeyDown={handleKeyDown}
              placeholder={
                activeSelection
                  ? "Ask about the selection…"
                  : configured
                    ? "Ask about this lesson..."
                    : exhausted
                      ? `Free tutor resets ${formatReset(aiStatus?.resetAtUtc ?? null)}`
                      : "Configure API key first"
              }
              disabled={!configured}
              rows={2}
              aria-label="Ask the tutor"
              className="w-full resize-none rounded-md border border-border bg-elevated px-2.5 py-2 text-xs text-ink transition placeholder:text-faint focus:border-accent/60 disabled:cursor-not-allowed disabled:bg-elevated/40 disabled:opacity-50"
            />
            <div className="mt-1.5 flex items-center justify-between gap-2 text-[10px] text-faint">
              <div
                role="group"
                aria-label="Keyboard shortcuts"
                className="flex items-center gap-x-1"
              >
                <kbd className="kbd">↵</kbd>
                <span>send</span>
                <span aria-hidden="true" className="text-border">·</span>
                <kbd className="kbd">{keys.newline}</kbd>
                <span>newline</span>
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
                  onClick={handleSubmit}
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
