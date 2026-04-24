import { create } from "zustand";
import type {
  AIMessage,
  AIModel,
  EditorSelection,
  Persona,
  TokenUsage,
  TutorSections,
} from "../types";
import {
  usePreferencesStore,
  setPersona as setPersonaInPrefs,
  setOpenAIModel as setOpenAIModelInPrefs,
} from "./preferencesStore";

// Phase 18b: `persona` and `selectedModel` are mirrored here from
// preferencesStore (which is the authoritative server-backed source). We
// keep a local copy so every existing aiStore selector (~40 call sites) stays
// synchronous — the subscribe hook below re-mirrors after hydrate() finishes
// or after the user flips a preference. Writes go through the prefs store's
// `patch()` which handles the optimistic update + PATCH round-trip.
//
// Phase 18e: the OpenAI key itself is no longer in this store — it lives
// encrypted on the server (user_preferences.openai_api_key_cipher). The UI
// only ever sees `preferencesStore.hasOpenaiKey: boolean`; settings
// save/delete go through preferencesStore.saveOpenaiKey / forgetOpenaiKey.

export type ModelsStatus = "idle" | "loading" | "loaded" | "error";

interface AIState {
  models: AIModel[];
  modelsStatus: ModelsStatus;
  modelsError: string | null;
  selectedModel: string | null;

  history: AIMessage[];
  asking: boolean;
  askError: string | null;

  pending: { raw: string; sections: TutorSections } | null;
  // Separate flag for the pending stream so the renderer can tell
  // "this is a scripted first-run turn" vs "this is a real LLM
  // reply." Set true by the first-run choreography via
  // startScriptedStream; falls back to false on clearStream. History
  // messages carry the same signal via AIMessage.meta.scripted —
  // pendingScripted is the live-stream equivalent.
  pendingScripted: boolean;

  // Phase-2 context tracking. `lastTurnFiles` is the snapshot we sent with the
  // most recent user ask; diff computation compares the current snapshot
  // against it. `runsSinceLastTurn` / `editsSinceLastTurn` are reset whenever
  // we commit a new snapshot (i.e. each outgoing ask).
  lastTurnFiles: Record<string, string> | null;
  runsSinceLastTurn: number;
  editsSinceLastTurn: number;

  // One-shot signal to fire an ask from outside the assistant panel (action
  // chips, clickable check questions, "walk me through this" header button).
  // AssistantPanel watches this: when non-null it submits the question
  // directly (no composer prefill step) and clears the signal via
  // setPendingAsk(null).
  pendingAsk: string | null;

  // Phase 4 — student experience level (biases the system prompt). Persisted
  // per-device because it's a preference, not session state.
  persona: Persona;

  // Phase 4 — summarize-and-continue. Once history crosses the soft cap we
  // replace its old head with a compressed summary and remember how far we've
  // compressed so we don't re-summarize on every turn.
  conversationSummary: string | null;
  summarizedThrough: number;
  summarizing: boolean;

  // Phase 5 — selection-aware asks. `activeSelection` is populated by Monaco's
  // Cmd+K handler and consumed + cleared by the next ask. `focusComposerNonce`
  // is a monotonic tick the composer watches so it can pull focus after a
  // selection is captured outside the panel.
  activeSelection: EditorSelection | null;
  focusComposerNonce: number;

  // Phase 5 — rolling token usage for the current conversation. Per-turn usage
  // also lives on each AIMessage; this is the aggregate for the header chip.
  sessionUsage: TokenUsage;

  setModels: (models: AIModel[]) => void;
  setModelsStatus: (status: ModelsStatus, error?: string | null) => void;
  setSelectedModel: (id: string | null) => void;

  setPendingAsk: (s: string | null) => void;

  setPersona: (p: Persona) => void;

  // Replace conversationSummary + summarizedThrough atomically. Called after
  // a successful summarize round-trip.
  commitSummary: (summary: string, throughIndex: number) => void;
  setSummarizing: (on: boolean) => void;

  setActiveSelection: (sel: EditorSelection | null) => void;
  bumpFocusComposer: () => void;

  pushUser: (content: string) => void;
  pushAssistant: (
    content: string,
    sections?: TutorSections,
    usage?: TokenUsage,
    meta?: AIMessage["meta"],
  ) => void;
  setAsking: (on: boolean) => void;
  setAskError: (e: string | null) => void;

  startStream: () => void;
  // Kicks off a pending stream AND flags it as scripted so the renderer
  // swaps to the cinematic-voice presentation. Called by the first-run
  // choreography's scripted-turn helper.
  startScriptedStream: () => void;
  updateStream: (raw: string, sections: TutorSections) => void;
  clearStream: () => void;

  noteEdit: () => void;
  noteRun: () => void;
  // Record the snapshot we just sent. Resets the activity counters — the next
  // ask will compute its diff against this snapshot.
  commitTurnSnapshot: (files: { path: string; content: string }[]) => void;

  clearConversation: () => void;

  chatContext: string | null;
  switchChatContext: (contextKey: string) => void;

  // Full wipe on sign-out: drop every cached chat thread and all in-memory
  // chat state. The chatCache Map is module-scoped, so without this the next
  // user on the same tab inherits the previous user's history.
  reset: () => void;
}

interface ChatSnapshot {
  history: AIMessage[];
  conversationSummary: string | null;
  summarizedThrough: number;
  sessionUsage: TokenUsage;
}

// P-M4: bound the chat-cache to the 10 most-recently-touched conversations.
// Without this, navigating across many lessons accumulates a full history
// per visited lesson for the life of the tab — each turn's AIMessage carries
// raw string content + sections, so memory grows unbounded. 10 matches the
// upper bound of "lessons the user is juggling in one session" observed in
// the audit; anything older is re-hydrateable from the server on revisit.
const CHAT_CACHE_MAX = 10;
const chatCache = new Map<string, ChatSnapshot>();

function touchChat(key: string, snap: ChatSnapshot): void {
  // Map preserves insertion order; delete-then-set promotes the entry to
  // the end so eviction always targets the least-recently-written key.
  if (chatCache.has(key)) chatCache.delete(key);
  chatCache.set(key, snap);
  while (chatCache.size > CHAT_CACHE_MAX) {
    const oldest = chatCache.keys().next().value;
    if (oldest === undefined) break;
    chatCache.delete(oldest);
  }
}

function saveChatToCache(get: () => AIState): void {
  const { chatContext, history, conversationSummary, summarizedThrough, sessionUsage } = get();
  if (!chatContext) return;
  touchChat(chatContext, { history, conversationSummary, summarizedThrough, sessionUsage });
}

export const useAIStore = create<AIState>((set, get) => ({
  models: [],
  modelsStatus: "idle",
  modelsError: null,
  selectedModel: usePreferencesStore.getState().openaiModel,

  history: [],
  asking: false,
  askError: null,

  pending: null,
  pendingScripted: false,

  lastTurnFiles: null,
  runsSinceLastTurn: 0,
  editsSinceLastTurn: 0,

  pendingAsk: null,

  persona: usePreferencesStore.getState().persona,
  conversationSummary: null,
  summarizedThrough: 0,
  summarizing: false,

  activeSelection: null,
  focusComposerNonce: 0,
  sessionUsage: { inputTokens: 0, outputTokens: 0 },

  chatContext: null,

  setModels: (models) => {
    const current = get().selectedModel;
    // If the previously selected model is still in the list, keep it. Otherwise
    // pick the first one so the UI is ready to use immediately.
    const selectedModel = current && models.some((m) => m.id === current) ? current : (models[0]?.id ?? null);
    set({ models, selectedModel });
    if (selectedModel !== usePreferencesStore.getState().openaiModel) {
      void setOpenAIModelInPrefs(selectedModel).catch(() => { /* logged in prefs */ });
    }
  },

  setModelsStatus: (status, error = null) => set({ modelsStatus: status, modelsError: error }),

  setSelectedModel: (id) => {
    set({ selectedModel: id });
    void setOpenAIModelInPrefs(id).catch(() => { /* logged in prefs */ });
  },

  setPendingAsk: (s) => set({ pendingAsk: s }),

  setPersona: (p) => {
    set({ persona: p });
    void setPersonaInPrefs(p).catch(() => { /* logged in prefs */ });
  },

  commitSummary: (summary, throughIndex) =>
    set({ conversationSummary: summary, summarizedThrough: throughIndex }),
  setSummarizing: (on) => set({ summarizing: on }),

  setActiveSelection: (sel) => set({ activeSelection: sel }),
  bumpFocusComposer: () => set((s) => ({ focusComposerNonce: s.focusComposerNonce + 1 })),

  pushUser: (content) => {
    set((s) => ({ history: [...s.history, { role: "user", content }] }));
    saveChatToCache(get);
  },
  pushAssistant: (content, sections, usage, meta) => {
    set((s) => ({
      history: [
        ...s.history,
        { role: "assistant", content, sections, usage, meta },
      ],
      sessionUsage: usage
        ? {
            inputTokens: s.sessionUsage.inputTokens + usage.inputTokens,
            outputTokens: s.sessionUsage.outputTokens + usage.outputTokens,
          }
        : s.sessionUsage,
    }));
    saveChatToCache(get);
  },

  setAsking: (on) => set({ asking: on }),
  setAskError: (e) => set({ askError: e }),

  startStream: () =>
    set({ pending: { raw: "", sections: {} }, pendingScripted: false }),
  startScriptedStream: () =>
    set({ pending: { raw: "", sections: {} }, pendingScripted: true }),
  updateStream: (raw, sections) => set({ pending: { raw, sections } }),
  clearStream: () => set({ pending: null, pendingScripted: false }),

  noteEdit: () => set((s) => ({ editsSinceLastTurn: s.editsSinceLastTurn + 1 })),
  noteRun: () => set((s) => ({ runsSinceLastTurn: s.runsSinceLastTurn + 1 })),
  commitTurnSnapshot: (files) =>
    set({
      lastTurnFiles: Object.fromEntries(files.map((f) => [f.path, f.content])),
      runsSinceLastTurn: 0,
      editsSinceLastTurn: 0,
    }),

  clearConversation: () => {
    const ctx = get().chatContext;
    set({
      history: [],
      askError: null,
      pending: null,
      lastTurnFiles: null,
      runsSinceLastTurn: 0,
      editsSinceLastTurn: 0,
      conversationSummary: null,
      summarizedThrough: 0,
      summarizing: false,
      activeSelection: null,
      sessionUsage: { inputTokens: 0, outputTokens: 0 },
    });
    if (ctx) chatCache.delete(ctx);
  },

  reset: () => {
    chatCache.clear();
    set({
      models: [],
      modelsStatus: "idle",
      modelsError: null,
      selectedModel: null,
      history: [],
      asking: false,
      askError: null,
      pending: null,
      lastTurnFiles: null,
      runsSinceLastTurn: 0,
      editsSinceLastTurn: 0,
      pendingAsk: null,
      conversationSummary: null,
      summarizedThrough: 0,
      summarizing: false,
      activeSelection: null,
      focusComposerNonce: 0,
      sessionUsage: { inputTokens: 0, outputTokens: 0 },
      chatContext: null,
    });
  },

  switchChatContext: (contextKey) => {
    const state = get();
    if (state.chatContext) {
      touchChat(state.chatContext, {
        history: state.history,
        conversationSummary: state.conversationSummary,
        summarizedThrough: state.summarizedThrough,
        sessionUsage: state.sessionUsage,
      });
    }

    if (state.chatContext === contextKey) return;

    // Read also promotes — the target we're about to switch to is obviously
    // the most-recently-used entry and should not be next to be evicted.
    const saved = chatCache.get(contextKey);
    if (saved) {
      chatCache.delete(contextKey);
      chatCache.set(contextKey, saved);
    }

    set({
      chatContext: contextKey,
      history: saved?.history ?? [],
      conversationSummary: saved?.conversationSummary ?? null,
      summarizedThrough: saved?.summarizedThrough ?? 0,
      summarizing: false,
      askError: null,
      pending: null,
      lastTurnFiles: null,
      runsSinceLastTurn: 0,
      editsSinceLastTurn: 0,
      activeSelection: null,
      sessionUsage: saved?.sessionUsage ?? { inputTokens: 0, outputTokens: 0 },
    });
  },
}));

// Mirror preferencesStore.{persona, openaiModel} into aiStore so existing
// selectors stay synchronous. Fires once on module load (to pick up the
// initial hydrated value when the auth bootstrap resolves) and again on
// every subsequent change.
usePreferencesStore.subscribe((state, prev) => {
  const patch: Partial<{ persona: Persona; selectedModel: string | null }> = {};
  if (state.persona !== prev.persona) patch.persona = state.persona;
  if (state.openaiModel !== prev.openaiModel) patch.selectedModel = state.openaiModel;
  if (Object.keys(patch).length > 0) useAIStore.setState(patch);
});
