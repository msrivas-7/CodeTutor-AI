import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const readJson = (path: string) => JSON.parse(read(path)) as Record<string, unknown>;

describe("first two lessons — promise continuity contract", () => {
  it("starts with a learner-authored print string, then introduces variables", () => {
    const course = readJson("public/courses/python-fundamentals/course.json");
    expect(course.lessonOrder).toEqual(
      expect.arrayContaining(["hello-world", "variables"]),
    );
    expect((course.lessonOrder as string[]).slice(0, 2)).toEqual([
      "hello-world",
      "variables",
    ]);

    const helloStarter = read(
      "public/courses/python-fundamentals/lessons/hello-world/starter/main.py",
    );
    expect(helloStarter.split("\n").every((line) => !line.trim() || line.trim().startsWith("#"))).toBe(true);
    expect(helloStarter).toContain('print("Hello, Maya!")');

    const helloContent = read(
      "public/courses/python-fundamentals/lessons/hello-world/content.md",
    );
    expect(helloContent).toContain('print("Hello, Maya!")');
    expect(helloContent).toMatch(/use \*\*your own name\*\*/i);

    const variablesContent = read(
      "public/courses/python-fundamentals/lessons/variables/content.md",
    );
    expect(variablesContent).toMatch(/In lesson 1 you wrote/);
    expect(variablesContent).toContain("hard-coded");
    expect(variablesContent).toContain("name = \"Alice\"");
  });

  it("keeps the cinematic example on lesson one's single-string print concept", () => {
    const cinematic = read("src/features/firstRun/CinematicGreeting.tsx");
    expect(cinematic).toContain(
      'const exampleName = explicitExampleName?.trim() || firstName.trim() || "there";',
    );
    expect(cinematic).toContain(
      "const codeLine = `>>> print(${JSON.stringify(`Hello, ${exampleName}!`)})`;",
    );
    expect(cinematic).toContain("Example code · {exampleName}");
    expect(cinematic).not.toContain('name = "Maya"\\nprint("Hello, " + name + "!")');
  });
});
