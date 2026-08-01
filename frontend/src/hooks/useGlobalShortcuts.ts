import { useEffect } from "react";
import { api } from "../api/client";
import {
  beginProjectOperation,
  isProjectOperationCurrent,
  useProjectStore,
} from "../state/projectStore";
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
        const operation = beginProjectOperation();
        if (!runState.beginRun(operation.id)) return;
        try {
          const files = project.snapshot();
          await api.snapshotProject(state.sessionId, files);
          if (!isProjectOperationCurrent(operation)) return;
          const result = await api.execute(
            state.sessionId,
            project.language,
            runState.stdin || undefined
          );
          if (!isProjectOperationCurrent(operation)) return;
          useRunStore.getState().commitRunResult(operation.id, result);
        } catch (err) {
          if (isProjectOperationCurrent(operation)) {
            useRunStore.getState().commitRunError(operation.id, (err as Error).message);
          }
        } finally {
          useRunStore.getState().finishRun(operation.id);
        }
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, []);
}
