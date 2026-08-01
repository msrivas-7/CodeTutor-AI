import { create } from "zustand";
import type { Language, ProjectFile } from "../types";
import { useAIStore } from "./aiStore";
import { useRunStore } from "./runStore";
import { api, type EditorProjectPayload, type EditorProjectResponse } from "../api/client";
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

// P-M4: LRU cap mirrors chatCache — see aiStore.ts rationale. Project
// snapshots are larger (full files map) so the ceiling matters more here.
const PROJECT_CACHE_MAX = 10;
const projectCache = new Map<string, ProjectSnapshot>();

function touchProject(key: string, snap: ProjectSnapshot): void {
  if (projectCache.has(key)) projectCache.delete(key);
  projectCache.set(key, snap);
  while (projectCache.size > PROJECT_CACHE_MAX) {
    const oldest = projectCache.keys().next().value;
    if (oldest === undefined) break;
    projectCache.delete(oldest);
  }
}

// Signal MonacoPane uses to move the cursor after a jump (e.g. clicking a
// file:line reference in the output or tutor). The ticket makes repeated
// reveals to the same location still fire the useEffect.
export interface RevealTarget {
  path: string;
  line: number;
  column?: number;
  ticket: number;
}

export interface ProjectVersion {
  contextKey: string | null;
  revision: number;
}

export interface ProjectOperationIdentity {
  id: string;
  project: ProjectVersion;
}

interface ProjectState {
  // Monotonic across every project context in this tab. It changes whenever
  // executable source or the active project identity changes.
  revision: number;
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
  editorServerRevision: number;
  editorServerWriterId: string | null;
  editorSaveError: string | null;
  editorSaveConflict: {
    local: EditorProjectPayload;
    remote: EditorProjectResponse;
  } | null;
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
  replaceProject: (next: {
    language?: Language;
    files: Record<string, string>;
    order: string[];
    activeFile: string | null;
    openTabs: string[];
  }) => void;
  switchProjectContext: (
    contextKey: string,
    defaults?: {
      language?: Language;
      files: Record<string, string>;
      order: string[];
      activeFile: string | null;
      openTabs: string[];
    },
    options?: {
      // When true, drop any cached snapshot for this context BEFORE
      // hydrating from `defaults`. Used by the first-run cinematic
      // handoff so a replay learner whose previous edits are still
      // sitting in projectCache lands on the AUTHORED starter code
      // (the scripted "change Hello, Python! to Hello, world!" beat
      // depends on the exact starter string being present).
      forceDefaults?: boolean;
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

function invalidateDerivedEvidence(): void {
  useRunStore.getState().invalidateEvidence();
  useAIStore.getState().setActiveSelection(null);
}

// Side channel for editor-mode stdin pulled during hydrateEditor(). runStore
// reads this (via `consumePendingEditorStdin()`) when Editor mode first
// activates. Keeping it as a one-shot slot separates remote hydration timing
// from run-context activation timing.
let pendingEditorStdin: string | null = null;
export function consumePendingEditorStdin(): string | null {
  const v = pendingEditorStdin;
  pendingEditorStdin = null;
  return v;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  language: "python",
  revision: 0,
  ...seedFor("python"),
  pendingReveal: null,
  projectContext: null,
  editorHydrated: false,
  editorHydrateError: null,
  editorServerRevision: 0,
  editorServerWriterId: null,
  editorSaveError: null,
  editorSaveConflict: null,
  hydrateEditor: async (gen) => {
    set({ editorHydrateError: null });
    try {
      const remote = await api.getEditorProject();
      if (gen !== undefined && gen !== currentGen()) return;
      const hasFiles = Object.keys(remote.files ?? {}).length > 0;
      set({
        editorServerRevision: remote.revision,
        editorServerWriterId: remote.writerId,
        editorSaveError: null,
        editorSaveConflict: null,
      });
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
        touchProject("editor", snapshot);
        // Only apply to the live store if we're not already inside a lesson
        // (projectContext !== "editor" and !== null means lesson); on the
        // StartPage the context is null so it's safe to pre-seed.
        const state = get();
        if (state.projectContext === null || state.projectContext === "editor") {
          set((current) => ({
            language: snapshot.language,
            files: snapshot.files,
            order: snapshot.order,
            activeFile: snapshot.activeFile,
            openTabs: snapshot.openTabs,
            pendingReveal: null,
            revision: current.revision + 1,
          }));
          invalidateDerivedEvidence();
        }
        // Stash stdin under a side channel so runStore can consume it when
        // editor context activates, without coupling hydration to run-context
        // timing.
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
    set((state) => ({
      editorHydrated: false,
      editorHydrateError: null,
      editorServerRevision: 0,
      editorServerWriterId: null,
      editorSaveError: null,
      editorSaveConflict: null,
      revision: state.revision + 1,
    }));
    invalidateDerivedEvidence();
  },
  setLanguage: (lang) => {
    if (lang === get().language) return;
    set((s) => ({ language: lang, revision: s.revision + 1 }));
    invalidateDerivedEvidence();
  },
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
    // Only count it as an edit if the content actually changed — Monaco fires
    // onChange on focus/blur round-trips in some cases, and we don't want to
    // inflate the counter the tutor reads.
    if (prev === content) return;
    set((s) => ({
      files: { ...s.files, [path]: content },
      revision: s.revision + 1,
    }));
    invalidateDerivedEvidence();
    useAIStore.getState().noteEdit();
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
      revision: s.revision + 1,
    });
    invalidateDerivedEvidence();
    useAIStore.getState().noteEdit();
    return { ok: true };
  },
  deleteFile: (path) => {
    const s = get();
    if (!s.files[path]) return;
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
    set({ files, order, activeFile, openTabs, revision: s.revision + 1 });
    invalidateDerivedEvidence();
    useAIStore.getState().noteEdit();
  },
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
    set({ files, order, activeFile, openTabs, revision: s.revision + 1 });
    invalidateDerivedEvidence();
    useAIStore.getState().noteEdit();
    return { ok: true };
  },
  snapshot: () => {
    const s = get();
    return s.order.map((p) => ({ path: p, content: s.files[p] ?? "" }));
  },
  resetToStarter: (lang) => {
    set((s) => ({
      language: lang,
      ...seedFor(lang),
      pendingReveal: null,
      revision: s.revision + 1,
    }));
    invalidateDerivedEvidence();
  },
  replaceProject: (next) => {
    set((s) => ({
      language: next.language ?? s.language,
      files: next.files,
      order: next.order,
      activeFile: next.activeFile,
      openTabs: next.openTabs,
      pendingReveal: null,
      revision: s.revision + 1,
    }));
    invalidateDerivedEvidence();
  },

  switchProjectContext: (contextKey, defaults, options) => {
    const state = get();
    if (state.projectContext) {
      touchProject(state.projectContext, {
        language: state.language,
        files: state.files,
        order: state.order,
        activeFile: state.activeFile,
        openTabs: state.openTabs,
      });
    }

    // forceDefaults short-circuits the same-context early return AND
    // wipes the cached snapshot so the `defaults` branch below is the
    // one that wins — without this, a replay first-run user whose
    // edits are cached under this contextKey would silently re-hydrate
    // into the editor instead of seeing the authored starter code.
    if (options?.forceDefaults) {
      projectCache.delete(contextKey);
    } else if (state.projectContext === contextKey) {
      return;
    }

    // Read also promotes (see aiStore.ts switchChatContext for rationale).
    const saved = projectCache.get(contextKey);
    if (saved) {
      projectCache.delete(contextKey);
      projectCache.set(contextKey, saved);
    }

    if (saved) {
      set((current) => ({
        projectContext: contextKey,
        language: saved.language,
        files: saved.files,
        order: saved.order,
        activeFile: saved.activeFile,
        openTabs: saved.openTabs,
        pendingReveal: null,
        revision: current.revision + 1,
      }));
    } else if (defaults) {
      set((current) => ({
        projectContext: contextKey,
        language: defaults.language ?? "python",
        files: defaults.files,
        order: defaults.order,
        activeFile: defaults.activeFile,
        openTabs: defaults.openTabs,
        pendingReveal: null,
        revision: current.revision + 1,
      }));
    } else {
      const seed = seedFor("python");
      set((current) => ({
        projectContext: contextKey,
        language: "python",
        ...seed,
        pendingReveal: null,
        revision: current.revision + 1,
      }));
    }
    // Run evidence is context-scoped by runStore and must survive the handoff
    // long enough for switchRunContext() to cache it. Clearing it here erased
    // lesson output/stdin before practice or Editor could save that context.
    // Project revision still invalidates in-flight operations; selection is
    // not portable across project contexts.
    useAIStore.getState().setActiveSelection(null);
  },
}));

export function captureProjectVersion(): ProjectVersion {
  const state = useProjectStore.getState();
  return { contextKey: state.projectContext, revision: state.revision };
}

export function isProjectVersionCurrent(version: ProjectVersion): boolean {
  const state = useProjectStore.getState();
  return state.projectContext === version.contextKey && state.revision === version.revision;
}

export function beginProjectOperation(): ProjectOperationIdentity {
  return { id: crypto.randomUUID(), project: captureProjectVersion() };
}

export function isProjectOperationCurrent(operation: ProjectOperationIdentity): boolean {
  return isProjectVersionCurrent(operation.project);
}
