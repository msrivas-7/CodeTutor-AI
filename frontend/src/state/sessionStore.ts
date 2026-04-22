import { create } from "zustand";

export type SessionPhase =
  | "idle"
  | "starting"
  | "active"
  | "reconnecting"
  | "error"
  | "ended";

interface SessionState {
  sessionId: string | null;
  phase: SessionPhase;
  error: string | null;
  // Phase 20-P0 #6: set to true when a rebind returned reused=false — i.e.
  // the backend got a fresh container, which means any in-memory state
  // inside the runner (built artifacts, stdin buffer, uploaded files outside
  // the frontend's projectStore) is gone. The frontend's projectStore
  // re-snapshots on every Run, so the happy path survives; this flag just
  // lets us surface a one-shot dismissible notice explaining the reset.
  sessionRestarted: boolean;
  // QA-H3: distinct from `sessionRestarted`. Set when a rebind returned a
  // *different* sessionId than the one we requested — the backend refused
  // the requested id (owner mismatch defence or similar) and gave us a
  // fresh one. Any in-flight session-scoped fetch against the old id is
  // now invalid, so we surface a modal (not the quieter restart banner)
  // so the learner explicitly acknowledges the switch before continuing.
  sessionReplaced: boolean;
  setSession: (id: string) => void;
  setPhase: (phase: SessionPhase) => void;
  setError: (err: string | null) => void;
  setSessionRestarted: (v: boolean) => void;
  setSessionReplaced: (v: boolean) => void;
  clear: () => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  sessionId: null,
  phase: "idle",
  error: null,
  sessionRestarted: false,
  sessionReplaced: false,
  setSession: (id) => set({ sessionId: id, phase: "active", error: null }),
  setPhase: (phase) => set({ phase }),
  // QA-C3 + QA-M7: setError no longer implies a phase transition. The old
  // contract — setError(null) downgraded phase to "active" — meant a stale
  // heartbeat response landing after a rebind could silently clobber the
  // reconnecting/error phase the user was actually in. Callers that want to
  // flip phase along with the error must call setPhase explicitly.
  setError: (err) => set({ error: err }),
  setSessionRestarted: (v) => set({ sessionRestarted: v }),
  setSessionReplaced: (v) => set({ sessionReplaced: v }),
  clear: () =>
    set({
      sessionId: null,
      phase: "ended",
      error: null,
      sessionRestarted: false,
      sessionReplaced: false,
    }),
}));
