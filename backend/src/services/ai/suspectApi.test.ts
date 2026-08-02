import { afterEach, describe, expect, it, vi } from "vitest";
import { aiPlatformAbuseSignals } from "../metrics.js";
import {
  SUSPECT_API_DETECTOR_VERSION,
  detectSuspectApis,
  flagSuspectApis,
} from "./suspectApi.js";

const noFiles: Array<{ path: string; content: string }> = [];

afterEach(() => {
  vi.restoreAllMocks();
});

describe("detectSuspectApis — Python", () => {
  it("passes runtime calls and symbols from learner files", () => {
    expect(detectSuspectApis({
      responseText:
        'Try `print(len(name))` and compare it with `name.upper()` and `greet()`.',
      userFiles: [{
        path: "main.py",
        content: 'name = "Maya"\ndef greet():\n    print(name)',
      }],
      userQuestion: "why is my name lowercase",
      language: "python",
    })).toEqual([]);
  });

  it("flags snake_case and camelCase fabrications", () => {
    expect(detectSuspectApis({
      responseText: "Use `python_autoformat(name)` and then `formatName(name)`.",
      userFiles: noFiles,
      userQuestion: "how do I fix casing",
      language: "python",
    })).toEqual(["python_autoformat", "formatName"]);
  });

  it("does not trust a symbol merely because the learner asked about it", () => {
    expect(detectSuspectApis({
      responseText: "`fetchall()` runs the query for you.",
      userFiles: noFiles,
      userQuestion: "when should I use fetchall in sqlite",
      language: "python",
    })).toEqual(["fetchall"]);
  });

  it("allows a helper concretely defined in the same tutor snippet", () => {
    expect(detectSuspectApis({
      responseText:
        "```python\ndef get_total(values):\n    return sum(values)\n\nprint(get_total([1, 2]))\n```",
      userFiles: noFiles,
      userQuestion: "how could I organize this",
      language: "python",
    })).toEqual([]);
  });

  it("still scans dependencies used by a newly defined helper", () => {
    expect(detectSuspectApis({
      responseText:
        "```python\ndef get_total(values):\n    return magic_sum(values)\n\nget_total([1, 2])\n```",
      userFiles: noFiles,
      userQuestion: "how could I organize this",
      language: "python",
    })).toEqual(["magic_sum"]);
  });

  it("flags an invented receiver even when the method name is standard", () => {
    expect(detectSuspectApis({
      responseText: "Try `formatter.print(name)`.",
      userFiles: noFiles,
      userQuestion: "format this",
      language: "python",
    })).toEqual(["formatter"]);
  });

  it("scans fenced and inline code but ignores prose-only calls", () => {
    expect(detectSuspectApis({
      responseText:
        "Some tools mention magicparse(x), but Python does not.\n```python\nquickparse(data)\n``` Then `finishparse(data)`.",
      userFiles: noFiles,
      userQuestion: "parse this",
      language: "python",
    })).toEqual(["quickparse", "finishparse"]);
  });
});

describe("detectSuspectApis — JavaScript", () => {
  it("passes runtime/prototype methods and learner symbols", () => {
    expect(detectSuspectApis({
      responseText:
        "What does `items.map(x => x * 2)` return before `console.log(result)`?",
      userFiles: [{
        path: "index.js",
        content: "const items = [1, 2, 3]; const result = [];",
      }],
      userQuestion: "map is confusing",
      language: "javascript",
    })).toEqual([]);
  });

  it("flags fabricated globals regardless of identifier style", () => {
    expect(detectSuspectApis({
      responseText: "Use `arrayify(items)` and then `sumTotals(items)`.",
      userFiles: noFiles,
      userQuestion: "how do I loop",
      language: "javascript",
    })).toEqual(["arrayify", "sumTotals"]);
  });

  it("allows same-snippet function, class, and variable declarations", () => {
    expect(detectSuspectApis({
      responseText:
        "```javascript\nfunction double(value) { return value * 2; }\nclass Box {}\nconst values = [1, 2];\nconsole.log(values.map(double));\nnew Box();\n```",
      userFiles: noFiles,
      userQuestion: "show the pieces",
      language: "javascript",
    })).toEqual([]);
  });

  it("allows a method concretely defined in the same tutor snippet", () => {
    expect(detectSuspectApis({
      responseText:
        "```javascript\nclass Box {\n  open() { return true; }\n}\nconst box = new Box();\nconsole.log(box.open());\n```",
      userFiles: noFiles,
      userQuestion: "how do class methods work",
      language: "javascript",
    })).toEqual([]);
  });

  it("flags an invented receiver with a familiar prototype method", () => {
    expect(detectSuspectApis({
      responseText: "Call `collection.map(double)`.",
      userFiles: [{ path: "index.js", content: "function double(x) { return x * 2; }" }],
      userQuestion: "map these",
      language: "javascript",
    })).toEqual(["collection"]);
  });

  it("does not flag a fabricated method that the tutor explicitly rejects", () => {
    expect(detectSuspectApis({
      responseText:
        "In JavaScript, arrays do not have a `printAll()` method. Use `items.forEach(console.log)` instead.",
      userFiles: [{ path: "index.js", content: "const items = [1, 2];" }],
      userQuestion: "can I call printAll?",
      language: "javascript",
    })).toEqual([]);
  });

  it("accepts truthful built-in rejection phrasing from the tutor", () => {
    expect(detectSuspectApis({
      responseText:
        "In JavaScript, `printAll()` is not a built-in array method. Remember that `printAll()` is not a built-in method.",
      userFiles: [{ path: "index.js", content: "const values = [1, 2, 3];" }],
      userQuestion: "Is array.printAll() how I show each value?",
      language: "javascript",
    })).toEqual([]);
  });

  it("still flags a fabricated method when another sentence endorses it", () => {
    expect(detectSuspectApis({
      responseText:
        "Arrays do not have a `printAll()` method. Call `items.printAll()` anyway.",
      userFiles: [{ path: "index.js", content: "const items = [1, 2];" }],
      userQuestion: "can I call printAll?",
      language: "javascript",
    })).toEqual(["printAll"]);
  });
});

describe("flagSuspectApis", () => {
  it("emits bounded, versioned telemetry without logging learner code", () => {
    const increment = vi.spyOn(aiPlatformAbuseSignals, "inc").mockImplementation(() => undefined);
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const learnerCode = "const privateValue = 'do-not-log';";

    expect(() => flagSuspectApis({
      responseText: "Try `fabricatedOne()` and `fabricatedTwo()`.",
      userFiles: [{ path: "index.js", content: learnerCode }],
      userQuestion: "help",
      language: "javascript",
      route: "ask_stream",
    })).not.toThrow();

    expect(increment).toHaveBeenCalledWith({ signal: "tutor_suspect_api" });
    const event = JSON.parse(String(warning.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(event).toMatchObject({
      evt: "tutor_suspect_api",
      detectorVersion: SUSPECT_API_DETECTOR_VERSION,
      route: "ask_stream",
      language: "javascript",
      symbolCount: 2,
      symbols: ["fabricatedOne", "fabricatedTwo"],
    });
    expect(JSON.stringify(event)).not.toContain(learnerCode);
  });

  it("remains silent for a clean response", () => {
    const increment = vi.spyOn(aiPlatformAbuseSignals, "inc").mockImplementation(() => undefined);
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    flagSuspectApis({
      responseText: "Try `console.log(items.length)`.",
      userFiles: [{ path: "index.js", content: "const items = [];" }],
      userQuestion: "length?",
      language: "javascript",
      route: "ask",
    });

    expect(increment).not.toHaveBeenCalled();
    expect(warning).not.toHaveBeenCalled();
  });
});
