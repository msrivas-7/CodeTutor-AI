import { describe, expect, it } from "vitest";
import {
  readFencedCodeBlock,
  readOrderedListBlock,
} from "./LessonInstructionsPanel";

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

describe("readOrderedListBlock", () => {
  it("keeps fenced examples and later steps in one continuous list", () => {
    const lines = [
      "1. Type one line:",
      "",
      "   ```python",
      '   print("Hello, Maya!")',
      "   ```",
      "",
      "   Use your own name.",
      "",
      "2. Click Run.",
      "",
      "## Key concepts",
    ];

    expect(readOrderedListBlock(lines, 0)).toEqual({
      items: [
        {
          lead: "Type one line:",
          body: ["```python", 'print("Hello, Maya!")', "```", "", "Use your own name."],
        },
        { lead: "Click Run.", body: [] },
      ],
      endIndex: 9,
    });
  });
});
