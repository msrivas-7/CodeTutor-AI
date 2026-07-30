// Phase A — A4: fabricated-API regex post-pass detector.
import { describe, expect, it } from "vitest";
import { detectSuspectApis } from "./suspectApi.js";

const noFiles: Array<{ path: string; content: string }> = [];

describe("detectSuspectApis — python", () => {
  it("passes a clean stdlib-only response", () => {
    const out = detectSuspectApis({
      responseText:
        'Try running `print(len(name))` — what does `name.upper()` give you?',
      userFiles: [{ path: "main.py", content: 'name = "Maya"\nprint(name)' }],
      userQuestion: "why is my name lowercase",
      language: "python",
    });
    expect(out).toEqual([]);
  });

  it("flags a fabricated function presented as code", () => {
    const out = detectSuspectApis({
      responseText:
        "You can use `python_autoformat(name)` to fix the casing.",
      userFiles: noFiles,
      userQuestion: "how do I fix casing",
      language: "python",
    });
    // snake_case heuristic skips multi-word names; use a single-word fake
    const out2 = detectSuspectApis({
      responseText: "Just call `stringify(name)` — Python does the rest.",
      userFiles: noFiles,
      userQuestion: "how do I fix casing",
      language: "python",
    });
    expect(out).toEqual([]); // snake_case → assumed learner-defined
    expect(out2).toEqual(["stringify"]);
  });

  it("allows symbols defined in the user's own files", () => {
    const out = detectSuspectApis({
      responseText: "What happens when you call `greet()` twice?",
      userFiles: [
        { path: "main.py", content: "def greet():\n    print('hi')" },
      ],
      userQuestion: "my function prints once",
      language: "python",
    });
    expect(out).toEqual([]);
  });

  it("allows symbols the learner named in their question", () => {
    const out = detectSuspectApis({
      responseText: "`fetchall()` runs the query — where do you call it?",
      userFiles: noFiles,
      userQuestion: "when should I use fetchall in sqlite",
      language: "python",
    });
    expect(out).toEqual([]);
  });

  it("scans fenced blocks as well as inline code", () => {
    const out = detectSuspectApis({
      responseText: "Here is the idea:\n```python\nresult = quickparse(data)\n```",
      userFiles: noFiles,
      userQuestion: "parse this",
      language: "python",
    });
    expect(out).toEqual(["quickparse"]);
  });

  it("ignores prose-only mentions (not formatted as code)", () => {
    const out = detectSuspectApis({
      responseText:
        "Some languages have a magicparse(x) helper but Python does not.",
      userFiles: noFiles,
      userQuestion: "parsing",
      language: "python",
    });
    expect(out).toEqual([]);
  });
});

describe("detectSuspectApis — javascript", () => {
  it("passes builtin/prototype methods", () => {
    const out = detectSuspectApis({
      responseText:
        "What does `items.map(x => x * 2)` return before you `console.log(result)`?",
      userFiles: [{ path: "index.js", content: "const items = [1,2,3];" }],
      userQuestion: "map is confusing",
      language: "javascript",
    });
    expect(out).toEqual([]);
  });

  it("flags a fabricated single-word global", () => {
    const out = detectSuspectApis({
      responseText: "Use `arrayify(items)` first.",
      userFiles: noFiles,
      userQuestion: "how do I loop",
      language: "javascript",
    });
    expect(out).toEqual(["arrayify"]);
  });

  it("skips camelCase names (assumed learner-defined)", () => {
    const out = detectSuspectApis({
      responseText: "Try writing a `sumTotals()` function yourself first.",
      userFiles: noFiles,
      userQuestion: "totals",
      language: "javascript",
    });
    expect(out).toEqual([]);
  });
});
