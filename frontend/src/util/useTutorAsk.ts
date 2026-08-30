import { useCallback, useEffect, useRef } from "react";
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
import {
  invalidateAIStatus,
  latchPlatformAIStatusPause,
  notePlatformQuestionConsumed,
  useAIStatus,
} from "../state/useAIStatus";
import type {
  ContextualTutorOfferRequest,
  EditorSelection,
  ProjectFile,
  AIMessage,
  TutorAction,
} from "../types";
import { computeDiffSinceLast } from "./diffSinceLast";
import { parsePartialTutor } from "./partialJson";
import { isPlatformTutorPaused } from "./tutorErrors";

export function isCompatibleTutorModel(model: string): boolean {
  const normalized = model.trim().toLocaleLowerCase();
  const excluded = [
    "audio",
    "realtime",
    "image",
    "transcribe",
    "tts",
    "search",
    "codex",
    "chat-latest",
    "pro",
  ];
  if (excluded.some((family) => normalized.includes(family))) return false;
  const major = normalized.match(/^gpt-(\d+)(?:[.-]|$)/)?.[1];
  return major !== undefined && Number(major) >= 5;
}

export function tutorRequestModel({
  selectedModel,
  onPlatform,
  isAnon,
}: {
  selectedModel: string | null;
  onPlatform: boolean;
  isAnon: boolean;
}): string | null {
  if (onPlatform || isAnon) return null;
  return selectedModel && isCompatibleTutorModel(selectedModel)
    ? selectedModel
    : null;
}

export function contextualOfferInvalidationForError(
  message: string,
  mode: "authed" | "anon",
): "stale" | "disabled" | "model" | "quota" | null {
  if (/CONTEXTUAL_EVIDENCE_STALE/i.test(message)) return "stale";
  if (/CONTEXTUAL_TUTOR_DISABLED/i.test(message)) return "disabled";
  if (/MODEL_NOT_EVALUATED_FOR_CONTEXTUAL_OFFER/i.test(message)) return "model";
  if (mode === "anon" && /ANON_EXHAUSTED/i.test(message)) return "quota";
  if (mode === "authed" && /FREE_TIER_EXHAUSTED/i.test(message)) return "quota";
  return null;
}

/** Load a current compatible choice before an existing BYOK user can ask. */
export function useByokTutorModelReady(enabled: boolean): boolean {
  const selectedModel = useAIStore((state) => state.selectedModel);
  const modelsStatus = useAIStore((state) => state.modelsStatus);
  const setModels = useAIStore((state) => state.setModels);
  const setModelsStatus = useAIStore((state) => state.setModelsStatus);

  useEffect(() => {
    if (!enabled || modelsStatus !== "idle") return;
    setModelsStatus("loading");
    api.listOpenAIModels()
      .then(({ models }) => {
        setModels(models);
        setModelsStatus("loaded");
      })
      .catch((error) => {
        setModelsStatus("error", (error as Error).message);
      });
  }, [enabled, modelsStatus, setModels, setModelsStatus]);

  return enabled && selectedModel !== null && isCompatibleTutorModel(selectedModel);
}

// Shape passed to each panel's buildBody callback. The hook owns the
// snapshot/diff/history lifecycle and hands the caller exactly the values it
// needs to compose a request body — the caller is responsible only for the
// language/persona/lessonContext bits that differ per panel.
export interface BuildBodyInput {
  question: string;
  tutorAction?: TutorAction;
  contextualOffer?: ContextualTutorOfferRequest;
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
  /** Invalidates a contextual offer whose signed evidence can no longer be used. */
  onContextualOfferInvalidated?: (
    reason: "stale" | "disabled" | "model" | "quota",
  ) => void;
  onAllowanceUpdate?: (remainingToday: number | null) => void;
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
  submitAsk: (
    question: string,
    options?: {
      appendUser?: boolean;
      tutorAction?: TutorAction;
      contextualOffer?: ContextualTutorOfferRequest;
    },
  ) => Promise<void>;
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
  const {
    selectedModel,
    history,
    asking,
    lastTurnFiles,
    activeSelection,
    chatContext,
    tutorProgressToken,
    conversationRevision,
  } =
    useAIStore(
      useShallow((s) => ({
        selectedModel: s.selectedModel,
        history: s.history,
        asking: s.asking,
        lastTurnFiles: s.lastTurnFiles,
        activeSelection: s.activeSelection,
        chatContext: s.chatContext,
        tutorProgressToken: s.tutorProgressToken,
        conversationRevision: s.conversationRevision,
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
  const activeRequestIdRef = useRef<string | null>(null);

  const refundDiscardedRequest = useCallback((requestId: string): void => {
    const endpoint = isAnon
      ? "/api/anon/ai/ask/cancel"
      : "/api/ai/ask/cancel";
    void api.cancelAIAsk(requestId, endpoint).catch(() => {
      // The abort still stops rendering stale work. A failed refund is
      // reconciled by the next authoritative status fetch and surfaced in
      // server logs rather than replacing the learner's Stop explanation.
    }).finally(() => {
      if (!isAnon && aiStatus?.source === "platform") invalidateAIStatus();
    });
  }, [aiStatus?.source, isAnon]);
  // Quota/status hydration is allowed to finish while a tutor request is in
  // flight. Keep the latest refund implementation available without making
  // its changing identity look like a project-context change: when
  // /ai-status resolves after the learner presses Ask, `aiStatus.source`
  // changes and therefore recreates the callback above. Depending on that
  // callback in the invalidation effect used to abort a perfectly current
  // answer with the misleading "Code changed" recovery card.
  const refundDiscardedRequestRef = useRef(refundDiscardedRequest);
  useEffect(() => {
    refundDiscardedRequestRef.current = refundDiscardedRequest;
  }, [refundDiscardedRequest]);

  // An edit or context switch makes every in-flight tutor chunk stale. Abort
  // promptly to avoid spending tokens on a response that is no longer allowed
  // to enter the current conversation; callback guards below remain the
  // authoritative protection in case the transport races the abort.
  useEffect(() => {
    if (!abortRef.current) return;
    setAskError("TUTOR_CONTEXT_CHANGED");
    const requestId = activeRequestIdRef.current;
    activeRequestIdRef.current = null;
    if (requestId) refundDiscardedRequestRef.current(requestId);
    abortRef.current.abort();
  }, [
    projectRevision,
    projectContext,
    chatContext,
    inputRevision,
    conversationRevision,
    setAskError,
  ]);

  // Platform (free-tier) users do not need a BYOK model. An older account may
  // still carry a persisted selection, but the backend owns the funded model.
  // Mirror the panel-level gate here so submitAsk cannot early-return.
  // Anon: always configured. The /api/anon/ai/ask/stream endpoint accepts
  // unauthenticated callers (subject to the L_anon per-IP cap); there's no
  // BYOK / selectedModel concept for anon, and we must NOT early-return
  // submitAsk on isAnon paths.
  const onPlatform = !hasKey && aiStatus?.source === "platform";
  const effectiveModel = tutorRequestModel({ selectedModel, onPlatform, isAnon });
  const configured = isAnon || onPlatform || (hasKey && effectiveModel !== null);

  const submitAsk = async (
    question: string,
    options: {
      appendUser?: boolean;
      tutorAction?: TutorAction;
      contextualOffer?: ContextualTutorOfferRequest;
    } = {},
  ): Promise<void> => {
    const trimmed = question.trim();
    if (!trimmed || !configured || asking) return;

    const operation = beginProjectOperation();
    const inputRevisionForTurn = inputRevision;
    const conversationForTurn = chatContext;
    const conversationRevisionForTurn = conversationRevision;
    const selectionForTurn =
      activeSelection && isProjectVersionCurrent(activeSelection.project)
        ? activeSelection.selection
        : null;
    setActiveSelection(null);
    if (options.appendUser !== false) pushUser(trimmed);
    setAsking(true);
    setAskError(null);
    startStream();

    const controller = new AbortController();
    abortRef.current = controller;
    let completionNotified = false;
    const operationIsCurrent = (): boolean =>
      abortRef.current === controller &&
      useAIStore.getState().chatContext === conversationForTurn &&
      useAIStore.getState().conversationRevision === conversationRevisionForTurn &&
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
      const requestId = crypto.randomUUID();
      activeRequestIdRef.current = requestId;
      const requestedBody = opts.buildBody({
          question: trimmed,
          tutorAction: options.tutorAction,
          contextualOffer: options.contextualOffer,
          files,
          diffSinceLastTurn,
          historyForSend,
          selection: selectionForTurn,
        });
      const body: AskStreamRequest = {
        ...requestedBody,
        // Platform funding owns its model. Normalize at the shared transport
        // boundary as well as in each panel so a stale persisted BYOK model
        // can never leak into an anonymous or platform-funded request.
        model: effectiveModel ?? requestedBody.model,
        requestId,
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
          onDone: (
            finalRaw,
            sections,
            usage,
            nextTutorProgressToken,
            remainingToday,
            countsTowardQuota,
          ) => {
            cancelPending();
            if (!operationIsCurrent()) return;
            activeRequestIdRef.current = null;
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
            if (
              countsTowardQuota !== false &&
              !isAnon &&
              aiStatus?.source === "platform"
            )
              notePlatformQuestionConsumed();
            if (remainingToday !== undefined) {
              opts.onAllowanceUpdate?.(remainingToday);
            }
          },
          onError: (message) => {
            cancelPending();
            if (!operationIsCurrent()) return;
            activeRequestIdRef.current = null;
            // The transport can report its own AbortError after the learner
            // presses Stop (or after a context change). The action that
            // initiated the abort already installed the useful explanation;
            // never replace it with browser-specific text such as
            // "signal is aborted without reason".
            if (controller.signal.aborted) {
              clearStream();
              committed = true;
              return;
            }
            const contextualInvalidation = options.contextualOffer
              ? contextualOfferInvalidationForError(
                  message,
                  isAnon ? "anon" : "authed",
                )
              : null;
            if (contextualInvalidation === "stale") {
              opts.onContextualOfferInvalidated?.("stale");
              setAskError("CONTEXTUAL_EVIDENCE_STALE");
              clearStream();
              committed = true;
              return;
            }
            if (contextualInvalidation === "disabled") {
              opts.onContextualOfferInvalidated?.("disabled");
            }
            if (contextualInvalidation === "model") {
              opts.onContextualOfferInvalidated?.("model");
            }
            if (!isAnon && contextualInvalidation === "quota") {
              // Another signed-in tab can consume the last platform turn
              // after this panel advertises contextual help. Admission did
              // not spend this proof, so retain the authored guide and
              // refresh the server-owned allowance before offering AI again.
              opts.onContextualOfferInvalidated?.("quota");
              invalidateAIStatus();
            }
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
              if (options.contextualOffer) {
                // The server refused this before admission, so the signed
                // proof is still unspent. Preserve the free authored guide
                // while the anonymous quota wall explains why AI is paused.
                opts.onContextualOfferInvalidated?.("quota");
              }
              pushAssistant(
                "I couldn't send that because today's free tutor questions are used. Your question is still here, and you can keep working without the tutor or create an account for the full daily allowance.",
                undefined,
                undefined,
                { scripted: true },
              );
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
            if (!isAnon && isPlatformTutorPaused(message)) {
              // The question-count pill is not the authority for independent
              // server-owned spend controls. Rehydrate immediately so the
              // composer locks and the BYOK recovery surface replaces a stale
              // positive allowance instead of inviting futile retries.
              latchPlatformAIStatusPause(message);
              invalidateAIStatus();
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
        if (!controller.signal.aborted) {
          setAskError((err as Error).message);
        }
        clearStream();
        notifyCompletion(false);
      }
    } finally {
      cancelPending();
      if (abortRef.current === controller) {
        activeRequestIdRef.current = null;
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
    if (!abortRef.current) return;
    setAskError("TUTOR_CANCELED_BY_USER");
    const requestId = activeRequestIdRef.current;
    activeRequestIdRef.current = null;
    if (requestId) refundDiscardedRequest(requestId);
    abortRef.current?.abort();
  };

  return { submitAsk, cancelAsk };
}
