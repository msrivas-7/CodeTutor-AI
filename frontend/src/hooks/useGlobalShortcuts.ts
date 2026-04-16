import { useEffect } from "react";
import { api } from "../api/client";
import { useProjectStore } from "../state/projectStore";
import { useSessionStore } from "../state/sessionStore";
import { useRunStore } from "../state/runStore";

// App-level shortcuts. Cmd/Ctrl+Enter runs the project from anywhere,
// including while focused in the editor. Monaco's keybinding service grabs
// most keys inside the editor, so we listen at window level with capture so
// our handler wins before Monaco interprets Enter on its own.
export function useGlobalShortcuts() {
  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;

      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        const state = useSessionStore.getState();
        const runState = useRunStore.getState();
        const project = useProjectStore.getState();
        if (!state.sessionId || state.phase !== "active" || runState.running) return;
        runState.setRunning(true);
        runState.setError(null);
        try {
          const files = project.snapshot();
          await api.snapshotProject(state.sessionId, files);
          const result = await api.execute(
            state.sessionId,
            project.language,
            runState.stdin || undefined
          );
          runState.setResult(result);
        } catch (err) {
          runState.setError((err as Error).message);
        } finally {
          runState.setRunning(false);
        }
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, []);
}
