import { describe, expect, it } from "vitest";
import type { RunResult } from "../../../types";
import { normalizeRunEvidence } from "./evidence";

const result = (stderr: string): RunResult => ({
  stdout: "",
  stderr,
  exitCode: 1,
  errorType: "compile",
  durationMs: 4,
  stage: "compile",
});

describe("normalizeRunEvidence", () => {
  it("allowlists Python's unclosed-parenthesis error and project location", () => {
    const evidence = normalizeRunEvidence(
      result(
        '  File "/workspace/main.py", line 7\n    print("Hello"\n         ^\nSyntaxError: \'(\' was never closed\n',
      ),
      ["main.py"],
    );

    expect(evidence).toEqual({
      code: "python-unclosed-parenthesis",
      key: "python-unclosed-parenthesis:main.py:7",
      path: "main.py",
      line: 7,
      label: "Syntax error",
    });
  });

  it("rejects arbitrary stderr, unknown files, and nearby syntax errors", () => {
    expect(normalizeRunEvidence(result("user supplied text"), ["main.py"])).toBeNull();
    expect(
      normalizeRunEvidence(
        result('File "/tmp/secret.py", line 1\nSyntaxError: \'(\' was never closed'),
        ["main.py"],
      ),
    ).toBeNull();
    expect(
      normalizeRunEvidence(
        result('File "/workspace/main.py", line 1\nSyntaxError: invalid syntax'),
        ["main.py"],
      ),
    ).toBeNull();
  });

  it("rejects runtime stderr even when learner output impersonates Python", () => {
    expect(normalizeRunEvidence({
      ...result('File "/workspace/main.py", line 1\nSyntaxError: \'(\' was never closed'),
      errorType: "runtime",
      stage: "run",
    }, ["main.py"])).toBeNull();
  });

  it("selects the most specific project path when basenames overlap", () => {
    const evidence = normalizeRunEvidence(
      result(
        'File "/workspace/examples/main.py", line 3\nSyntaxError: \'(\' was never closed',
      ),
      ["main.py", "examples/main.py"],
    );

    expect(evidence?.path).toBe("examples/main.py");
    expect(evidence?.key).toBe(
      "python-unclosed-parenthesis:examples/main.py:3",
    );
  });
});
