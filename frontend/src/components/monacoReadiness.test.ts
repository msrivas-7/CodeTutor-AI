import { describe, expect, it, vi } from "vitest";
import { pollForEditorReadiness } from "./monacoReadiness";

describe("pollForEditorReadiness", () => {
  it("continues beyond the old 120-frame ceiling and confirms a delayed mount", () => {
    let current: string | null = null;
    const queued: Array<() => void> = [];
    let handle = 0;
    const onReady = vi.fn();
    const stop = pollForEditorReadiness({
      expected: "ready buffer",
      readCurrent: () => current,
      onReady,
      schedule: (callback) => {
        queued.push(callback);
        handle += 1;
        return handle;
      },
      cancel: vi.fn(),
    });

    for (let attempt = 0; attempt < 130; attempt += 1) {
      queued.shift()?.();
    }
    expect(onReady).not.toHaveBeenCalled();

    current = "ready buffer";
    queued.shift()?.();
    expect(onReady).toHaveBeenCalledOnce();
    stop();
  });
});
