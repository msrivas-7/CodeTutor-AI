import { beforeEach, describe, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
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
    vi.stubGlobal("crypto", webcrypto);
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

  it("renames an empty file without mistaking it for a missing file", () => {
    useProjectStore.setState({
      files: { "untitled.py": "" },
      order: ["untitled.py"],
      activeFile: "untitled.py",
      openTabs: ["untitled.py"],
    });

    expect(useProjectStore.getState().renameFile("untitled.py", "named.py")).toEqual({ ok: true });
    expect(useProjectStore.getState()).toMatchObject({
      files: { "named.py": "" },
      order: ["named.py"],
      activeFile: "named.py",
      openTabs: ["named.py"],
    });
  });

  it("deletes an empty file and selects a surviving neighbor", () => {
    useProjectStore.setState({
      files: { "main.py": "print('keep')\n", "empty.py": "" },
      order: ["main.py", "empty.py"],
      activeFile: "empty.py",
      openTabs: ["main.py", "empty.py"],
      revision: 0,
    });

    useProjectStore.getState().deleteFile("empty.py");

    expect(useProjectStore.getState()).toMatchObject({
      files: { "main.py": "print('keep')\n" },
      order: ["main.py"],
      activeFile: "main.py",
      openTabs: ["main.py"],
      revision: 1,
    });
  });

  it("does not resurrect a deleted file from a stale editor callback", () => {
    useProjectStore.setState({
      files: { "main.py": "print('keep')\n", "empty.py": "" },
      order: ["main.py", "empty.py"],
      activeFile: "empty.py",
      openTabs: ["main.py", "empty.py"],
      revision: 0,
    });

    useProjectStore.getState().deleteFile("empty.py");
    useProjectStore.getState().setContent("empty.py", "");

    expect(useProjectStore.getState()).toMatchObject({
      files: { "main.py": "print('keep')\n" },
      order: ["main.py"],
      activeFile: "main.py",
      openTabs: ["main.py"],
      revision: 1,
    });
  });

  it("does not overwrite an existing empty file during creation", () => {
    useProjectStore.setState({
      files: { "empty.py": "" },
      order: ["empty.py"],
      activeFile: "empty.py",
      openTabs: ["empty.py"],
    });

    expect(useProjectStore.getState().createFile("empty.py", "replacement")).toEqual({
      ok: false,
      error: "file exists",
    });
    expect(useProjectStore.getState().files).toEqual({ "empty.py": "" });
  });

  it("does not overwrite an existing empty destination during rename", () => {
    useProjectStore.setState({
      files: { "source.py": "print('keep me')", "empty.py": "" },
      order: ["source.py", "empty.py"],
      activeFile: "source.py",
      openTabs: ["source.py", "empty.py"],
    });

    expect(useProjectStore.getState().renameFile("source.py", "empty.py")).toEqual({
      ok: false,
      error: "destination exists",
    });
    expect(useProjectStore.getState().files).toEqual({
      "source.py": "print('keep me')",
      "empty.py": "",
    });
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

  it("keeps lesson and each practice exercise in independent project and run contexts", () => {
    const project = useProjectStore.getState();
    const run = useRunStore.getState();
    const lessonContext = "lesson:isolation-course/isolation-lesson";
    const practiceOne = `${lessonContext}/practice/one`;
    const practiceTwo = `${lessonContext}/practice/two`;

    project.switchProjectContext(lessonContext, {
      language: "python",
      files: { "main.py": "lesson code\n" },
      order: ["main.py"],
      activeFile: "main.py",
      openTabs: ["main.py"],
    });
    run.switchRunContext(lessonContext, { stdin: "lesson input\n" });
    run.beginRun("lesson-run");
    run.commitRunResult("lesson-run", { ...okRunResult, stdout: "lesson output\n" });
    run.finishRun("lesson-run");

    project.switchProjectContext(practiceOne, {
      language: "python",
      files: { "main.py": "practice one starter\n" },
      order: ["main.py"],
      activeFile: "main.py",
      openTabs: ["main.py"],
    });
    run.switchRunContext(practiceOne);
    expect(useRunStore.getState()).toMatchObject({ stdin: "", result: null });
    project.setContent("main.py", "practice one work\n");
    run.setStdin("practice one input\n");

    project.switchProjectContext(practiceTwo, {
      language: "python",
      files: { "main.py": "practice two starter\n" },
      order: ["main.py"],
      activeFile: "main.py",
      openTabs: ["main.py"],
    });
    run.switchRunContext(practiceTwo);
    expect(useProjectStore.getState().files["main.py"]).toBe(
      "practice two starter\n",
    );
    expect(useRunStore.getState()).toMatchObject({ stdin: "", result: null });

    project.switchProjectContext(lessonContext);
    run.switchRunContext(lessonContext);
    expect(useProjectStore.getState().files["main.py"]).toBe("lesson code\n");
    expect(useRunStore.getState().stdin).toBe("lesson input\n");
    expect(useRunStore.getState().result?.stdout).toBe("lesson output\n");

    project.switchProjectContext(practiceOne);
    run.switchRunContext(practiceOne);
    expect(useProjectStore.getState().files["main.py"]).toBe(
      "practice one work\n",
    );
    expect(useRunStore.getState().stdin).toBe("practice one input\n");
    expect(useRunStore.getState().result).toBeNull();
  });
});

const okRunResult = {
  stdout: "ok\n",
  stderr: "",
  exitCode: 0,
  errorType: "none" as const,
  durationMs: 2,
  stage: "run" as const,
};
