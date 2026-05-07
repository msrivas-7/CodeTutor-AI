import { describe, it, expect } from "vitest";
import { extractNameFromCode } from "./anonStash";

describe("extractNameFromCode", () => {
  // Phase A — A1 starter shape: the empty-shell starter pushes the
  // learner directly to a `print("Hello, X!")` line — no intermediate
  // variable. The praise turn personalization depends on this parser
  // returning the typed name on the new starter shape.
  describe("print() shape (Phase A starter)", () => {
    it("extracts a name from print(\"Hello, Maya!\")", () => {
      expect(extractNameFromCode('print("Hello, Maya!")')).toBe("Maya");
    });

    it("extracts a name from single-quote print('Hello, Alice!')", () => {
      expect(extractNameFromCode("print('Hello, Alice!')")).toBe("Alice");
    });

    it("tolerates whitespace inside print( ... )", () => {
      expect(extractNameFromCode('print(  "Hello, Sam!"  )')).toBe("Sam");
    });

    it("tolerates extra space after the comma", () => {
      expect(extractNameFromCode('print("Hello,   Sam!")')).toBe("Sam");
    });

    it("returns null when the example name 'World' is used (forbidden_in_stdout)", () => {
      // Lesson 1 forbids the literal "Hello, World!" — extracting
      // "World" as the learner's actual name would mislead the
      // praise turn into "Perfect, World".
      expect(extractNameFromCode('print("Hello, World!")')).toBeNull();
    });

    it("treats 'Maya' as a real name (the starter comment shows it as an example, but Maya is also a real name)", () => {
      // Trade-off: a learner who copies the example verbatim gets
      // personalized "Perfect, Maya". A learner whose actual name IS
      // Maya gets the same beat. We pick the latter — the false-
      // positive on copy-the-example is benign; the false-negative on
      // a real Maya would feel cold.
      expect(extractNameFromCode('print("Hello, Maya!")')).toBe("Maya");
    });

    it("ignores the starter's commented example", () => {
      const code = `# Type a print() line below — for example:
#     print("Hello, Maya!")
print("Hello, Priya!")
`;
      expect(extractNameFromCode(code)).toBe("Priya");
    });

    it("returns null when there's no print() at all", () => {
      expect(extractNameFromCode("# nothing yet\n")).toBeNull();
    });

    it("ignores print() calls that don't follow the Hello pattern", () => {
      expect(extractNameFromCode('print("hi")')).toBeNull();
      expect(extractNameFromCode('print("Hello world")')).toBeNull();
    });

    it("caps the captured name at 40 chars (matches the lesson's name input limit)", () => {
      const longName = "X".repeat(60);
      expect(
        extractNameFromCode(`print("Hello, ${longName}!")`),
      ).toBeNull();
    });
  });

  describe("name = \"…\" shape (legacy / variable lessons)", () => {
    it("extracts from a top-level assignment", () => {
      expect(extractNameFromCode('name = "Maya"\n')).toBe("Maya");
    });

    it("returns null when the placeholder YOUR_NAME is still there", () => {
      expect(extractNameFromCode('name = "YOUR_NAME"\n')).toBeNull();
    });

    it("is used as a fallback when no print() match exists", () => {
      const code = `name = "Priya"
print("Hi", name)
`;
      // print() doesn't match the Hello, X! pattern; falls back to name=
      expect(extractNameFromCode(code)).toBe("Priya");
    });
  });

  describe("priority", () => {
    it("prefers the print() shape over the name = shape", () => {
      // If both patterns are present and disagree, the print() shape
      // wins because that's what the learner just typed and ran.
      const code = `name = "Old"
print("Hello, New!")
`;
      expect(extractNameFromCode(code)).toBe("New");
    });
  });
});
