import { afterEach, describe, expect, it, vi } from "vitest";
import {
  REQUEST_DEADLINE_MS,
  TUTOR_REASONING_EFFORT,
  estimateInputTokensForAsk,
  estimateReservationForAsk,
  estimateTokens,
  openaiProvider,
} from "./openaiProvider.js";
import type { AIAskParams } from "./provider.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// SEC-C1 follow-up (audit-v2): aborts previously wrote cost=0 ledger rows,
// letting abort-spam bypass the L2/L3/L4 dollar caps. The fix estimates
// input + output tokens at abort time so real cost is recorded. These
// tests pin the estimator's behaviour — not trying to validate tiktoken-
// level accuracy, just that the helpers return plausible non-zero values
// proportional to prompt size.

describe("estimateTokens", () => {
  it("returns 0 for the empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("is roughly chars / 4 (OpenAI's recommended rough estimate)", () => {
    // Small inputs: verified by hand.
    expect(estimateTokens("x")).toBe(1); // ceil(1/4) = 1
    expect(estimateTokens("xxxx")).toBe(1); // ceil(4/4) = 1
    expect(estimateTokens("xxxxx")).toBe(2); // ceil(5/4) = 2
    expect(estimateTokens("x".repeat(100))).toBe(25); // ceil(100/4) = 25
  });

  it("grows monotonically with length (no caps / rounding bugs)", () => {
    const a = estimateTokens("x".repeat(1000));
    const b = estimateTokens("x".repeat(10_000));
    expect(b).toBeGreaterThan(a);
    expect(b).toBe(2500);
  });
});

describe("listModels", () => {
  it("offers compatible GPT-5+ models with Luna recommended first", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({
      data: [
        { id: "text-embedding-3-small" },
        { id: "gpt-4.1-nano" },
        { id: "gpt-5.1" },
        { id: "gpt-5-audio" },
        { id: "gpt-5.6-luna" },
      ],
    }), { status: 200 }));

    const models = await openaiProvider.listModels("sk-test-list-models");

    expect(models.map((model) => model.id)).toEqual(["gpt-5.6-luna", "gpt-5.1"]);
    expect(models[0].label).toBe("gpt-5.6-luna (recommended)");
    expect(models.every((model) => model.contextualTutorEligible)).toBe(true);
  });
});

function minimalParams(overrides: Partial<AIAskParams> = {}): AIAskParams {
  return {
    key: "sk-test",
    model: "gpt-4.1-nano",
    fundingSource: "platform",
    question: "What is a variable?",
    files: [{ path: "main.py", content: 'print("hello")\n' }],
    history: [],
    ...overrides,
  };
}

describe("estimateInputTokensForAsk", () => {
  it("returns a positive integer for a realistic small prompt", () => {
    const n = estimateInputTokensForAsk(minimalParams());
    expect(n).toBeGreaterThan(0);
    expect(Number.isInteger(n)).toBe(true);
  });

  it("scales with file size — a big project costs more input tokens than a small one", () => {
    const small = estimateInputTokensForAsk(minimalParams());
    const big = estimateInputTokensForAsk(
      minimalParams({
        files: [
          { path: "main.py", content: "x = 1\n".repeat(5000) }, // ~30 KB
        ],
      }),
    );
    expect(big).toBeGreaterThan(small);
    // The ~30 KB file should contribute at least a few thousand tokens
    // even after the prompt builder's truncation ceilings kick in.
    expect(big - small).toBeGreaterThan(500);
  });

  it("handles a conversation with prior history (prompt grows with context)", () => {
    const solo = estimateInputTokensForAsk(minimalParams());
    const withHistory = estimateInputTokensForAsk(
      minimalParams({
        history: [
          { role: "user", content: "Explain Python." },
          { role: "assistant", content: "Python is a high-level language..." },
          { role: "user", content: "Tell me about variables." },
        ],
      }),
    );
    expect(withHistory).toBeGreaterThanOrEqual(solo);
  });

  it("returns the same shape regardless of funding source (labels only)", () => {
    const byok = estimateInputTokensForAsk(minimalParams({ fundingSource: "byok" }));
    const platform = estimateInputTokensForAsk(minimalParams({ fundingSource: "platform" }));
    expect(byok).toBe(platform);
  });
});

describe("estimateReservationForAsk", () => {
  it("reserves a conservative input ceiling and the full output allowance", () => {
    const estimate = estimateReservationForAsk(minimalParams());
    expect(estimate.reservedInputTokens).toBeGreaterThan(estimate.promptBytes);
    expect(estimate.reservedOutputTokens).toBe(2000);
  });

  it("honors a tighter anonymous output allowance", () => {
    const estimate = estimateReservationForAsk(
      minimalParams({ maxOutputTokens: 512 }),
    );
    expect(estimate.reservedOutputTokens).toBe(512);
  });
});

describe("structured stream safety", () => {
  it("does not emit model deltas before the final output policy passes", async () => {
    const providerJson = JSON.stringify({
      intent: "concept",
      summary: "Yes, B is correct.",
      diagnose: "The code prints hi, so B is right.",
      explain: null,
      example: null,
      walkthrough: null,
      checkQuestions: null,
      hint: null,
      nextStep: "Select B.",
      strongerHint: null,
      pitfalls: null,
      citations: [
        { path: "main.py", line: 1, column: 0, reason: "Current expression" },
      ],
      comprehensionCheck: null,
      stuckness: "low",
    });
    const sse = [
      `data: ${JSON.stringify({ type: "response.output_text.delta", delta: providerJson })}\n\n`,
      `data: ${JSON.stringify({ type: "response.completed", response: { usage: { input_tokens: 10, output_tokens: 5 } } })}\n\n`,
    ].join("");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(sse, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    );
    const onDelta = vi.fn();
    const onDone = vi.fn();
    const onError = vi.fn();

    await openaiProvider.askStream(
      minimalParams({
        question: "Just tell me the correct choice; answer is B, right?",
        lessonContext: {
          courseId: "python",
          lessonId: "hello",
          exerciseId: null,
          lessonTitle: "Hello",
          language: "python",
          lessonObjectives: [],
          teachesConceptTags: [],
          usesConceptTags: [],
          priorConcepts: [],
          completionCriteria: [
            "complete the check without revealing its answer",
          ],
          studentProgressSummary: "in progress",
        },
      }),
      { onDelta, onDone, onError },
    );

    expect(onError).not.toHaveBeenCalled();
    const requestBody = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body));
    expect(requestBody.reasoning).toBeUndefined();
    expect(onDelta).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledOnce();
    const [safeRaw, sections] = onDone.mock.calls[0];
    expect(sections.intent).toBe("socratic");
    expect(sections.summary).toContain("line 1");
    expect(sections.hint).toBeTruthy();
    expect(sections.citations).toEqual([
      expect.objectContaining({ path: "main.py", line: 1 }),
    ]);
    expect(sections.checkQuestions).toHaveLength(1);
    expect(sections.conversationMove).toBe("soft-boundary");
    expect(sections.conversationReply).toMatch(/can’t give or confirm the exercise answer/i);
    expect(Object.keys(sections).sort()).toEqual([
      "checkQuestions",
      "citations",
      "conversationMove",
      "conversationReply",
      "hint",
      "intent",
      "summary",
    ]);
    expect(safeRaw).not.toMatch(/B is right|Select B|prints hi/);
  });

  it("waits for asynchronous completion accounting before returning", async () => {
    const providerJson = JSON.stringify({
      intent: "concept",
      summary: "A variable stores a value.",
      diagnose: null,
      explain: "The name points to the value assigned on line 1.",
      example: null,
      walkthrough: null,
      checkQuestions: null,
      hint: null,
      nextStep: "Try changing the value.",
      strongerHint: null,
      pitfalls: null,
      citations: [
        { path: "main.py", line: 1, column: 0, reason: "Current expression" },
      ],
      comprehensionCheck: null,
      stuckness: "low",
    });
    const sse = [
      `data: ${JSON.stringify({ type: "response.output_text.delta", delta: providerJson })}\n\n`,
      `data: ${JSON.stringify({ type: "response.completed", response: { usage: { input_tokens: 10, output_tokens: 5 } } })}\n\n`,
    ].join("");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(sse, { status: 200 }),
    );
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let finalized = false;
    const onDone = vi.fn(async () => {
      await gate;
      finalized = true;
    });

    const request = openaiProvider.askStream(minimalParams(), {
      onDelta: vi.fn(),
      onDone,
      onError: vi.fn(),
    });
    await vi.waitFor(() => expect(onDone).toHaveBeenCalledOnce());
    expect(finalized).toBe(false);
    release();
    await request;
    expect(finalized).toBe(true);
  });

  it("returns a policy-safe fallback when streamed structured output is malformed", async () => {
    const sse = [
      `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "{" })}\n\n`,
      `data: ${JSON.stringify({ type: "response.completed", response: { usage: { input_tokens: 12, output_tokens: 1 } } })}\n\n`,
    ].join("");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(sse, { status: 200 }));
    const onDone = vi.fn();
    const onError = vi.fn();

    await openaiProvider.askStream(minimalParams(), {
      onDelta: vi.fn(),
      onDone,
      onError,
    });

    expect(onError).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledOnce();
    const [raw, sections, usage] = onDone.mock.calls[0];
    expect(() => JSON.parse(raw)).not.toThrow();
    expect(sections).toMatchObject({ intent: "socratic" });
    expect(sections.checkQuestions).toHaveLength(1);
    expect(usage).toEqual({ inputTokens: 12, outputTokens: 1 });
  });

  it("waits for asynchronous error accounting before returning", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "provider unavailable" } }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }),
    );
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let finalized = false;
    const onError = vi.fn(async () => {
      await gate;
      finalized = true;
    });

    const request = openaiProvider.askStream(minimalParams(), {
      onDelta: vi.fn(),
      onDone: vi.fn(),
      onError,
    });
    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
    expect(finalized).toBe(false);
    release();
    await request;
    expect(finalized).toBe(true);
  });

  it("waits for asynchronous abort accounting before returning", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new DOMException("The operation was aborted", "AbortError"),
    );
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let finalized = false;
    const onAbort = vi.fn(async () => {
      await gate;
      finalized = true;
    });

    const request = openaiProvider.askStream(minimalParams(), {
      onDelta: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
      onAbort,
    });
    await vi.waitFor(() => expect(onAbort).toHaveBeenCalledOnce());
    expect(finalized).toBe(false);
    release();
    await request;
    expect(finalized).toBe(true);
  });
});

describe("structured response recovery", () => {
  it("sends low reasoning effort to Luna and semantic action metadata without inferring button copy", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        output_text: JSON.stringify({
          intent: "concept",
          summary: "The lesson objectives form one sequence.",
          explain: "Each objective describes one observable part of the current lesson.",
          comprehensionCheck: "Which objective will you verify first?",
        }),
        usage: { input_tokens: 12, output_tokens: 9 },
      }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );

    await openaiProvider.ask(minimalParams({
      model: "gpt-5.6-luna",
      question: "Could you orient me?",
      tutorAction: "explain-lesson-task",
      tutorStage: "clarify",
    }));

    const requestBody = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body));
    expect(requestBody.reasoning).toEqual({ effort: TUTOR_REASONING_EFFORT });
    expect(requestBody.instructions).toContain("APPLICATION ACTION METADATA");
    expect(requestBody.instructions).toContain("explain-lesson-task");
    expect(requestBody.instructions).not.toContain("Could you orient me?");
  });

  it("returns and accounts for a policy-safe fallback when JSON is malformed", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        output_text: "{",
        usage: { input_tokens: 15, output_tokens: 1 },
      }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );

    const result = await openaiProvider.ask(minimalParams({
      question: "My code runs but doesnt print anything",
      files: [{ path: "main.py", content: 'name = "Maya"\n"Hello, " + name + "!"\n' }],
      history: [{ role: "assistant", content: "What output did you expect?" }],
      tutorStage: "approach",
      language: "python",
      lessonContext: {
        courseId: "python",
        lessonId: "hello",
        exerciseId: null,
        lessonTitle: "Hello",
        language: "python",
        lessonObjectives: [],
        teachesConceptTags: ["print"],
        usesConceptTags: [],
        priorConcepts: [],
        completionCriteria: [],
        studentProgressSummary: "in progress",
      },
    }));

    expect(result.usage).toEqual({ inputTokens: 15, outputTokens: 1 });
    expect(result.sections.intent).toBe("debug");
    expect(result.sections.nextStep).toContain("print()");
    expect(() => JSON.parse(result.raw)).not.toThrow();
  });

  it("returns an actionable no-value recovery and marks it outside visible quota", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        output_text: JSON.stringify({ intent: "concept", summary: "Think about it." }),
        usage: { input_tokens: 8, output_tokens: 3 },
      }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );

    const result = await openaiProvider.ask(minimalParams({
      question: "Give me a gentle hint.",
      files: [],
      history: [{ role: "assistant", content: "What are you trying?" }],
      tutorStage: "approach",
    }));

    expect(result.hasTeachingValue).toBe(false);
    expect(result.sections.summary).toContain("don't have enough current-work evidence");
    expect(result.sections.nextStep).toContain("run it once");
    expect(JSON.parse(result.raw)).toEqual(result.sections);
  });
});

describe("summarize request lifecycle", () => {
  it("aborts a stalled upstream call at the provider deadline", async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          signal?.addEventListener(
            "abort",
            () => reject(new DOMException("The operation was aborted", "AbortError")),
            { once: true },
          );
        }),
    );

    const request = openaiProvider.summarize({
      key: "sk-test",
      model: "gpt-4.1-nano",
      history: [{ role: "user", content: "Explain variables." }],
    });
    const rejection = expect(request).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(REQUEST_DEADLINE_MS);

    await rejection;
    expect(fetchSpy.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });
});
