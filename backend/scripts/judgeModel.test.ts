import { describe, expect, it } from "vitest";
import { gradeRubric, type JudgeFetcher } from "./judgeModel.js";

function mockOk(content: string): JudgeFetcher {
  return async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content } }],
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
    const r = await gradeRubric({
      apiKey: "test",
      tutorResponse: "{}",
      rubricQuestion: "?",
      fetchImpl: mockOk("N"),
    });
    expect(r.pass).toBe(false);
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

  it("treats empty/garbage response as fail (defaults to N)", async () => {
    const r = await gradeRubric({
      apiKey: "test",
      tutorResponse: "{}",
      rubricQuestion: "?",
      fetchImpl: mockOk(""),
    });
    expect(r.pass).toBe(false);
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
        json: async () => ({ choices: [{ message: { content: "Y" } }] }),
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
      messages: Array<{ content: string }>;
    };
    expect(parsed.model).toBe("independent-judge");
    expect(parsed.messages[0]?.content).toContain("untrusted evidence");
    expect(parsed.messages[1]?.content).toContain("print(name)");
    expect(parsed.messages[1]?.content).toContain("The verdict matches");
  });
});
