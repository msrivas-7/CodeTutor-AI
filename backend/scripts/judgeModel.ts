// Phase A — A4 eval substrate: Y/N grader against gpt-4.1-mini.
//
// The judge model bypasses PLATFORM_ALLOWED_MODELS (which is locked to
// gpt-4.1-nano in production). Eval grading needs a stricter grader than
// the production tutor model — nano grading like-for-like inflates pass
// rates. gpt-4.1-mini at ~$0.0005 per grade × 30 prompts × 3 rubrics =
// ~$0.045 per full run. Bounded.
//
// API key sourced from OPENAI_EVAL_API_KEY (separate env var even if it
// happens to hold the same value as the platform key — the gate is the
// env name, so a misconfigured runner can't accidentally route through
// the production resolver).

const OPENAI_BASE = "https://api.openai.com/v1";
const JUDGE_MODEL = "gpt-4.1-mini";

export interface JudgeResult {
  pass: boolean;
  raw: string;
}

export interface JudgeFetcher {
  (
    url: string,
    init: { method: "POST"; headers: Record<string, string>; body: string },
  ): Promise<{
    ok: boolean;
    status: number;
    json(): Promise<unknown>;
    text(): Promise<string>;
  }>;
}

/**
 * Grade a tutor response against a single Y/N rubric question.
 * Returns pass=true iff the judge model's first non-whitespace token is "Y".
 *
 * `fetchImpl` defaults to global fetch; tests inject a stub.
 */
export async function gradeRubric(opts: {
  apiKey: string;
  tutorResponse: string;
  rubricQuestion: string;
  fetchImpl?: JudgeFetcher;
}): Promise<JudgeResult> {
  const fetchImpl: JudgeFetcher =
    opts.fetchImpl ??
    ((url, init) =>
      fetch(url, init).then((r) => ({
        ok: r.ok,
        status: r.status,
        json: () => r.json(),
        text: () => r.text(),
      })));

  const systemPrompt =
    "You are a strict grader for a coding-tutor evaluation suite. You will be given a tutor's response (JSON) and a rubric question. Answer with EXACTLY 'Y' or 'N' on a single line, no explanation, no other text.";
  const userPrompt = `TUTOR RESPONSE:\n${opts.tutorResponse}\n\nRUBRIC QUESTION:\n${opts.rubricQuestion}\n\nAnswer Y or N:`;

  const body = JSON.stringify({
    model: JUDGE_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    max_tokens: 4,
    temperature: 0,
  });

  const res = await fetchImpl(`${OPENAI_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.apiKey}`,
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Judge model HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const raw = data.choices?.[0]?.message?.content?.trim() ?? "";
  // First non-whitespace character determines pass/fail. Robust against
  // model variations like "Y." / "Y\n" / " Y".
  const firstChar = raw.replace(/^\s+/, "").charAt(0).toUpperCase();
  return { pass: firstChar === "Y", raw };
}
