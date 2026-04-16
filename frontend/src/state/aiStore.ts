import { create } from "zustand";
import type { AIMessage, AIModel, Persona, TutorSections } from "../types";

const LS_KEY = "aicodeeditor:openai-key";
const LS_MODEL = "aicodeeditor:openai-model";
const LS_REMEMBER = "aicodeeditor:openai-remember";
const LS_PERSONA = "aicodeeditor:openai-persona";

export type KeyStatus = "none" | "validating" | "valid" | "invalid";
export type ModelsStatus = "idle" | "loading" | "loaded" | "error";

interface AIState {
  apiKey: string;
  keyStatus: KeyStatus;
  keyError: string | null;

  models: AIModel[];
  modelsStatus: ModelsStatus;
  modelsError: string | null;
  selectedModel: string | null;

  remember: boolean;

  history: AIMessage[];
  asking: boolean;
  askError: string | null;

  pending: { raw: string; sections: TutorSections } | null;

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

  setApiKey: (key: string) => void;
  setKeyStatus: (status: KeyStatus, error?: string | null) => void;

  setModels: (models: AIModel[]) => void;
  setModelsStatus: (status: ModelsStatus, error?: string | null) => void;
  setSelectedModel: (id: string | null) => void;

  setRemember: (on: boolean) => void;

  setPendingAsk: (s: string | null) => void;

  setPersona: (p: Persona) => void;

  // Replace conversationSummary + summarizedThrough atomically. Called after
  // a successful summarize round-trip.
  commitSummary: (summary: string, throughIndex: number) => void;
  setSummarizing: (on: boolean) => void;

  pushUser: (content: string) => void;
  pushAssistant: (content: string, sections?: TutorSections) => void;
  setAsking: (on: boolean) => void;
  setAskError: (e: string | null) => void;

  startStream: () => void;
  updateStream: (raw: string, sections: TutorSections) => void;
  clearStream: () => void;

  noteEdit: () => void;
  noteRun: () => void;
  // Record the snapshot we just sent. Resets the activity counters — the next
  // ask will compute its diff against this snapshot.
  commitTurnSnapshot: (files: { path: string; content: string }[]) => void;

  clearConversation: () => void;
  forgetKey: () => void;
}

function loadInitial(): {
  apiKey: string;
  remember: boolean;
  selectedModel: string | null;
  persona: Persona;
} {
  const personaDefault: Persona = "beginner";
  try {
    const remember = localStorage.getItem(LS_REMEMBER) === "1";
    const apiKey = remember ? (localStorage.getItem(LS_KEY) ?? "") : "";
    const selectedModel = localStorage.getItem(LS_MODEL);
    const storedPersona = localStorage.getItem(LS_PERSONA);
    const persona: Persona =
      storedPersona === "beginner" ||
      storedPersona === "intermediate" ||
      storedPersona === "advanced"
        ? storedPersona
        : personaDefault;
    return { apiKey, remember, selectedModel, persona };
  } catch {
    return { apiKey: "", remember: false, selectedModel: null, persona: personaDefault };
  }
}

const initial = loadInitial();

export const useAIStore = create<AIState>((set, get) => ({
  apiKey: initial.apiKey,
  keyStatus: "none",
  keyError: null,

  models: [],
  modelsStatus: "idle",
  modelsError: null,
  selectedModel: initial.selectedModel,

  remember: initial.remember,

  history: [],
  asking: false,
  askError: null,

  pending: null,

  lastTurnFiles: null,
  runsSinceLastTurn: 0,
  editsSinceLastTurn: 0,

  pendingAsk: null,

  persona: initial.persona,
  conversationSummary: null,
  summarizedThrough: 0,
  summarizing: false,

  setApiKey: (key) => {
    set({ apiKey: key, keyStatus: "none", keyError: null, models: [], modelsStatus: "idle" });
    if (get().remember) {
      try {
        if (key) localStorage.setItem(LS_KEY, key);
        else localStorage.removeItem(LS_KEY);
      } catch { /* ignore quota / disabled storage */ }
    }
  },

  setKeyStatus: (status, error = null) => set({ keyStatus: status, keyError: error }),

  setModels: (models) => {
    const current = get().selectedModel;
    // If the previously selected model is still in the list, keep it. Otherwise
    // pick the first one so the UI is ready to use immediately.
    const selectedModel = current && models.some((m) => m.id === current) ? current : (models[0]?.id ?? null);
    set({ models, selectedModel });
    if (selectedModel) {
      try { localStorage.setItem(LS_MODEL, selectedModel); } catch {}
    }
  },

  setModelsStatus: (status, error = null) => set({ modelsStatus: status, modelsError: error }),

  setSelectedModel: (id) => {
    set({ selectedModel: id });
    try {
      if (id) localStorage.setItem(LS_MODEL, id);
      else localStorage.removeItem(LS_MODEL);
    } catch {}
  },

  setPendingAsk: (s) => set({ pendingAsk: s }),

  setPersona: (p) => {
    set({ persona: p });
    try { localStorage.setItem(LS_PERSONA, p); } catch {}
  },

  commitSummary: (summary, throughIndex) =>
    set({ conversationSummary: summary, summarizedThrough: throughIndex }),
  setSummarizing: (on) => set({ summarizing: on }),

  setRemember: (on) => {
    set({ remember: on });
    try {
      if (on) {
        localStorage.setItem(LS_REMEMBER, "1");
        const k = get().apiKey;
        if (k) localStorage.setItem(LS_KEY, k);
      } else {
        localStorage.removeItem(LS_REMEMBER);
        localStorage.removeItem(LS_KEY);
      }
    } catch {}
  },

  pushUser: (content) => set((s) => ({ history: [...s.history, { role: "user", content }] })),
  pushAssistant: (content, sections) =>
    set((s) => ({ history: [...s.history, { role: "assistant", content, sections }] })),

  setAsking: (on) => set({ asking: on }),
  setAskError: (e) => set({ askError: e }),

  startStream: () => set({ pending: { raw: "", sections: {} } }),
  updateStream: (raw, sections) => set({ pending: { raw, sections } }),
  clearStream: () => set({ pending: null }),

  noteEdit: () => set((s) => ({ editsSinceLastTurn: s.editsSinceLastTurn + 1 })),
  noteRun: () => set((s) => ({ runsSinceLastTurn: s.runsSinceLastTurn + 1 })),
  commitTurnSnapshot: (files) =>
    set({
      lastTurnFiles: Object.fromEntries(files.map((f) => [f.path, f.content])),
      runsSinceLastTurn: 0,
      editsSinceLastTurn: 0,
    }),

  clearConversation: () =>
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
    }),

  forgetKey: () => {
    set({
      apiKey: "",
      keyStatus: "none",
      keyError: null,
      models: [],
      modelsStatus: "idle",
      modelsError: null,
      selectedModel: null,
      history: [],
    });
    try {
      localStorage.removeItem(LS_KEY);
      localStorage.removeItem(LS_MODEL);
    } catch {}
  },
}));
