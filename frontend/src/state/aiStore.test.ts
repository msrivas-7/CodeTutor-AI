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

  it("invalidates an in-flight reply when the conversation is cleared", () => {
    const before = useAIStore.getState().conversationRevision;
    useAIStore.setState({
      asking: true,
      pending: { raw: "partial", sections: {} },
      pendingScripted: true,
      pendingAsk: "late action",
    });

    useAIStore.getState().clearConversation();

    expect(useAIStore.getState()).toMatchObject({
      asking: false,
      pending: null,
      pendingScripted: false,
      pendingAsk: null,
      conversationRevision: before + 1,
    });
  });
});

describe("composer focus tickets", () => {
  it("settles only the latest request and does not replay it after remount", () => {
    useAIStore.getState().bumpFocusComposer();
    const first = useAIStore.getState().focusComposerNonce;
    expect(first).toBe(1);

    useAIStore.getState().settleFocusComposer(first);
    expect(useAIStore.getState().focusComposerSettledNonce).toBe(first);

    useAIStore.getState().bumpFocusComposer();
    const second = useAIStore.getState().focusComposerNonce;
    expect(second).toBe(2);

    useAIStore.getState().settleFocusComposer(first);
    expect(useAIStore.getState().focusComposerSettledNonce).toBe(first);

    useAIStore.getState().settleFocusComposer(second);
    expect(useAIStore.getState().focusComposerSettledNonce).toBe(second);
  });
});
