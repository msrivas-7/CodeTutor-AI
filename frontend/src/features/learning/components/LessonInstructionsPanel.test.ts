import { describe, expect, it } from "vitest";
import { readFencedCodeBlock } from "./LessonInstructionsPanel";

describe("readFencedCodeBlock", () => {
  it("renders a list-indented fenced example without exposing its delimiters", () => {
    const lines = [
      "1. Type this:",
      "",
      "   ```python",
      '   print("Hello, Maya!")',
      "   ```",
    ];

    expect(readFencedCodeBlock(lines, 2)).toEqual({
      code: 'print("Hello, Maya!")',
      endIndex: 4,
    });
  });

  it("continues to support unindented fences", () => {
    const lines = ["```js", "console.log('hello')", "```"];
    expect(readFencedCodeBlock(lines, 0)).toEqual({
      code: "console.log('hello')",
      endIndex: 2,
    });
  });

  it("does not treat inline backticks or four-space code as a fence", () => {
    expect(readFencedCodeBlock(["Use `print()` here"], 0)).toBeNull();
    expect(readFencedCodeBlock(["    ```python"], 0)).toBeNull();
  });
});
