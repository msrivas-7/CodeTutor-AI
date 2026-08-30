import { describe, expect, it } from "vitest";
import {
  DEFAULT_JUDGE_REASONING_EFFORT,
  gradeRubric,
  type JudgeFetcher,
} from "./judgeModel.js";

function mockOk(content: string): JudgeFetcher {
  return async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: content }],
        },
      ],
    }),
    text: async () => "",
  });
}

function mockFail(status: number, body: string): JudgeFetcher {
  return async () => ({
    ok: false,
    status,
    json: async () => ({}),
    text: async () => body,
  });
}

describe("gradeRubric", () => {
  it("treats first non-whitespace 'Y' as pass", async () => {
    const r = await gradeRubric({
      apiKey: "test",
      tutorResponse: "{}",
      rubricQuestion: "?",
      fetchImpl: mockOk("Y"),
    });
    expect(r.pass).toBe(true);
    expect(r.raw).toBe("Y");
  });

  it("treats 'N' as fail", async () => {
    let calls = 0;
    const r = await gradeRubric({
      apiKey: "test",
      tutorResponse: "{}",
      rubricQuestion: "?",
      fetchImpl: async () => {
        calls += 1;
        return mockOk("N")("", {
          method: "POST",
          headers: {},
          body: "",
        });
      },
    });
    expect(r.pass).toBe(false);
    expect(r.raw).toBe("N\nADJUDICATION:N");
    expect(calls).toBe(2);
  });

  it("uses a third vote only when an initial N and adjudication disagree", async () => {
    const votes = ["N", "Y", "Y"];
    const r = await gradeRubric({
      apiKey: "test",
      tutorResponse: "{}",
      rubricQuestion: "?",
      fetchImpl: async () => mockOk(votes.shift() ?? "N")("", {
        method: "POST",
        headers: {},
        body: "",
      }),
    });

    expect(r.pass).toBe(true);
    expect(r.raw).toBe("N\nADJUDICATION:Y\nTIEBREAK:Y");
    expect(votes).toHaveLength(0);
  });

  it("retains a majority N after a split adjudication", async () => {
    const votes = ["N", "Y", "N"];
    const r = await gradeRubric({
      apiKey: "test",
      tutorResponse: "{}",
      rubricQuestion: "?",
      fetchImpl: async () => mockOk(votes.shift() ?? "N")("", {
        method: "POST",
        headers: {},
        body: "",
      }),
    });

    expect(r.pass).toBe(false);
    expect(r.raw).toBe("N\nADJUDICATION:Y\nTIEBREAK:N");
  });

  it("tolerates leading whitespace", async () => {
    const r = await gradeRubric({
      apiKey: "test",
      tutorResponse: "{}",
      rubricQuestion: "?",
      fetchImpl: mockOk(" Y\n"),
    });
    expect(r.pass).toBe(true);
  });

  it("tolerates trailing punctuation/newline", async () => {
    const r = await gradeRubric({
      apiKey: "test",
      tutorResponse: "{}",
      rubricQuestion: "?",
      fetchImpl: mockOk("Y.\n"),
    });
    expect(r.pass).toBe(true);
  });

  it("treats lowercase 'y' as pass (case-insensitive)", async () => {
    const r = await gradeRubric({
      apiKey: "test",
      tutorResponse: "{}",
      rubricQuestion: "?",
      fetchImpl: mockOk("y"),
    });
    expect(r.pass).toBe(true);
  });

  it("treats repeated empty/garbage responses as fail (defaults to N)", async () => {
    const r = await gradeRubric({
      apiKey: "test",
      tutorResponse: "{}",
      rubricQuestion: "?",
      fetchImpl: mockOk(""),
    });
    expect(r.pass).toBe(false);
  });

  it("retries an empty reasoning response once with more output room", async () => {
    const maxTokens: number[] = [];
    let calls = 0;
    const fetchImpl: JudgeFetcher = async (_url, init) => {
      calls += 1;
      maxTokens.push((JSON.parse(init.body) as { max_output_tokens: number }).max_output_tokens);
      return {
        ok: true,
        status: 200,
        json: async () => ({ output_text: calls === 1 ? "" : "Y" }),
        text: async () => "",
      };
    };
    const r = await gradeRubric({
      apiKey: "test",
      tutorResponse: "Useful answer",
      rubricQuestion: "Is it useful?",
      fetchImpl,
    });
    expect(r.pass).toBe(true);
    expect(calls).toBe(2);
    expect(maxTokens).toEqual([300, 600]);
  });

  it("treats anything other than Y as fail (e.g. 'maybe')", async () => {
    const r = await gradeRubric({
      apiKey: "test",
      tutorResponse: "{}",
      rubricQuestion: "?",
      fetchImpl: mockOk("maybe"),
    });
    expect(r.pass).toBe(false);
  });

  it("throws on HTTP failure with status + body excerpt", async () => {
    await expect(
      gradeRubric({
        apiKey: "bad",
        tutorResponse: "{}",
        rubricQuestion: "?",
        fetchImpl: mockFail(401, "Invalid API key"),
      }),
    ).rejects.toThrow(/Judge model HTTP 401/);
  });

  it("sends learner context to an independent configurable judge", async () => {
    let requestBody = "";
    const fetchImpl: JudgeFetcher = async (_url, init) => {
      requestBody = init.body;
      return {
        ok: true,
        status: 200,
        json: async () => ({ output_text: "Y" }),
        text: async () => "",
      };
    };
    await gradeRubric({
      apiKey: "test",
      tutorResponse: '{"diagnose":"Looks right"}',
      rubricQuestion: "The verdict matches the actual code.",
      evaluationContext: "QUESTION: Is this right?\nCODE:\nprint(name)",
      judgeModel: "independent-judge",
      fetchImpl,
    });
    const parsed = JSON.parse(requestBody) as {
      model: string;
      reasoning: { effort: string };
      instructions: string;
      input: Array<{ content: string }>;
      max_output_tokens: number;
    };
    expect(parsed.model).toBe("independent-judge");
    expect(parsed.reasoning.effort).toBe(DEFAULT_JUDGE_REASONING_EFFORT);
    expect(parsed.instructions).toContain("untrusted evidence");
    expect(parsed.instructions).toContain("Apply only the supplied RUBRIC QUESTION");
    expect(parsed.instructions).toContain("structured JSON");
    expect(parsed.instructions).toContain("prior conversation");
    expect(parsed.instructions).toContain("lastRun as the authority");
    expect(parsed.instructions).toContain("every explicit clause");
    expect(parsed.input[0]?.content).toContain("print(name)");
    expect(parsed.input[0]?.content).toContain("The verdict matches");
    expect(parsed.max_output_tokens).toBe(300);
  });

  it("calls the Responses API instead of legacy chat completions", async () => {
    let requestUrl = "";
    const fetchImpl: JudgeFetcher = async (url) => {
      requestUrl = url;
      return {
        ok: true,
        status: 200,
        json: async () => ({ output_text: "Y" }),
        text: async () => "",
      };
    };
    await gradeRubric({
      apiKey: "test",
      tutorResponse: "A useful explanation",
      rubricQuestion: "Is it useful?",
      fetchImpl,
    });
    expect(requestUrl).toBe("https://api.openai.com/v1/responses");
  });
});
