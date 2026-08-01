import { beforeEach, describe, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { useAIStore } from "./aiStore";

beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  useAIStore.getState().reset();
});

describe("per-task tutor progression proof", () => {
  it("caches proof with its chat context and restores it atomically", () => {
    const store = useAIStore.getState();
    store.switchChatContext("lesson:python/variables");
    useAIStore.getState().setTutorProgressToken("token-a");

    useAIStore.getState().switchChatContext("practice:python/variables/ex-1");
    expect(useAIStore.getState().tutorProgressToken).toBeNull();
    useAIStore.getState().setTutorProgressToken("token-b");

    useAIStore.getState().switchChatContext("lesson:python/variables");
    expect(useAIStore.getState().tutorProgressToken).toBe("token-a");
    useAIStore.getState().switchChatContext("practice:python/variables/ex-1");
    expect(useAIStore.getState().tutorProgressToken).toBe("token-b");
  });

  it("clears proof when the learner starts the task conversation over", () => {
    useAIStore.getState().switchChatContext("lesson:python/variables");
    useAIStore.getState().setTutorProgressToken("token-a");
    useAIStore.getState().clearConversation();
    expect(useAIStore.getState().tutorProgressToken).toBeNull();

    useAIStore.getState().switchChatContext("lesson:python/loops");
    useAIStore.getState().switchChatContext("lesson:python/variables");
    expect(useAIStore.getState().tutorProgressToken).toBeNull();
  });
});
