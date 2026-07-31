import { beforeEach, describe, expect, it } from "vitest";
import { useAIStore } from "./aiStore";
import { useRunStore } from "./runStore";
import {
  beginProjectOperation,
  captureProjectVersion,
  isProjectOperationCurrent,
  isProjectVersionCurrent,
  useProjectStore,
} from "./projectStore";

describe("project revision contract", () => {
  beforeEach(() => {
    useAIStore.getState().reset();
    useRunStore.getState().reset();
    useProjectStore.setState({
      language: "python",
      files: { "main.py": "print('one')\n" },
      order: ["main.py"],
      activeFile: "main.py",
      openTabs: ["main.py"],
      pendingReveal: null,
      projectContext: "test:project",
      revision: 0,
    });
  });

  it("advances only when executable source actually changes", () => {
    const store = useProjectStore.getState();
    store.setContent("main.py", "print('one')\n");
    expect(useProjectStore.getState().revision).toBe(0);

    store.setContent("main.py", "print('two')\n");
    expect(useProjectStore.getState().revision).toBe(1);
    expect(useProjectStore.getState().files["main.py"]).toContain("two");
  });

  it("binds captured versions and operations to both context and revision", () => {
    const version = captureProjectVersion();
    const operation = beginProjectOperation();
    expect(isProjectVersionCurrent(version)).toBe(true);
    expect(isProjectOperationCurrent(operation)).toBe(true);

    useProjectStore.getState().setContent("main.py", "broken =\n");
    expect(isProjectVersionCurrent(version)).toBe(false);
    expect(isProjectOperationCurrent(operation)).toBe(false);
  });

  it("invalidates run evidence and revision-bound selection on edit", () => {
    const version = captureProjectVersion();
    useAIStore.getState().setActiveSelection({
      selection: { path: "main.py", startLine: 1, endLine: 1, text: "print" },
      project: version,
    });
    useRunStore.getState().beginRun("prior-run");
    useRunStore.getState().commitRunResult("prior-run", {
      stdout: "one\n",
      stderr: "",
      exitCode: 0,
      errorType: "none",
      durationMs: 2,
      stage: "run",
    });

    useProjectStore.getState().setContent("main.py", "print('new')\n");
    expect(useRunStore.getState().result).toBeNull();
    expect(useAIStore.getState().activeSelection).toBeNull();
  });

  it("makes a project-context switch a new revision even when source text matches", () => {
    const version = captureProjectVersion();
    useProjectStore.getState().switchProjectContext("test:other", {
      language: "python",
      files: { "main.py": "print('one')\n" },
      order: ["main.py"],
      activeFile: "main.py",
      openTabs: ["main.py"],
    });

    expect(useProjectStore.getState().projectContext).toBe("test:other");
    expect(useProjectStore.getState().revision).toBe(1);
    expect(isProjectVersionCurrent(version)).toBe(false);
  });

  it("invalidates the project identity and derived evidence on session reset", () => {
    const version = captureProjectVersion();
    useRunStore.getState().beginRun("session-a-run");
    useRunStore.getState().commitRunResult("session-a-run", {
      stdout: "private output\n",
      stderr: "",
      exitCode: 0,
      errorType: "none",
      durationMs: 2,
      stage: "run",
    });

    useProjectStore.getState().resetEditorHydration();

    expect(isProjectVersionCurrent(version)).toBe(false);
    expect(useRunStore.getState().result).toBeNull();
  });
});
