import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearAnonWorkspace,
  readAnonWorkspace,
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
    });

    expect(readAnonWorkspace()).toMatchObject({
      files: { "main.py": 'print("kept")' },
      stdin: "Ada\n",
      result: { stdout: "kept\n", exitCode: 0 },
      completed: true,
    });
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
