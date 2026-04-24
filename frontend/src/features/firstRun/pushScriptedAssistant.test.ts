import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useAIStore } from "../../state/aiStore";
import { pushScriptedAssistant } from "./pushScriptedAssistant";

function resetAIStore() {
  useAIStore.setState({
    history: [],
    pending: null,
    pendingScripted: false,
    asking: false,
  });
}

describe("pushScriptedAssistant", () => {
  beforeEach(() => {
    resetAIStore();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    resetAIStore();
  });

  it("flags pendingScripted=true while streaming", async () => {
    const handle = pushScriptedAssistant("hi", { charIntervalMs: 10 });
    // After the first tick the scripted stream has been seeded.
    await vi.advanceTimersByTimeAsync(5);
    expect(useAIStore.getState().pendingScripted).toBe(true);
    expect(useAIStore.getState().pending).not.toBeNull();
    await vi.advanceTimersByTimeAsync(50);
    await handle.done;
    expect(useAIStore.getState().pendingScripted).toBe(false);
    expect(useAIStore.getState().pending).toBeNull();
  });

  it("commits final message with meta.scripted=true", async () => {
    const handle = pushScriptedAssistant("hello", { charIntervalMs: 5 });
    await vi.advanceTimersByTimeAsync(200);
    await handle.done;
    const history = useAIStore.getState().history;
    expect(history).toHaveLength(1);
    expect(history[0].role).toBe("assistant");
    expect(history[0].content).toBe("hello");
    expect(history[0].meta?.scripted).toBe(true);
    expect(history[0].sections?.summary).toBe("hello");
  });

  it("flips asking true while typing and false after commit by default", async () => {
    const handle = pushScriptedAssistant("ok", { charIntervalMs: 5 });
    await vi.advanceTimersByTimeAsync(3);
    expect(useAIStore.getState().asking).toBe(true);
    await vi.advanceTimersByTimeAsync(50);
    await handle.done;
    expect(useAIStore.getState().asking).toBe(false);
  });

  it("respects flipAsking=false", async () => {
    useAIStore.getState().setAsking(false);
    const handle = pushScriptedAssistant("x", {
      charIntervalMs: 5,
      flipAsking: false,
    });
    await vi.advanceTimersByTimeAsync(10);
    expect(useAIStore.getState().asking).toBe(false);
    await handle.done;
    expect(useAIStore.getState().asking).toBe(false);
  });

  it("streams partial content through pending before commit", async () => {
    const handle = pushScriptedAssistant("abcdef", { charIntervalMs: 10 });
    await vi.advanceTimersByTimeAsync(25);
    // 2-3 chars should have landed; pending.summary reflects the partial.
    const partial = useAIStore.getState().pending?.sections.summary ?? "";
    expect(partial.length).toBeGreaterThan(0);
    expect(partial.length).toBeLessThan(6);
    expect("abcdef".startsWith(partial)).toBe(true);
    await vi.advanceTimersByTimeAsync(100);
    await handle.done;
  });

  it("cancel() commits the partial content and clears pending", async () => {
    const handle = pushScriptedAssistant("abcdefghij", { charIntervalMs: 20 });
    await vi.advanceTimersByTimeAsync(45); // ~2 chars in
    handle.cancel();
    await vi.advanceTimersByTimeAsync(25); // next tick notices cancelled
    await handle.done;
    const history = useAIStore.getState().history;
    expect(history).toHaveLength(1);
    const committed = history[0].content;
    expect(committed.length).toBeGreaterThan(0);
    expect(committed.length).toBeLessThan(10);
    expect("abcdefghij".startsWith(committed)).toBe(true);
    expect(history[0].meta?.scripted).toBe(true);
    expect(useAIStore.getState().pending).toBeNull();
    expect(useAIStore.getState().pendingScripted).toBe(false);
  });
});
