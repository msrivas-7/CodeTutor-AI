import { useEffect, useRef } from "react";
import { api, type EditorProjectPayload } from "../api/client";
import { useProjectStore } from "../state/projectStore";
import { useRunStore } from "../state/runStore";
import { useAuthStore } from "../auth/authStore";
import { ApiError } from "../api/ApiError";
import { tabWriterId } from "../util/tabWriterId";

// Phase 18b: persist the free-form editor project (files, active file, tab
// order, stdin, language) to the user_data.editor_project table so it
// follows the user across devices. Lesson-mode code is already persisted
// per-lesson via progressStore.saveCode; this hook handles Editor mode only.
//
// Initial hydration happens in `useProjectStore.hydrateEditor()` (kicked off
// by the auth flow and awaited by HydrationGate), so by the time this hook
// runs the store already reflects the server row. This hook only subscribes
// to in-app changes and debounce-saves them back.

const DEBOUNCE_MS = 800;

// Applying the authoritative remote snapshot is hydration, not a local edit.
// Without this one-transition guard, replaceProject schedules an identical PUT
// that advances the server revision and immediately creates a new conflict in
// the tab that originally wrote that version.
let suppressNextRemoteApplySave = false;

export function useEditorProjectPersistence(): void {
  const user = useAuthStore((s) => s.user);
  const authLoading = useAuthStore((s) => s.loading);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveChain = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    if (authLoading || !user) return;

    function schedule() {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        saveChain.current = saveChain.current
          .catch(() => undefined)
          .then(async () => {
            const p = useProjectStore.getState();
            if (!p.editorHydrated || p.projectContext !== "editor") return;
            if (p.editorSaveConflict) return;
            const payload: EditorProjectPayload = {
              language: p.language,
              files: p.files,
              activeFile: p.activeFile,
              openTabs: p.openTabs,
              fileOrder: p.order,
              stdin: useRunStore.getState().stdin,
              expectedRevision: p.editorServerRevision,
              writerId: tabWriterId,
            };
            try {
              const saved = await api.saveEditorProject(payload);
              useProjectStore.setState({
                editorServerRevision: saved.revision,
                editorServerWriterId: saved.writerId,
                editorSaveError: null,
              });
            } catch (err) {
              if (err instanceof ApiError && err.status === 409) {
                try {
                  const body = JSON.parse(err.body) as {
                    current?: Awaited<ReturnType<typeof api.getEditorProject>>;
                  };
                  if (body.current) {
                    useProjectStore.setState({
                      editorServerRevision: body.current.revision,
                      editorServerWriterId: body.current.writerId,
                      editorSaveError: null,
                      editorSaveConflict: { local: payload, remote: body.current },
                    });
                    return;
                  }
                } catch {
                  // Continue to the ordinary save-error log.
                }
              }
              console.error("[editorProject] save failed:", (err as Error).message);
              useProjectStore.setState({
                editorSaveError: "Your project is still open here, but it has not synced yet.",
              });
            }
          });
      }, DEBOUNCE_MS);
    }

    const unsubP = useProjectStore.subscribe((s, prev) => {
      if (s.projectContext !== "editor") return;
      if (
        s.files === prev.files &&
        s.language === prev.language &&
        s.activeFile === prev.activeFile &&
        s.openTabs === prev.openTabs &&
        s.order === prev.order
      ) {
        if (prev.editorSaveError && !s.editorSaveError) schedule();
        return;
      }
      if (suppressNextRemoteApplySave) {
        suppressNextRemoteApplySave = false;
        return;
      }
      schedule();
    });
    const unsubR = useRunStore.subscribe((s, prev) => {
      if (s.stdin === prev.stdin) return;
      if (useProjectStore.getState().projectContext !== "editor") return;
      schedule();
    });
    const retryWhenOnline = () => {
      if (useProjectStore.getState().editorSaveError) schedule();
    };
    window.addEventListener("online", retryWhenOnline);

    return () => {
      unsubP();
      unsubR();
      window.removeEventListener("online", retryWhenOnline);
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [authLoading, user]);
}

export function retryEditorProjectSave(): void {
  const state = useProjectStore.getState();
  if (!state.editorSaveError || state.editorSaveConflict) return;
  useProjectStore.setState({ editorSaveError: null });
}

export async function resolveEditorProjectConflict(
  choice: "remote" | "local",
): Promise<boolean> {
  const state = useProjectStore.getState();
  const conflict = state.editorSaveConflict;
  if (!conflict) return false;
  if (choice === "remote") {
    const remote = conflict.remote;
    suppressNextRemoteApplySave = true;
    useProjectStore.getState().replaceProject({
      language: remote.language as typeof state.language,
      files: remote.files,
      order: remote.fileOrder,
      activeFile: remote.activeFile,
      openTabs: remote.openTabs,
    });
    // Zustand subscriptions run synchronously. Clear defensively as well so a
    // conflict resolved during teardown cannot suppress a later real edit.
    suppressNextRemoteApplySave = false;
    useRunStore.setState({ stdin: remote.stdin, result: null, error: null });
    useProjectStore.setState({
      editorServerRevision: remote.revision,
      editorServerWriterId: remote.writerId,
      editorSaveError: null,
      editorSaveConflict: null,
    });
    return true;
  }
  try {
    const saved = await api.saveEditorProject({
      ...conflict.local,
      expectedRevision: conflict.remote.revision,
      writerId: tabWriterId,
    });
    useProjectStore.setState({
      editorServerRevision: saved.revision,
      editorServerWriterId: saved.writerId,
      editorSaveError: null,
      editorSaveConflict: null,
    });
    return true;
  } catch (error) {
    console.error("[editorProject] conflict resolution failed:", (error as Error).message);
    useProjectStore.setState({
      editorSaveError: "That version could not be saved yet. Both copies are still available.",
    });
    return false;
  }
}
