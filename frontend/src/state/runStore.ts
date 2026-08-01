import { create } from "zustand";
import type { RunResult } from "../types";
import { useAIStore } from "./aiStore";
import { starterStdin } from "../util/starters";

interface RunSnapshot {
  result: RunResult | null;
  error: string | null;
  stdin: string;
}

const runCache = new Map<string, RunSnapshot>();

interface RunState {
  running: boolean;
  // Identifies the one Run operation currently allowed to publish. Context
  // switches and project edits invalidate this id, so a late response cannot
  // overwrite a newer project or a newer Run.
  activeRunId: string | null;
  // runningTests mirrors the useLessonValidator local state so both the
  // global Cmd+Enter handler and the run guard can see "Check is currently
  // executing" — without it, pressing Cmd+Enter during "Checking…" fires
  // a snapshot that wipes the workspace while the test harness is still
  // reading files from it.
  runningTests: boolean;
  result: RunResult | null;
  error: string | null;
  stdin: string;
  // Monotonic identity for execution input that lives outside projectStore.
  // Tutor requests capture it alongside the project revision so changing
  // stdin also makes an in-flight answer stale.
  inputRevision: number;
  runContext: string | null;
  setRunningTests: (v: boolean) => void;
  setStdin: (v: string) => void;
  beginRun: (operationId: string) => boolean;
  commitRunResult: (operationId: string, result: RunResult) => boolean;
  commitRunError: (operationId: string, error: string) => boolean;
  finishRun: (operationId: string) => void;
  invalidateEvidence: () => void;
  switchRunContext: (contextKey: string, defaults?: { stdin?: string }) => void;
  reset: () => void;
}

export const useRunStore = create<RunState>((set, get) => ({
  running: false,
  activeRunId: null,
  runningTests: false,
  result: null,
  error: null,
  stdin: starterStdin("python"),
  inputRevision: 0,
  runContext: null,
  setRunningTests: (runningTests) => set({ runningTests }),
  setStdin: (stdin) => {
    if (stdin === get().stdin) return;
    set({
      stdin,
      inputRevision: get().inputRevision + 1,
      running: false,
      activeRunId: null,
      result: null,
      error: null,
    });
  },
  beginRun: (operationId) => {
    if (get().running) return false;
    set({ running: true, activeRunId: operationId, error: null });
    return true;
  },
  commitRunResult: (operationId, result) => {
    if (get().activeRunId !== operationId) return false;
    set({ result, error: null });
    useAIStore.getState().noteRun();
    return true;
  },
  commitRunError: (operationId, error) => {
    if (get().activeRunId !== operationId) return false;
    set({ error, result: null });
    return true;
  },
  finishRun: (operationId) => {
    if (get().activeRunId !== operationId) return;
    set({ running: false, activeRunId: null });
  },
  invalidateEvidence: () =>
    set({
      running: false,
      activeRunId: null,
      result: null,
      error: null,
    }),
  switchRunContext: (contextKey, defaults) => {
    const state = get();
    if (state.runContext) {
      runCache.set(state.runContext, {
        result: state.result,
        error: state.error,
        stdin: state.stdin,
      });
    }

    if (state.runContext === contextKey) return;

    const saved = runCache.get(contextKey);

    set({
      runContext: contextKey,
      running: false,
      activeRunId: null,
      runningTests: false,
      result: saved?.result ?? null,
      error: saved?.error ?? null,
      stdin: saved?.stdin ?? defaults?.stdin ?? "",
      inputRevision: state.inputRevision + 1,
    });
  },
  reset: () => {
    runCache.clear();
    set((state) => ({
      running: false,
      activeRunId: null,
      runningTests: false,
      result: null,
      error: null,
      stdin: starterStdin("python"),
      inputRevision: state.inputRevision + 1,
      runContext: null,
    }));
  },
}));
