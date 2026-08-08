import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearAnonWorkspace,
  readAnonTutorState,
  readAnonWorkspace,
  writeAnonTutorState,
  writeAnonWorkspace,
} from "./anonStash";

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}

describe("anonymous workspace recovery", () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
    vi.stubGlobal("window", { sessionStorage: storage });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("round-trips code, stdin, output, error state, and completion", () => {
    writeAnonWorkspace({
      courseId: "python-fundamentals",
      lessonId: "hello-world",
      files: { "main.py": 'print("kept")' },
      stdin: "Ada\n",
      result: {
        stdout: "kept\n",
        stderr: "",
        exitCode: 0,
        errorType: "none",
        durationMs: 12,
        stage: "run",
      },
      runError: null,
      completed: true,
      practiceCompletedIds: ["two-lines"],
    });

    expect(readAnonWorkspace()).toMatchObject({
      files: { "main.py": 'print("kept")' },
      stdin: "Ada\n",
      result: { stdout: "kept\n", exitCode: 0 },
      completed: true,
      practiceCompletedIds: ["two-lines"],
    });
  });

  it("restores anonymous tutor history and exhaustion for the same UTC day", () => {
    writeAnonTutorState({
      exhausted: true,
      history: [
        { id: "u1", role: "user", content: "Can I ask again?" },
        { id: "a1", role: "assistant", content: "Today's free questions are used." },
      ],
    });

    expect(readAnonTutorState()).toMatchObject({
      exhausted: true,
      history: [
        { role: "user", content: "Can I ask again?" },
        { role: "assistant", content: "Today's free questions are used." },
      ],
    });
  });

  it("re-enables the tutor after the UTC quota day changes without losing history", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-07T23:59:00Z"));
    writeAnonTutorState({
      exhausted: true,
      history: [{ id: "a1", role: "assistant", content: "Come back tomorrow." }],
    });
    vi.setSystemTime(new Date("2026-08-08T00:01:00Z"));
    expect(readAnonTutorState()).toMatchObject({
      exhausted: false,
      history: [{ content: "Come back tomorrow." }],
      quotaDateUtc: "2026-08-08",
    });
    vi.useRealTimers();
  });

  it("rejects malformed stored output instead of poisoning the workspace", () => {
    storage.setItem(
      "codetutor.anonWorkspace",
      JSON.stringify({
        v: 1,
        courseId: "python-fundamentals",
        lessonId: "hello-world",
        files: { "main.py": "ok", "bad.py": 7 },
        stdin: "",
        result: { stdout: 99 },
        runError: null,
        completed: false,
        updatedAt: new Date().toISOString(),
      }),
    );

    expect(readAnonWorkspace()).toBeNull();
  });

  it("clears the one-tab workspace only after handoff succeeds", () => {
    writeAnonWorkspace({
      courseId: "python-fundamentals",
      lessonId: "hello-world",
      files: { "main.py": "print()" },
      stdin: "",
      result: null,
      runError: null,
      completed: false,
    });
    clearAnonWorkspace();
    expect(readAnonWorkspace()).toBeNull();
  });
});
