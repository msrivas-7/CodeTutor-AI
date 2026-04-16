import { create } from "zustand";
import type { AIMessage, AIModel, TutorSections } from "../types";

const LS_KEY = "aicodeeditor:openai-key";
const LS_MODEL = "aicodeeditor:openai-model";
const LS_REMEMBER = "aicodeeditor:openai-remember";

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

  setApiKey: (key: string) => void;
  setKeyStatus: (status: KeyStatus, error?: string | null) => void;

  setModels: (models: AIModel[]) => void;
  setModelsStatus: (status: ModelsStatus, error?: string | null) => void;
  setSelectedModel: (id: string | null) => void;

  setRemember: (on: boolean) => void;

  pushUser: (content: string) => void;
  pushAssistant: (content: string, sections?: TutorSections) => void;
  setAsking: (on: boolean) => void;
  setAskError: (e: string | null) => void;

  startStream: () => void;
  updateStream: (raw: string, sections: TutorSections) => void;
  clearStream: () => void;

  clearConversation: () => void;
  forgetKey: () => void;
}

function loadInitial(): { apiKey: string; remember: boolean; selectedModel: string | null } {
  try {
    const remember = localStorage.getItem(LS_REMEMBER) === "1";
    const apiKey = remember ? (localStorage.getItem(LS_KEY) ?? "") : "";
    const selectedModel = localStorage.getItem(LS_MODEL);
    return { apiKey, remember, selectedModel };
  } catch {
    return { apiKey: "", remember: false, selectedModel: null };
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

  clearConversation: () => set({ history: [], askError: null, pending: null }),

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
