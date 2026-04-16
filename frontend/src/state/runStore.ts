import { create } from "zustand";
import type { RunResult } from "../types";
import { starterStdin } from "./projectStore";

interface RunState {
  running: boolean;
  result: RunResult | null;
  error: string | null;
  stdin: string;
  setRunning: (v: boolean) => void;
  setResult: (r: RunResult | null) => void;
  setError: (e: string | null) => void;
  setStdin: (v: string) => void;
  clear: () => void;
}

export const useRunStore = create<RunState>((set) => ({
  running: false,
  result: null,
  error: null,
  stdin: starterStdin("python"),
  setRunning: (running) => set({ running }),
  setResult: (result) => set({ result, error: null }),
  setError: (error) => set({ error, result: null }),
  setStdin: (stdin) => set({ stdin }),
  clear: () => set({ result: null, error: null }),
}));
