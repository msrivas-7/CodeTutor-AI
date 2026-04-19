// AI streaming mocks for /api/ai/ask/stream. The real backend writes raw SSE
// frames in the shape:
//
//     data: {"delta":"some text"}\n\n
//     data: {"delta":"more text"}\n\n
//     data: {"done":true,"raw":"<full json>","sections":{...},"usage":{...}}\n\n
//
// Errors come through as `data: {"error":"message"}\n\n`. There are no named
// SSE `event:` lines — `api/client.ts:askAIStream` only parses `data:` blocks
// and discriminates on the JSON payload shape. These mocks mirror that wire
// format exactly so the client-side streaming parser exercises the same code
// paths it would in production.
//
// Pair with page.route() to intercept before the call leaves the browser; tests
// can then assert on rendered sections/hint-ladder/error banners without ever
// touching OpenAI.
//
// Why no `event: done` lines? The backend doesn't send them. Adding them here
// would mean the tests accidentally cover a format the real server doesn't
// produce. Keep the mock tight to reality.

import type { Page, Route } from "@playwright/test";

export type TutorSections = {
  intent?: "debug" | "concept" | "howto" | "walkthrough" | "checkin";
  summary?: string | null;
  diagnose?: string | null;
  explain?: string | null;
  example?: string | null;
  walkthrough?: Array<{ body: string; path: string | null; line: number | null }> | null;
  checkQuestions?: string[] | null;
  hint?: string | null;
  nextStep?: string | null;
  strongerHint?: string | null;
  pitfalls?: string | null;
  citations?: Array<{ path: string; line: number; column: number | null; reason: string }> | null;
  comprehensionCheck?: string | null;
  stuckness?: "low" | "medium" | "high" | null;
};

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
};

type StreamFrame =
  | { delta: string }
  | { done: true; raw: string; sections: TutorSections; usage?: TokenUsage }
  | { error: string };

export type AIScenario =
  | "first-turn-concept"
  | "debug-walkthrough"
  | "stuck-with-action-chips"
  | "hint-level-1"
  | "hint-level-2"
  | "hint-level-3"
  | "error-500"
  | "invalid-key"
  | "rate-limit"
  | "lesson-explain";

function framesFor(scenario: AIScenario): StreamFrame[] {
  switch (scenario) {
    case "first-turn-concept": {
      const sections: TutorSections = {
        intent: "concept",
        summary: "A function groups reusable steps under a name.",
        explain:
          "Functions let you bundle code so you can call it many times without retyping it. In Python, you declare one with `def name(args):` and call it with `name(...)`.",
        example: "def greet(name):\n    return 'hi ' + name",
        pitfalls: "Remember to `return` — a bare `print` inside won't hand the value back to the caller.",
        nextStep: "Try writing a function that takes two numbers and returns their sum.",
        citations: null,
        hint: null,
        strongerHint: null,
        walkthrough: null,
        checkQuestions: null,
        comprehensionCheck: "What's the difference between `return` and `print`?",
        stuckness: "low",
        diagnose: null,
      };
      return [
        { delta: "A function " },
        { delta: "groups reusable steps " },
        { delta: "under a name.\n\n" },
        { delta: "Functions let you bundle code..." },
        {
          done: true,
          raw: JSON.stringify(sections),
          sections,
          usage: { inputTokens: 420, outputTokens: 96 },
        },
      ];
    }
    case "debug-walkthrough": {
      const sections: TutorSections = {
        intent: "debug",
        summary: "The loop runs one iteration short because the range stops before the last index.",
        diagnose:
          "`range(len(items) - 1)` iterates from 0 to len-2, so the final element is never seen. That matches the stdout you showed.",
        hint: "What happens if you replace `range(len(items) - 1)` with `range(len(items))`?",
        strongerHint:
          "You're building an off-by-one by subtracting 1 from the range — drop the `- 1` and the loop will cover every index.",
        nextStep: "Edit line 4 of main.py and rerun.",
        citations: [{ path: "main.py", line: 4, column: null, reason: "off-by-one in loop bound" }],
        pitfalls: null,
        walkthrough: null,
        checkQuestions: null,
        comprehensionCheck: null,
        explain: null,
        example: null,
        stuckness: "medium",
      };
      return [
        { delta: "Let's look at the loop. " },
        { delta: "`range(len(items) - 1)` stops one short..." },
        {
          done: true,
          raw: JSON.stringify(sections),
          sections,
          usage: { inputTokens: 612, outputTokens: 142 },
        },
      ];
    }
    case "stuck-with-action-chips": {
      const sections: TutorSections = {
        intent: "debug",
        summary: "You're close — one edit away from green.",
        diagnose: "The code returns None because the `return` is inside the `if`, not after it.",
        hint: "Does the return run for every input, or only some?",
        strongerHint: "Move `return total` out of the `if` block so every branch returns.",
        nextStep: "Unindent the final `return` by one level.",
        stuckness: "high",
        pitfalls: null,
        citations: [{ path: "main.py", line: 7, column: null, reason: "return lives inside the if" }],
        walkthrough: null,
        checkQuestions: null,
        comprehensionCheck: null,
        explain: null,
        example: null,
      };
      return [
        { delta: "You're close. " },
        { delta: "The return is inside the if..." },
        {
          done: true,
          raw: JSON.stringify(sections),
          sections,
          usage: { inputTokens: 480, outputTokens: 88 },
        },
      ];
    }
    case "hint-level-1": {
      const sections: TutorSections = {
        intent: "debug",
        summary: "Small nudge.",
        hint: "Look at the loop variable — is it changing the way you expect on every pass?",
        nextStep: "Print the loop variable on each pass to see what's happening.",
        strongerHint: null,
        stuckness: "low",
        diagnose: null,
        pitfalls: null,
        citations: null,
        walkthrough: null,
        checkQuestions: null,
        comprehensionCheck: null,
        explain: null,
        example: null,
      };
      return [
        { delta: "Small nudge. " },
        { done: true, raw: JSON.stringify(sections), sections },
      ];
    }
    case "hint-level-2": {
      const sections: TutorSections = {
        intent: "debug",
        summary: "Stronger nudge.",
        hint: "The accumulator never resets between iterations.",
        strongerHint:
          "Your `total` variable is declared inside the function but updated with `+=` before being initialized per-call.",
        nextStep: "Initialize `total = 0` at the top of the function body.",
        stuckness: "medium",
        diagnose: null,
        pitfalls: null,
        citations: null,
        walkthrough: null,
        checkQuestions: null,
        comprehensionCheck: null,
        explain: null,
        example: null,
      };
      return [
        { delta: "Stronger nudge. " },
        { done: true, raw: JSON.stringify(sections), sections },
      ];
    }
    case "hint-level-3": {
      const sections: TutorSections = {
        intent: "debug",
        summary: "Full approach.",
        hint: "Initialize, then accumulate, then return.",
        strongerHint: "Three steps: (1) total = 0 at the start, (2) total += x inside the loop, (3) return total at the end.",
        nextStep: "Apply all three steps in order.",
        example: "def sum_list(xs):\n    total = 0\n    for x in xs:\n        total += x\n    return total",
        stuckness: "high",
        diagnose: null,
        pitfalls: null,
        citations: null,
        walkthrough: null,
        checkQuestions: null,
        comprehensionCheck: null,
        explain: null,
      };
      return [
        { delta: "Full approach. " },
        { done: true, raw: JSON.stringify(sections), sections },
      ];
    }
    case "lesson-explain": {
      const sections: TutorSections = {
        intent: "concept",
        summary: "A variable is a name that points at a value.",
        explain: "In Python, `x = 5` stores the integer 5 under the name `x`. Later, `x` evaluates to 5 until reassigned.",
        example: "name = 'Ada'\nprint(name)  # -> Ada",
        pitfalls: "Names are case-sensitive: `Name` and `name` are different variables.",
        nextStep: "Try assigning two variables and printing their sum.",
        diagnose: null,
        hint: null,
        strongerHint: null,
        citations: null,
        walkthrough: null,
        checkQuestions: null,
        comprehensionCheck: null,
        stuckness: "low",
      };
      return [
        { delta: "A variable " },
        { delta: "is a name " },
        { delta: "that points at a value." },
        { done: true, raw: JSON.stringify(sections), sections },
      ];
    }
    case "error-500":
      return [{ error: "server overloaded — please retry" }];
    case "invalid-key":
      return [{ error: "Invalid API key. Check Settings and try again." }];
    case "rate-limit":
      return [{ error: "Rate limit exceeded. Wait 20s and retry." }];
  }
}

// Serialize a scenario into the SSE body string. Exported for tests that want
// to assert on the raw wire format.
export function sseBodyFor(scenario: AIScenario): string {
  return framesFor(scenario)
    .map((f) => `data: ${JSON.stringify(f)}\n\n`)
    .join("");
}

// Installs a route handler that replies to /api/ai/ask/stream with the given
// scenario's frames. Multiple scenarios can be queued by calling this in
// sequence — each call replaces the prior handler, so for the hint-ladder test
// we expose `mockTutorQueue` below that cycles through responses.
export async function mockTutorResponse(page: Page, scenario: AIScenario): Promise<void> {
  await page.route("**/api/ai/ask/stream", async (route: Route) => {
    await route.fulfill({
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
      },
      body: sseBodyFor(scenario),
    });
  });
}

// For multi-turn flows (e.g. hint ladder L1 → L2 → L3) we need to respond
// differently on each call. The queue is consumed in-order; once empty the
// final scenario replays.
export async function mockTutorQueue(page: Page, scenarios: AIScenario[]): Promise<void> {
  if (scenarios.length === 0) throw new Error("mockTutorQueue needs at least one scenario");
  let i = 0;
  await page.route("**/api/ai/ask/stream", async (route: Route) => {
    const scenario = scenarios[Math.min(i, scenarios.length - 1)];
    i++;
    await route.fulfill({
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
      },
      body: sseBodyFor(scenario),
    });
  });
}

// Mock the non-stream ask (used by `askAI` in older flows / summarize). Returns
// a JSON body shaped like the backend's non-stream response.
export async function mockAskJson(page: Page, sections: TutorSections, raw?: string): Promise<void> {
  await page.route("**/api/ai/ask", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ raw: raw ?? JSON.stringify(sections), sections }),
    });
  });
}

// Key-validation is called on first-entry of a new key in SettingsPanel. Mock
// returns `valid: true` so the tutor panel exits the setup-warning state.
export async function mockValidateKey(page: Page, valid = true, error?: string): Promise<void> {
  await page.route("**/api/ai/validate-key", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ valid, error }),
    });
  });
}

// Model list fetch happens when SettingsPanel mounts with a remembered key.
export async function mockListModels(page: Page): Promise<void> {
  await page.route("**/api/ai/models", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        models: [
          { id: "gpt-4o-mini", label: "GPT-4o mini", supportsStream: true },
          { id: "gpt-4o", label: "GPT-4o", supportsStream: true },
        ],
      }),
    });
  });
}

// Convenience: install all the common mocks at once. Use this in tests that
// exercise a UI surface where the AI panel is visible but the test isn't
// asserting on tutor behavior (e.g. editor-mode smoke).
export async function mockAllAI(page: Page, scenario: AIScenario = "first-turn-concept"): Promise<void> {
  await mockValidateKey(page, true);
  await mockListModels(page);
  await mockTutorResponse(page, scenario);
}

// A summarize mock for the chat-history compaction path.
export async function mockSummarize(page: Page, summary = "(prior turns summarized)"): Promise<void> {
  await page.route("**/api/ai/summarize", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ summary }),
    });
  });
}
