import { useEffect, useRef, useState } from "react";
import { api } from "../../../api/client";
import { useAIStore } from "../../../state/aiStore";
import { useProjectStore } from "../../../state/projectStore";
import { useRunStore } from "../../../state/runStore";
import { parsePartialTutor } from "../../../util/partialJson";
import { computeDiffSinceLast } from "../../../util/diffSinceLast";
import {
  TutorResponseView,
  ActionChips,
  UsageChip,
  ThinkingSkeleton,
  AskErrorView,
  hasTutorContent,
} from "../../../components/TutorResponseViews";
import { useProgressStore } from "../stores/progressStore";
import type { LessonMeta } from "../types";

interface GuidedTutorPanelProps {
  lessonMeta: LessonMeta;
  totalLessons: number;
  progressSummary: string;
  onCollapse?: () => void;
}

export function GuidedTutorPanel({ lessonMeta, totalLessons, progressSummary, onCollapse }: GuidedTutorPanelProps) {
  const incrementHint = useProgressStore((s) => s.incrementHint);
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
    activeSelection,
    setActiveSelection,
    focusComposerNonce,
    sessionUsage,
  } = useAIStore();

  const { snapshot, activeFile } = useProjectStore();
  const lastRun = useRunStore((s) => s.result);
  const stdin = useRunStore((s) => s.stdin);

  const [draft, setDraft] = useState("");
  const [hintLevel, setHintLevel] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const configured = keyStatus === "valid" && !!selectedModel;

  useEffect(() => {
    setHintLevel(0);
  }, [lessonMeta.id]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [history.length, asking]);

  useEffect(() => {
    if (focusComposerNonce === 0) return;
    textareaRef.current?.focus();
  }, [focusComposerNonce]);

  const submitAsk = async (question: string) => {
    if (!question.trim() || !configured || asking) return;
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
      commitTurnSnapshot(files);

      await api.askAIStream(
        apiKey,
        {
          model: selectedModel!,
          question,
          files,
          activeFile: activeFile ?? undefined,
          language: "python",
          lastRun: lastRun ?? null,
          history: [...history.map((m) => ({ role: m.role, content: m.content }))],
          stdin: stdin || null,
          diffSinceLastTurn,
          runsSinceLastTurn,
          editsSinceLastTurn,
          persona: "beginner",
          selection: selectionForTurn,
          lessonContext: {
            courseId: lessonMeta.courseId,
            lessonId: lessonMeta.id,
            lessonTitle: lessonMeta.title,
            lessonObjectives: lessonMeta.objectives,
            conceptTags: lessonMeta.conceptTags,
            completionRules: lessonMeta.completionRules,
            studentProgressSummary: progressSummary,
            lessonOrder: lessonMeta.order,
            totalLessons,
          },
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

      if (!committed && controller.signal.aborted && raw.trim()) {
        pushAssistant(raw, parsePartialTutor(raw));
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
            onClick={() => { clearConversation(); setHintLevel(0); }}
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
      </header>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-auto p-3">
        {!configured && (
          <div className="rounded-md border border-warn/30 bg-warn/10 p-3 text-xs leading-relaxed text-warn">
            <div className="mb-1 font-semibold">Setup required</div>
            Open <span className="font-semibold">Settings</span> (gear icon in the header) to configure your OpenAI API key and model.
          </div>
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
                <div className="flex flex-col gap-1.5 pt-0.5">
                  {isLatestAssistant && (
                    <div className="flex flex-wrap items-center gap-1">
                      {hintLevel < 3 && (
                        <button
                          onClick={() => {
                            const prompts = [
                              "Give me a gentle hint — don't reveal the answer.",
                              "I need a stronger hint. Point me in the right direction without giving the full solution.",
                              "I'm really stuck. Walk me through the approach step by step.",
                            ];
                            setPendingAsk(prompts[hintLevel]);
                            setHintLevel((l) => l + 1);
                            incrementHint(lessonMeta.courseId, lessonMeta.id);
                          }}
                          disabled={asking}
                          className="rounded-full border border-warn/40 bg-warn/10 px-2 py-[2px] text-[10px] font-medium text-warn transition hover:bg-warn/20 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {hintLevel === 0 ? "💡 Hint" : hintLevel === 1 ? "💡 Stronger hint" : "💡 Show approach"}
                        </button>
                      )}
                      <ActionChips onAsk={setPendingAsk} disabled={asking} />
                    </div>
                  )}
                  <div className="flex items-center justify-end">
                    {m.role === "assistant" && m.usage && (
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
                .map((l: string) => (l.length > 80 ? l.slice(0, 80) + "…" : l))
                .join("\n")}
              {activeSelection.text.split("\n").length > 2 ? "\n…" : ""}
            </pre>
          </div>
        )}
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={activeSelection ? "Ask about the selection…" : configured ? "Ask about this lesson..." : "Configure API key first"}
          disabled={!configured}
          rows={2}
          className="w-full resize-none rounded-md border border-border bg-elevated px-2.5 py-2 text-xs text-ink transition placeholder:text-faint focus:border-accent/60 disabled:opacity-50"
        />
        <div className="mt-1.5 flex items-center justify-between gap-2 text-[10px] text-faint">
          <div className="flex items-center gap-x-1">
            <span className="kbd">↵</span>
            <span>send</span>
            <span className="text-border">·</span>
            <span className="kbd">⇧↵</span>
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
      </div>
    </div>
  );
}
