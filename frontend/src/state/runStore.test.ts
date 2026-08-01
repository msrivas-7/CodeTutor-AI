import { afterEach, describe, expect, it } from "vitest";
import { useRunStore } from "./runStore";
import type { RunResult } from "../types";

const okResult: RunResult = {
  stdout: "ok\n",
  stderr: "",
  exitCode: 0,
  errorType: "none",
  durationMs: 4,
  stage: "run",
};

describe("runStore", () => {
  afterEach(() => {
    // Reset between tests so state from one case doesn't leak.
    useRunStore.getState().reset();
  });

  describe("runningTests flag (QA-C2)", () => {
    // Audit-v2 fix: the global Cmd+Enter handler in useLessonRunner reads
    // `runningTests` from this store to short-circuit `handleRun` while a
    // Check is executing. Without a shared flag, Cmd+Enter during "Checking…"
    // fires a snapshot that wipes the workspace the test harness is still
    // reading — silent wrong verdicts. `runningTests` is the contract
    // between useLessonValidator (writer) and useLessonRunner (reader).

    it("exposes runningTests alongside running, toggleable independently", () => {
      const s = useRunStore.getState();
      expect(s.running).toBe(false);
      expect(s.runningTests).toBe(false);

      s.setRunningTests(true);
      expect(useRunStore.getState().runningTests).toBe(true);
      // running is a separate flag; setting runningTests must not affect it.
      expect(useRunStore.getState().running).toBe(false);
    });

    it("clears runningTests on switchRunContext so a stale validator effect can't leak across lessons", () => {
      useRunStore.getState().setRunningTests(true);
      useRunStore.getState().switchRunContext("lesson:a/b");
      expect(useRunStore.getState().runningTests).toBe(false);
    });

    it("clears runningTests on reset (sign-out path)", () => {
      useRunStore.getState().setRunningTests(true);
      useRunStore.getState().reset();
      expect(useRunStore.getState().runningTests).toBe(false);
    });
  });

  describe("Run operation identity", () => {
    it("publishes a monotonic Run revision even when execution finishes immediately", () => {
      const initial = useRunStore.getState().runRevision;
      const store = useRunStore.getState();

      expect(store.beginRun("fast-run")).toBe(true);
      store.commitRunResult("fast-run", okResult);
      store.finishRun("fast-run");

      expect(useRunStore.getState().runRevision).toBe(initial + 1);
      expect(useRunStore.getState().running).toBe(false);
    });

    it("publishes only through the active operation id", () => {
      const store = useRunStore.getState();
      expect(store.beginRun("run-a")).toBe(true);
      expect(store.commitRunResult("run-b", okResult)).toBe(false);
      expect(useRunStore.getState().result).toBeNull();

      expect(store.commitRunResult("run-a", okResult)).toBe(true);
      store.finishRun("run-a");
      expect(useRunStore.getState().result).toEqual(okResult);
      expect(useRunStore.getState().running).toBe(false);
    });

    it("rejects a late result after navigation invalidates the operation", () => {
      const store = useRunStore.getState();
      store.switchRunContext("lesson:course/a");
      expect(store.beginRun("lesson-a-run")).toBe(true);

      store.switchRunContext("lesson:course/b");
      expect(useRunStore.getState().activeRunId).toBeNull();
      expect(store.commitRunResult("lesson-a-run", okResult)).toBe(false);
      expect(useRunStore.getState().result).toBeNull();
    });

    it("a late finally from an old run cannot stop a newer run", () => {
      const store = useRunStore.getState();
      expect(store.beginRun("old")).toBe(true);
      store.invalidateEvidence();
      expect(store.beginRun("new")).toBe(true);

      store.finishRun("old");
      expect(useRunStore.getState().running).toBe(true);
      expect(useRunStore.getState().activeRunId).toBe("new");
    });

    it("keeps the real run busy while stopping and rejects its late result", () => {
      const store = useRunStore.getState();
      expect(store.beginRun("run-to-stop")).toBe(true);
      expect(store.requestStop()).toBe(true);
      expect(useRunStore.getState()).toMatchObject({
        running: true,
        stopping: true,
        activeRunId: "run-to-stop",
      });
      expect(store.commitRunResult("run-to-stop", okResult)).toBe(false);

      store.finishStop();
      expect(useRunStore.getState()).toMatchObject({
        running: false,
        stopping: false,
        activeRunId: null,
        runNotice: "Run stopped. Your code is unchanged.",
      });
    });

    it("returns to a retryable stopping state when cancellation fails", () => {
      const store = useRunStore.getState();
      store.beginRun("run-a");
      store.requestStop();
      store.failStop("Could not stop yet");
      expect(useRunStore.getState()).toMatchObject({
        running: true,
        stopping: false,
        activeRunId: "run-a",
        runNotice: "Could not stop yet",
      });
    });
  });

  describe("execution-input identity", () => {
    it("advances when stdin changes but not for an identical value", () => {
      const store = useRunStore.getState();
      const initial = store.inputRevision;

      store.setStdin(store.stdin);
      expect(useRunStore.getState().inputRevision).toBe(initial);

      store.setStdin(`${store.stdin}new input\n`);
      expect(useRunStore.getState().inputRevision).toBe(initial + 1);
    });

    it("stays monotonic across context switches and sign-out reset", () => {
      const initial = useRunStore.getState().inputRevision;
      useRunStore.getState().switchRunContext("lesson:course/a");
      const afterSwitch = useRunStore.getState().inputRevision;
      expect(afterSwitch).toBeGreaterThan(initial);

      useRunStore.getState().reset();
      expect(useRunStore.getState().inputRevision).toBeGreaterThan(afterSwitch);
    });
  });
});
