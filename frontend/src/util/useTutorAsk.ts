import { useEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { api, type AskStreamRequest } from "../api/client";
import { evalSamplingConsentForRequest } from "../features/anon/evalSamplingConsent";
import { useAIStore } from "../state/aiStore";
import { usePreferencesStore } from "../state/preferencesStore";
import { useRunStore } from "../state/runStore";
import {
  beginProjectOperation,
  isProjectOperationCurrent,
  isProjectVersionCurrent,
  useProjectStore,
} from "../state/projectStore";
import { useAIStatus, notePlatformQuestionConsumed } from "../state/useAIStatus";
import type { EditorSelection, ProjectFile, AIMessage } from "../types";
import { computeDiffSinceLast } from "./diffSinceLast";
import { parsePartialTutor } from "./partialJson";

// Shape passed to each panel's buildBody callback. The hook owns the
// snapshot/diff/history lifecycle and hands the caller exactly the values it
// needs to compose a request body — the caller is responsible only for the
// language/persona/lessonContext bits that differ per panel.
export interface BuildBodyInput {
  question: string;
  files: ProjectFile[];
  diffSinceLastTurn: string | null;
  historyForSend: AIMessage[];
  selection: EditorSelection | null;
}

export interface UseTutorAskOpts {
  // Compose the final AskStreamRequest from the shared inputs the hook gathers.
  buildBody: (input: BuildBodyInput) => Omit<AskStreamRequest, "requestId">;
  // Pre-send hook — returns an optionally-adjusted history slice. The editor
  // panel uses this to plan a background summarize pass and ship a trimmed
  // window; guided mode omits it and ships the full turn-by-turn history.
  beforeSend?: (ctx: { history: AIMessage[] }) => AIMessage[] | undefined;
  // Fires exactly once per ask, after the stream terminates. `ok: true` means
  // the assistant returned a response (onDone); `ok: false` means error /
  // cancel / abort / thrown. Used for side-effects bound to the ask outcome
  // — e.g. the guided panel's hint counter only commits on success, so the
  // student doesn't burn a hint on a 500 they never saw.
  onAskComplete?: (outcome: { ok: boolean }) => void;
  /**
   * Phase 27-v2.1 — endpoint override for anon mode. Defaults to the
   * authed `/api/ai/ask/stream`; anon callers pass
   * `/api/anon/ai/ask/stream`. The guided/editor tutor panels select
   * the right endpoint based on the LessonPage mode prop they were
   * mounted under.
   */
  endpoint?: string;
  /**
   * Phase 27-v2.1 — mode-aware behavior. When "anon": skip the
   * /api/user/ai-status fetch (would 401 without a session), treat the
   * caller as configured (anon endpoint has its own auth-free contract +
   * server-side L_anon per-IP cap), and skip the optimistic
   * platform-quota decrement (anon doesn't have a per-user platform
   * quota — only an IP-scoped one the server tracks).
   */
  mode?: "authed" | "anon";
  /**
   * Phase 27-v2.1 audit pass 1 fix #5: invoked when the anon AI cap
   * (L_anon, server-side per-IP daily limit) is hit. The server returns
   * 429 with body `{"error":"ANON_EXHAUSTED",...}` from /api/anon/ai/
   * ask/stream. Without this hook, the raw error string would render
   * in AskErrorView with a Retry button that 429s again. The wrapper
   * (AnonLessonPage) opens the SignupWallDialog with reason="exhausted"
   * — same surface the wall uses for the save/next-lesson paths,
   * different framing copy.
   */
  onAnonExhausted?: () => void;
  /**
   * Phase 27-v2.2 audit fix E1 (staff-ux): invoked when the anon kill
   * switch is on (server returns 503 with `ANON_LESSON_DISABLED`).
   * Wrapper opens the SignupWallDialog with reason="trial-paused" so
   * an actively-engaged user doesn't bounce on a raw "Request failed"
   * during an operator-driven incident response.
   */
  onAnonTrialPaused?: () => void;
}

export interface UseTutorAskResult {
  submitAsk: (question: string) => Promise<void>;
  cancelAsk: () => void;
}

/** Strip UI-only scripted turns and all non-wire metadata at the boundary. */
export function historyForTutor(history: AIMessage[]): AIMessage[] {
  return history
    .filter((message) => !message.meta?.scripted)
    .map((message) => ({ role: message.role, content: message.content }));
}

// Shared wrapper around api.askAIStream that owns the panel-agnostic lifecycle
// (abort, snapshot, diff, stream updates, post-abort commit). Both the editor
// AssistantPanel and the guided GuidedTutorPanel use this — previously each
// carried its own near-identical ~100-line copy of this logic.
export function useTutorAsk(opts: UseTutorAskOpts): UseTutorAskResult {
  // P-C1: shallow-compared reactive slice + stable action refs. A no-arg
  // `useAIStore()` re-runs this hook's body on every noteEdit/noteRun tick,
  // which fires during the stream loop (each delta triggers updateStream).
  const { selectedModel, history, asking, lastTurnFiles, activeSelection, chatContext, tutorProgressToken } =
    useAIStore(
      useShallow((s) => ({
        selectedModel: s.selectedModel,
        history: s.history,
        asking: s.asking,
        lastTurnFiles: s.lastTurnFiles,
        activeSelection: s.activeSelection,
        chatContext: s.chatContext,
        tutorProgressToken: s.tutorProgressToken,
      })),
    );
  const pushUser = useAIStore((s) => s.pushUser);
  const pushAssistant = useAIStore((s) => s.pushAssistant);
  const setAsking = useAIStore((s) => s.setAsking);
  const setAskError = useAIStore((s) => s.setAskError);
  const startStream = useAIStore((s) => s.startStream);
  const updateStream = useAIStore((s) => s.updateStream);
  const clearStream = useAIStore((s) => s.clearStream);
  const commitTurnSnapshot = useAIStore((s) => s.commitTurnSnapshot);
  const setActiveSelection = useAIStore((s) => s.setActiveSelection);
  const setTutorProgressToken = useAIStore((s) => s.setTutorProgressToken);

  const hasKey = usePreferencesStore((s) => s.hasOpenaiKey);
  const snapshot = useProjectStore((s) => s.snapshot);
  const projectRevision = useProjectStore((s) => s.revision);
  const projectContext = useProjectStore((s) => s.projectContext);
  const inputRevision = useRunStore((s) => s.inputRevision);
  const isAnon = opts.mode === "anon";
  const { status: aiStatus } = useAIStatus({ skip: isAnon });
  const abortRef = useRef<AbortController | null>(null);

  // An edit or context switch makes every in-flight tutor chunk stale. Abort
  // promptly to avoid spending tokens on a response that is no longer allowed
  // to enter the current conversation; callback guards below remain the
  // authoritative protection in case the transport races the abort.
  useEffect(() => {
    abortRef.current?.abort();
  }, [projectRevision, projectContext, chatContext, inputRevision]);

  // Platform (free-tier) users have no BYOK key and no selectedModel — the
  // backend picks `gpt-4.1-nano` for them. Mirror the panel-level gate here
  // so submitAsk doesn't early-return for every platform user.
  // Anon: always configured. The /api/anon/ai/ask/stream endpoint accepts
  // unauthenticated callers (subject to the L_anon per-IP cap); there's no
  // BYOK / selectedModel concept for anon, and we must NOT early-return
  // submitAsk on isAnon paths.
  const onPlatform = !hasKey && aiStatus?.source === "platform";
  const configured = isAnon || onPlatform || (hasKey && !!selectedModel);

  const submitAsk = async (question: string): Promise<void> => {
    const trimmed = question.trim();
    if (!trimmed || !configured || asking) return;

    const operation = beginProjectOperation();
    const inputRevisionForTurn = inputRevision;
    const conversationForTurn = chatContext;
    const selectionForTurn =
      activeSelection && isProjectVersionCurrent(activeSelection.project)
        ? activeSelection.selection
        : null;
    setActiveSelection(null);
    pushUser(trimmed);
    setAsking(true);
    setAskError(null);
    startStream();

    const controller = new AbortController();
    abortRef.current = controller;
    let completionNotified = false;
    const operationIsCurrent = (): boolean =>
      abortRef.current === controller &&
      useAIStore.getState().chatContext === conversationForTurn &&
      useRunStore.getState().inputRevision === inputRevisionForTurn &&
      isProjectOperationCurrent(operation);
    const notifyCompletion = (ok: boolean): void => {
      if (completionNotified) return;
      completionNotified = true;
      opts.onAskComplete?.({ ok });
    };
    let raw = "";
    let committed = false;

    // P-C2: throttle the partial-JSON parse + store update. At ~50 tokens/s
    // the provider emits chunks every ~20ms; re-parsing the growing buffer
    // on every chunk walked O(n²) work and dragged the whole panel into a
    // re-render loop. 100ms feels instant to a human but drops parse work
    // by ~5x during the fastest parts of a stream. Prefer requestIdleCallback
    // (browsers only call back when the main thread is free) with a 100ms
    // deadline so a busy tab still animates smoothly.
    type TimerHandle = number | ReturnType<typeof setTimeout>;
    let pendingParse: TimerHandle | null = null;
    const cancelPending = (): void => {
      if (pendingParse == null) return;
      if (typeof window !== "undefined" && "cancelIdleCallback" in window) {
        (window as Window).cancelIdleCallback!(pendingParse as number);
      } else {
        clearTimeout(pendingParse as ReturnType<typeof setTimeout>);
      }
      pendingParse = null;
    };
    const scheduleParse = (): void => {
      if (pendingParse != null) return;
      const flush = (): void => {
        pendingParse = null;
        if (!operationIsCurrent()) return;
        updateStream(raw, parsePartialTutor(raw));
      };
      if (typeof window !== "undefined" && "requestIdleCallback" in window) {
        pendingParse = (window as Window).requestIdleCallback!(flush, { timeout: 100 });
      } else {
        pendingParse = setTimeout(flush, 100);
      }
    };

    try {
      const files = snapshot();
      const diffSinceLastTurn = computeDiffSinceLast(lastTurnFiles, files);
      // Snapshot BEFORE the request goes out so that edits/runs during the
      // model's thinking time are attributed to the NEXT turn.
      commitTurnSnapshot(files);

      const adjusted = opts.beforeSend?.({ history });
      // Scripted cinematic narration is presentation, not a completed model
      // turn. Never let it masquerade as progression or steer the generated
      // tutor conversation.
      const historyForSend = historyForTutor(adjusted ?? history);

      // Release 0D: the server uses this as the idempotency key for the
      // accepted action. A retry button is a new user action and therefore
      // calls submitAsk again with a fresh UUID.
      const body: AskStreamRequest = {
        ...opts.buildBody({
          question: trimmed,
          files,
          diffSinceLastTurn,
          historyForSend,
          selection: selectionForTurn,
        }),
        requestId: crypto.randomUUID(),
        tutorProgressToken: tutorProgressToken ?? undefined,
        evalSamplingConsent: isAnon
          ? evalSamplingConsentForRequest()
          : undefined,
      };

      let askOk = false;
      await api.askAIStream(
        body,
        {
          signal: controller.signal,
          onDelta: (chunk) => {
            if (!operationIsCurrent()) return;
            raw += chunk;
            scheduleParse();
          },
          onDone: (finalRaw, sections, usage, nextTutorProgressToken) => {
            cancelPending();
            if (!operationIsCurrent()) return;
            pushAssistant(finalRaw || raw, sections, usage);
            if (nextTutorProgressToken) {
              setTutorProgressToken(nextTutorProgressToken);
            }
            clearStream();
            committed = true;
            askOk = true;
            // P-H6: optimistic local decrement avoids a /ai-status refetch per
            // turn. The 30s cache + next natural fetch reconciles if we drift.
            // Anon: skip — there's no /api/user/ai-status cache to decrement,
            // and the L_anon ledger is per-IP server-side.
            if (!isAnon && aiStatus?.source === "platform")
              notePlatformQuestionConsumed();
          },
          onError: (message) => {
            cancelPending();
            if (!operationIsCurrent()) return;
            // Phase 27-v2.1 audit pass 1 fix #5: detect the L_anon
            // cap-exceeded error code and route to the wall instead
            // of showing a generic AskErrorView with a Retry button
            // (which would just 429 again). Match defensively on
            // both the raw token and any reasonable variation the
            // server might send so a backend copy tweak doesn't
            // silently regress this.
            if (
              isAnon &&
              opts.onAnonExhausted &&
              // Pass 2 P2 #2: dropped bare `429` to avoid false-positives
              // (generic upstream rate-limit copy that mentions "HTTP 429"
              // would otherwise wrongly open the wall). Backend always
              // returns the literal "ANON_EXHAUSTED" token in the body
              // for the L_anon path (backend/src/routes/anon.ts:202),
              // so case-insensitive match on that is sufficient + safe.
              /ANON_EXHAUSTED/i.test(message)
            ) {
              opts.onAnonExhausted();
              clearStream();
              committed = true;
              return;
            }
            // Phase 27-v2.2 audit fix E1: kill-switch-flipped path.
            // Backend returns 503 with body containing
            // ANON_LESSON_DISABLED. Same wall pivot as ANON_EXHAUSTED,
            // different framing reason.
            if (
              isAnon &&
              opts.onAnonTrialPaused &&
              /ANON_LESSON_DISABLED/i.test(message)
            ) {
              opts.onAnonTrialPaused();
              clearStream();
              committed = true;
              return;
            }
            setAskError(message);
            clearStream();
            committed = true;
          },
        },
        opts.endpoint ? { endpoint: opts.endpoint } : undefined,
      );

      // Abort path: askAIStream returns without firing onDone/onError. Commit
      // partial text so the student keeps the context rather than losing it.
      // An aborted ask still counts as "not ok" for outcome-bound side-effects
      // (e.g. hint rollback) — the student pressed Stop or walked away.
      if (!committed && controller.signal.aborted && raw.trim() && operationIsCurrent()) {
        cancelPending();
        pushAssistant(raw, parsePartialTutor(raw));
        clearStream();
      }
      if (operationIsCurrent()) notifyCompletion(askOk);
    } catch (err) {
      cancelPending();
      if (operationIsCurrent()) {
        setAskError((err as Error).message);
        clearStream();
        notifyCompletion(false);
      }
    } finally {
      cancelPending();
      if (abortRef.current === controller) {
        notifyCompletion(false);
        // Same conversation but edited source: clear the now-orphaned stream.
        // A context switch already loaded its own clean stream state.
        if (useAIStore.getState().chatContext === conversationForTurn) {
          clearStream();
          setAsking(false);
        }
        abortRef.current = null;
      }
    }
  };

  const cancelAsk = (): void => {
    abortRef.current?.abort();
  };

  return { submitAsk, cancelAsk };
}
