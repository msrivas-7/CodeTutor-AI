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
import { SavedTutorBookmark } from "../../../components/SavedTutorBookmark";
import { SavedTutorAccordion } from "../../../components/SavedTutorAccordion";
import { useShortcutLabels } from "../../../util/platform";
import { useSavedTutorMessages } from "../hooks/useSavedTutorMessages";
import { useProgressStore } from "../stores/progressStore";
import type { LessonMeta, PracticeExercise } from "../types";

interface GuidedTutorPanelProps {
  lessonMeta: LessonMeta;
  totalLessons: number;
  progressSummary: string;
  // Concepts taught in earlier lessons + course baseVocabulary. Used to scope
  // the tutor's explanations ("safe to reference") vs. future material.
  priorConcepts: string[];
  // When the learner is in practice mode AND has an active exercise,
  // pass it through so the tutor reasons about THAT exercise's prompt
  // + goal + completionRules instead of the lesson's main objectives.
  // Without this the AI would happily explain "the lesson goal" while
  // the student is asking about a sub-exercise — wrong frame, wrong
  // hints. Null/undefined means lesson mode (default).
  activePracticeExercise?: PracticeExercise | null;
  onCollapse?: () => void;
  onOpenSettings?: () => void;
  resetNonce?: number;
  // When true, the composer + Ask / action chips / hint button are
  // disabled. Used by LessonPage during the first-run scripted
  // choreography so the learner doesn't type into the tutor mid-
  // narration — we want them to watch the scripted turn land before
  // taking the wheel.
  inputLocked?: boolean;
  // When true, hide the "clear" button in the panel header. Clearing
  // the chat mid-welcome would wipe the scripted tutor turns and
  // break the flow; simplest fix is to take the affordance away for
  // the duration of the cinematic.
  clearHidden?: boolean;
  /**
   * Phase 27-v2.1 — when "anon", routes the AI stream to
   * `/api/anon/ai/ask/stream` (subject to the L_anon per-IP cap)
   * instead of the authed `/api/ai/ask/stream`. Default "authed"
   * preserves all existing behavior.
   */
  mode?: "authed" | "anon";
  /**
   * Phase 27-v2.1 audit pass 1 fix #5: invoked when the anon path
   * hits the L_anon per-IP cap (server returns 429 with body
   * ANON_EXHAUSTED). The wrapper opens SignupWallDialog reason="exhausted".
   * Only meaningful when mode === "anon".
   */
  onAnonExhausted?: () => void;
  /**
   * Phase 27-v2.2 audit fix E1: invoked when the anon kill switch is
   * on (server 503 ANON_LESSON_DISABLED). Opens reason="trial-paused".
   */
  onAnonTrialPaused?: () => void;
}

export function GuidedTutorPanel({ lessonMeta, totalLessons, progressSummary, priorConcepts, activePracticeExercise, onCollapse, onOpenSettings, resetNonce, inputLocked, clearHidden, mode = "authed", onAnonExhausted, onAnonTrialPaused }: GuidedTutorPanelProps) {
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
    pendingScripted,
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
  // Phase 27-v2.1 — anon skips this fetch; the panel's chip + setup-warning
  // surfaces are conditionally rendered for authed only (anon has no BYOK
  // surface, no platform quota counter — its limit is server-side L_anon).
  const { status: aiStatus } = useAIStatus({ skip: mode === "anon" });

  // Phase 21A: saved tutor messages, scoped to this lesson and (if in
  // practice mode) this specific practice exercise. Editor scope is null;
  // the AssistantPanel handles that path separately.
  const savedScope = {
    courseId: lessonMeta.courseId,
    lessonId: lessonMeta.id,
    exerciseId: activePracticeExercise?.id ?? null,
  };
  const {
    savedIds,
    savedMessages,
    loading: savedLoading,
    save: saveTutorMessage,
    unsave: unsaveTutorMessage,
  } = useSavedTutorMessages(savedScope, mode);

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

  // Phase 27-v2.1: anon panel is always configured. The
  // /api/anon/ai/ask/stream endpoint accepts unauthenticated callers
  // (subject to L_anon per-IP cap); there's no BYOK / selectedModel
  // surface to gate on. Without this, TutorSetupWarning would render
  // "Add your OpenAI API key…" on Maya's trial path — a hard break
  // for the persona we're trying to land. Mirrors the gate inside
  // useTutorAsk where submitAsk treats anon as configured.
  const configured = mode === "anon" || onPlatform || (hasKey && !!selectedModel);

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
    // Phase 27-v2.1 — anon mode routes the AI stream to the unauthed
    // /api/anon/ai/ask/stream surface (subject to L_anon per-IP cap),
    // skips the /api/user/ai-status fetch, and treats the caller as
    // configured (no BYOK / selectedModel gate). Default omitted =
    // useTutorAsk falls through to authed endpoint with status fetch.
    endpoint: mode === "anon" ? "/api/anon/ai/ask/stream" : undefined,
    mode,
    onAnonExhausted,
    onAnonTrialPaused,
    onAskComplete: ({ ok }) => {
      if (pendingHintRef.current) {
        pendingHintRef.current = false;
        // Phase 27-v2.1 — anon doesn't write hint counts to /api/user/*.
        // The hint UI still increments locally (cosmetic) but the
        // server-side counter is suppressed.
        if (ok && mode === "authed") incrementHint(lessonMeta.courseId, lessonMeta.id);
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
        // In practice mode, override the three fields the backend
        // prompt actually uses (lessonTitle, lessonObjectives,
        // completionRules) with the active exercise's framing so the
        // tutor reasons about THIS exercise, not the lesson's main
        // goal. Other fields (concept tags, priorConcepts, lessonOrder,
        // totalLessons) stay — they're the same broader context.
        lessonTitle: activePracticeExercise
          ? `${lessonMeta.title} → Practice: ${activePracticeExercise.title}`
          : lessonMeta.title,
        language: lessonMeta.language,
        lessonObjectives: activePracticeExercise
          ? [activePracticeExercise.prompt, `Goal: ${activePracticeExercise.goal}`]
          : lessonMeta.objectives,
        teachesConceptTags: lessonMeta.teachesConceptTags,
        usesConceptTags: lessonMeta.usesConceptTags,
        priorConcepts,
        completionRules: activePracticeExercise
          ? activePracticeExercise.completionRules
          : lessonMeta.completionRules,
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
          {!clearHidden && (
          <button
            onClick={() => { clearConversation(); setDraft(""); }}
            className="min-h-11 rounded-lg px-3 py-2 text-sm text-muted transition hover:bg-elevated hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
            disabled={history.length === 0 || asking}
            title="Clear conversation"
          >
            clear
          </button>
          )}
          {onCollapse && (
            <button
              onClick={onCollapse}
              title="Collapse tutor"
              aria-label="Collapse tutor"
              className="flex h-11 w-11 items-center justify-center rounded-lg text-muted transition hover:bg-elevated hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M10.5 3.5L6 8l4.5 4.5L12 11 9 8l3-3z" />
              </svg>
            </button>
          )}
        </div>
      </header>

      {/* Phase 21A iter-3: SavedTutorAccordion lives OUTSIDE the chat
          scroll area so it stays visible no matter how long the live
          conversation grows. When expanded it bounds its own height
          and scrolls internally. */}
      <SavedTutorAccordion
        messages={savedMessages}
        loading={savedLoading}
        onRemove={(id) => { void unsaveTutorMessage(id); }}
      />

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
          <div className="rounded-lg border border-border bg-elevated/60 p-3 text-base leading-relaxed text-muted sm:text-body">
            <div className="mb-1.5 font-semibold text-ink">
              Lesson {lessonMeta.order}: {lessonMeta.title}
            </div>
            Your tutor is here to help — ask anything about this lesson. I'll guide you without giving away the answer.
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              <button
                onClick={() => setPendingAsk("What should I do in this lesson?")}
                className="min-h-11 rounded-lg border border-border bg-bg/60 px-3 py-2 text-sm text-ink/80 transition hover:border-accent/40 hover:bg-accent/10 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                What should I do?
              </button>
              <button
                onClick={() => setPendingAsk("I don't understand the instructions. Can you explain?")}
                className="min-h-11 rounded-lg border border-border bg-bg/60 px-3 py-2 text-sm text-ink/80 transition hover:border-accent/40 hover:bg-accent/10 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Explain the task
              </button>
              <button
                onClick={() => setPendingAsk("Give me a hint to get started.")}
                className="min-h-11 rounded-lg border border-border bg-bg/60 px-3 py-2 text-sm text-ink/80 transition hover:border-accent/40 hover:bg-accent/10 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
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
          const isAssistant = m.role === "assistant";
          const messageId = m.id;
          const canSave = isAssistant && !!messageId && !m.meta?.scripted;
          const isSaved = canSave ? savedIds.has(messageId) : false;
          const handleToggleSave = () => {
            if (!canSave || !messageId) return;
            if (isSaved) {
              const existing = savedMessages.find((s) => s.messageId === messageId);
              if (existing) void unsaveTutorMessage(existing.id);
            } else {
              void saveTutorMessage({
                messageId,
                content: m.content,
                sections: (m.sections ?? null) as Record<string, unknown> | null,
                model: selectedModel,
              });
            }
          };
          // Always render the bottom chrome row for assistant messages with
          // an id (post-Phase-21A iteration 2): the bookmark needs a stable
          // home that's always visible, not absolute-overlayed on the response
          // text. Hint button + ActionChips still gate on isLatestAssistant.
          const showChrome =
            isAssistant && (canSave || isLatestAssistant || (m.role === "assistant" && m.usage));
          return (
            <div key={messageId ?? i} className="flex flex-col gap-2 motion-safe:animate-fadeInUp">
              {m.role === "user" ? (
                <div className="self-end max-w-[90%] rounded-lg bg-accent/15 px-3 py-2 text-base leading-relaxed text-ink ring-1 ring-accent/30 sm:text-body">
                  {m.content}
                </div>
              ) : m.sections ? (
                <TutorResponseView
                  sections={m.sections}
                  onAsk={isLatestAssistant ? setPendingAsk : undefined}
                  disabled={asking}
                  scripted={m.meta?.scripted}
                />
              ) : (
                <div className="whitespace-pre-wrap rounded-lg border border-border bg-elevated/60 px-3 py-2 text-base leading-relaxed text-ink/90 sm:text-body">
                  {m.content}
                </div>
              )}
              {showChrome && (
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
                          disabled={asking || inputLocked}
                          aria-label={
                            hintLevel === 0
                              ? "Nudge me — a gentle hint without the answer"
                              : hintLevel === 1
                                ? "I need more — a stronger pointer"
                                : "Walk me through it — a step-by-step approach"
                          }
                          title={
                            hintLevel === 0
                              ? "A gentle nudge — no spoilers"
                              : hintLevel === 1
                                ? "A stronger pointer toward the solution"
                                : "A walk-through of the approach"
                          }
                          className="flex min-h-11 items-center gap-1.5 rounded-full border border-warn/40 bg-warn/10 px-3 py-2 text-sm font-medium text-warnInk transition hover:bg-warn/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-warn disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <span aria-hidden="true">💡</span>
                          <span>
                            {hintLevel === 0
                              ? "Nudge me"
                              : hintLevel === 1
                                ? "I need more"
                                : "Walk me through it"}
                          </span>
                        </button>
                      ) : (
                        <span
                          className="flex items-center gap-1 rounded-full border border-border bg-elevated/60 px-2 py-[2px] text-[10px] font-medium text-faint"
                          title="That's all the nudges. Try asking a specific follow-up question instead."
                        >
                          <span aria-hidden="true">💡</span>
                          <span>Out of nudges</span>
                        </span>
                      )}
                      <ActionChips onAsk={setPendingAsk} disabled={asking || inputLocked} />
                    </div>
                  )}
                  <div className="flex items-center justify-end gap-1.5">
                    {m.role === "assistant" && m.usage && !onPlatform && (
                      <UsageChip usage={m.usage} modelId={selectedModel} />
                    )}
                    {canSave && (
                      <SavedTutorBookmark saved={isSaved} onToggle={handleToggleSave} />
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {asking && (
          pending && hasTutorContent(pending.sections)
            ? <TutorResponseView sections={pending.sections} disabled streaming scripted={pendingScripted} />
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
                inputLocked
                  ? "Watch for a sec — I'll hand the panel back."
                  : activeSelection
                    ? "Ask about the selection…"
                    : configured
                      ? "Ask about this lesson..."
                      : exhausted
                        ? `Free tutor resets ${formatReset(aiStatus?.resetAtUtc ?? null)}`
                        : "Configure API key first"
              }
              disabled={!configured || inputLocked}
              rows={2}
              aria-label="Ask the tutor"
              className="w-full resize-none rounded-lg border border-border bg-elevated px-3 py-2 text-base text-ink transition placeholder:text-faint focus:border-accent/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:bg-elevated/40 disabled:opacity-50 sm:text-body"
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
              {asking && !inputLocked ? (
                <button
                  onClick={cancelAsk}
                  title="Stop the current response"
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-danger/15 px-3 py-2 text-sm font-semibold text-danger ring-1 ring-danger/30 transition hover:bg-danger/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger"
                >
                  <span className="inline-block h-2 w-2 rounded-sm bg-danger" />
                  Stop
                </button>
              ) : asking && inputLocked ? (
                // During the scripted choreography we deliberately
                // swallow Stop — a learner halfway through their first
                // moment shouldn't be able to derail the guide that's
                // still introducing itself. Keep the footer height
                // stable with a spacer so the layout doesn't jump.
                <span className="h-6" aria-hidden="true" />
              ) : (
                <button
                  onClick={handleSubmit}
                  disabled={!draft.trim() || !configured || inputLocked}
                  className="min-h-11 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accentMuted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:bg-elevated disabled:text-faint"
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
