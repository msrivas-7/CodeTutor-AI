import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  MarkdownContent,
  readFencedCodeBlock,
  readOrderedListBlock,
  renderInline,
} from "./LessonInstructionsPanel";

describe("MarkdownContent", () => {
  it("renders GFM tables, emphasis, inline code, and fenced code without raw markers", () => {
    const markdown = [
      "| mode | meaning |",
      "| --- | --- |",
      "| `r` | *read* |",
      "",
      "Use **one** context manager.",
      "",
      "```python",
      'with open("x") as file:',
      "    pass",
      "```",
    ].join("\n");
    const html = renderToStaticMarkup(
      React.createElement(MarkdownContent, { text: markdown }),
    );
    expect(html).toContain("<table");
    expect(html).toContain("<em");
    expect(html).toContain("<strong");
    expect(html).toContain("<pre");
    expect(html).not.toContain("| --- | --- |");
    expect(html).not.toContain("**one**");
    expect(html).not.toContain("```python");
  });

  it("renders objective inline code without literal backticks", () => {
    const html = renderToStaticMarkup(
      React.createElement("span", null, renderInline("Wire it inside `main()`.", "chip")),
    );
    expect(html).toContain("<code");
    expect(html).toContain("main()");
    expect(html).not.toContain("`main()`");
  });
});

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
