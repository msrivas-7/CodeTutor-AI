import { create } from "zustand";
import type { Language, ProjectFile } from "../types";
import { useAIStore } from "./aiStore";
import { api } from "../api/client";
import { currentGen } from "../auth/generation";
import { STARTERS } from "../util/starters";

export { starterStdin } from "../util/starters";

interface ProjectSnapshot {
  language: Language;
  files: Record<string, string>;
  order: string[];
  activeFile: string | null;
  openTabs: string[];
}

const projectCache = new Map<string, ProjectSnapshot>();

// Signal MonacoPane uses to move the cursor after a jump (e.g. clicking a
// file:line reference in the output or tutor). The ticket makes repeated
// reveals to the same location still fire the useEffect.
export interface RevealTarget {
  path: string;
  line: number;
  column?: number;
  ticket: number;
}

interface ProjectState {
  language: Language;
  files: Record<string, string>;
  activeFile: string | null;
  order: string[];
  // Files currently open as editor tabs, in tab-strip order. The active tab
  // is always the one matching `activeFile`. Separated from `order` (the
  // file-tree order) so the user can reorder tabs independently.
  openTabs: string[];
  pendingReveal: RevealTarget | null;
  projectContext: string | null;
  // Phase 18b: tracks whether the editor-mode project has been pulled from
  // the server for the current user. The auth flow calls `hydrateEditor()`
  // on SIGNED_IN / initial session recovery so MonacoPane mounts with the
  // persisted content already in `files` rather than flashing the starter.
  editorHydrated: boolean;
  editorHydrateError: string | null;
  hydrateEditor: (gen?: number) => Promise<void>;
  resetEditorHydration: () => void;
  setLanguage: (lang: Language) => void;
  setActive: (path: string) => void;
  openFile: (path: string) => void;
  closeTab: (path: string) => void;
  revealAt: (path: string, line: number, column?: number) => void;
  setContent: (path: string, content: string) => void;
  createFile: (path: string, content?: string) => { ok: boolean; error?: string };
  deleteFile: (path: string) => void;
  renameFile: (from: string, to: string) => { ok: boolean; error?: string };
  snapshot: () => ProjectFile[];
  resetToStarter: (lang: Language) => void;
  switchProjectContext: (
    contextKey: string,
    defaults?: {
      language?: Language;
      files: Record<string, string>;
      order: string[];
      activeFile: string | null;
      openTabs: string[];
    },
  ) => void;
}

function seedFor(lang: Language) {
  const seed = STARTERS[lang].files;
  const first = seed[0]?.path ?? null;
  return {
    files: Object.fromEntries(seed.map((f) => [f.path, f.content])),
    order: seed.map((f) => f.path),
    activeFile: first,
    openTabs: first ? [first] : [],
  };
}

let revealTicket = 0;

// Side channel for editor-mode stdin pulled during hydrateEditor(). runStore
// reads this (via `consumePendingEditorStdin()`) when Editor mode first
// activates. Using a module-level slot keeps projectStore from importing
// runStore (which imports starterStdin from here — cycle).
let pendingEditorStdin: string | null = null;
export function consumePendingEditorStdin(): string | null {
  const v = pendingEditorStdin;
  pendingEditorStdin = null;
  return v;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  language: "python",
  ...seedFor("python"),
  pendingReveal: null,
  projectContext: null,
  editorHydrated: false,
  editorHydrateError: null,
  hydrateEditor: async (gen) => {
    set({ editorHydrateError: null });
    try {
      const remote = await api.getEditorProject();
      if (gen !== undefined && gen !== currentGen()) return;
      const hasFiles = Object.keys(remote.files ?? {}).length > 0;
      if (hasFiles) {
        // Server has a persisted project — overwrite the in-memory starter
        // so MonacoPane's first render sees the user's code. We also push
        // the snapshot into `projectCache` under the "editor" key so a
        // later `switchProjectContext("editor")` from a lesson page picks
        // it up instead of falling back to defaults.
        const snapshot: ProjectSnapshot = {
          language: remote.language as Language,
          files: remote.files,
          order: remote.fileOrder,
          activeFile: remote.activeFile,
          openTabs: remote.openTabs,
        };
        projectCache.set("editor", snapshot);
        // Only apply to the live store if we're not already inside a lesson
        // (projectContext !== "editor" and !== null means lesson); on the
        // StartPage the context is null so it's safe to pre-seed.
        const state = get();
        if (state.projectContext === null || state.projectContext === "editor") {
          set({
            language: snapshot.language,
            files: snapshot.files,
            order: snapshot.order,
            activeFile: snapshot.activeFile,
            openTabs: snapshot.openTabs,
            pendingReveal: null,
          });
        }
        // Stash stdin on the store under a side channel — runStore reads it
        // when it picks up the editor context. We don't call useRunStore
        // directly here to avoid a projectStore → runStore circular import;
        // useRunStore already imports from this module.
        pendingEditorStdin = remote.stdin;
      }
      set({ editorHydrated: true });
    } catch (err) {
      if (gen !== undefined && gen !== currentGen()) return;
      const msg = (err as Error).message;
      console.error("[editorProject] hydrate failed:", msg);
      // Leave `editorHydrated: false` — see HydrationGate rationale.
      set({ editorHydrateError: msg });
    }
  },
  resetEditorHydration: () => {
    projectCache.delete("editor");
    pendingEditorStdin = null;
    set({ editorHydrated: false, editorHydrateError: null });
  },
  setLanguage: (lang) => set({ language: lang }),
  setActive: (path) => set({ activeFile: path }),
  openFile: (path) =>
    set((s) => ({
      activeFile: path,
      openTabs: s.openTabs.includes(path) ? s.openTabs : [...s.openTabs, path],
    })),
  revealAt: (path, line, column) =>
    set((s) => {
      if (!s.files[path]) return s;
      return {
        activeFile: path,
        openTabs: s.openTabs.includes(path) ? s.openTabs : [...s.openTabs, path],
        pendingReveal: { path, line, column, ticket: ++revealTicket },
      };
    }),
  closeTab: (path) =>
    set((s) => {
      const idx = s.openTabs.indexOf(path);
      if (idx === -1) return s;
      const openTabs = s.openTabs.filter((p) => p !== path);
      // If we closed the active tab, promote the neighbor (prefer the one to
      // the left so closing rightmost tabs doesn't jump the focus around).
      const activeFile =
        s.activeFile === path
          ? openTabs[idx - 1] ?? openTabs[0] ?? null
          : s.activeFile;
      return { openTabs, activeFile };
    }),
  setContent: (path, content) => {
    const prev = get().files[path];
    set((s) => ({ files: { ...s.files, [path]: content } }));
    // Only count it as an edit if the content actually changed — Monaco fires
    // onChange on focus/blur round-trips in some cases, and we don't want to
    // inflate the counter the tutor reads.
    if (prev !== content) useAIStore.getState().noteEdit();
  },
  createFile: (path, content = "") => {
    const s = get();
    if (s.files[path]) return { ok: false, error: "file exists" };
    if (!/^[A-Za-z0-9_./-]+$/.test(path) || path.includes("..")) {
      return { ok: false, error: "invalid path" };
    }
    set({
      files: { ...s.files, [path]: content },
      order: [...s.order, path],
      activeFile: path,
      openTabs: [...s.openTabs, path],
    });
    return { ok: true };
  },
  deleteFile: (path) =>
    set((s) => {
      if (!s.files[path]) return s;
      const files = { ...s.files };
      delete files[path];
      const order = s.order.filter((p) => p !== path);
      const tabIdx = s.openTabs.indexOf(path);
      const openTabs = s.openTabs.filter((p) => p !== path);
      const activeFile =
        s.activeFile === path
          ? tabIdx >= 0
            ? openTabs[tabIdx - 1] ?? openTabs[0] ?? order[0] ?? null
            : order[0] ?? null
          : s.activeFile;
      return { files, order, activeFile, openTabs };
    }),
  renameFile: (from, to) => {
    const s = get();
    if (!s.files[from]) return { ok: false, error: "source not found" };
    if (s.files[to]) return { ok: false, error: "destination exists" };
    if (!/^[A-Za-z0-9_./-]+$/.test(to) || to.includes("..")) {
      return { ok: false, error: "invalid path" };
    }
    const files = { ...s.files, [to]: s.files[from] };
    delete files[from];
    const order = s.order.map((p) => (p === from ? to : p));
    const openTabs = s.openTabs.map((p) => (p === from ? to : p));
    const activeFile = s.activeFile === from ? to : s.activeFile;
    set({ files, order, activeFile, openTabs });
    return { ok: true };
  },
  snapshot: () => {
    const s = get();
    return s.order.map((p) => ({ path: p, content: s.files[p] ?? "" }));
  },
  resetToStarter: (lang) =>
    set({ language: lang, ...seedFor(lang) }),

  switchProjectContext: (contextKey, defaults) => {
    const state = get();
    if (state.projectContext) {
      projectCache.set(state.projectContext, {
        language: state.language,
        files: state.files,
        order: state.order,
        activeFile: state.activeFile,
        openTabs: state.openTabs,
      });
    }

    if (state.projectContext === contextKey) return;

    const saved = projectCache.get(contextKey);

    if (saved) {
      set({
        projectContext: contextKey,
        language: saved.language,
        files: saved.files,
        order: saved.order,
        activeFile: saved.activeFile,
        openTabs: saved.openTabs,
        pendingReveal: null,
      });
    } else if (defaults) {
      set({
        projectContext: contextKey,
        language: defaults.language ?? "python",
        files: defaults.files,
        order: defaults.order,
        activeFile: defaults.activeFile,
        openTabs: defaults.openTabs,
        pendingReveal: null,
      });
    } else {
      const seed = seedFor("python");
      set({
        projectContext: contextKey,
        language: "python",
        ...seed,
        pendingReveal: null,
      });
    }
  },
}));
