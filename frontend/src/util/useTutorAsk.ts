import { useRef } from "react";
import { api, type AskStreamRequest } from "../api/client";
import { useAIStore } from "../state/aiStore";
import { useProjectStore } from "../state/projectStore";
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
  buildBody: (input: BuildBodyInput) => AskStreamRequest;
  // Pre-send hook — returns an optionally-adjusted history slice. The editor
  // panel uses this to plan a background summarize pass and ship a trimmed
  // window; guided mode omits it and ships the full turn-by-turn history.
  beforeSend?: (ctx: { history: AIMessage[] }) => AIMessage[] | undefined;
}

export interface UseTutorAskResult {
  submitAsk: (question: string) => Promise<void>;
  cancelAsk: () => void;
}

// Shared wrapper around api.askAIStream that owns the panel-agnostic lifecycle
// (abort, snapshot, diff, stream updates, post-abort commit). Both the editor
// AssistantPanel and the guided GuidedTutorPanel use this — previously each
// carried its own near-identical ~100-line copy of this logic.
export function useTutorAsk(opts: UseTutorAskOpts): UseTutorAskResult {
  const {
    apiKey,
    keyStatus,
    selectedModel,
    history,
    asking,
    pushUser,
    pushAssistant,
    setAsking,
    setAskError,
    startStream,
    updateStream,
    clearStream,
    commitTurnSnapshot,
    lastTurnFiles,
    activeSelection,
    setActiveSelection,
  } = useAIStore();
  const { snapshot } = useProjectStore();
  const abortRef = useRef<AbortController | null>(null);

  const configured = keyStatus === "valid" && !!selectedModel;

  const submitAsk = async (question: string): Promise<void> => {
    const trimmed = question.trim();
    if (!trimmed || !configured || asking) return;

    const selectionForTurn = activeSelection;
    setActiveSelection(null);
    pushUser(trimmed);
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
      // Snapshot BEFORE the request goes out so that edits/runs during the
      // model's thinking time are attributed to the NEXT turn.
      commitTurnSnapshot(files);

      const adjusted = opts.beforeSend?.({ history });
      const historyForSend =
        adjusted ?? history.map((m) => ({ role: m.role, content: m.content }));

      const body = opts.buildBody({
        question: trimmed,
        files,
        diffSinceLastTurn,
        historyForSend,
        selection: selectionForTurn,
      });

      await api.askAIStream(apiKey, body, {
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
      });

      // Abort path: askAIStream returns without firing onDone/onError. Commit
      // partial text so the student keeps the context rather than losing it.
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

  const cancelAsk = (): void => {
    abortRef.current?.abort();
  };

  return { submitAsk, cancelAsk };
}
