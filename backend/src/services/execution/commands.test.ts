import { describe, it, expect } from "vitest";
import { LANGUAGES, commandFor, isLanguage, type Language } from "./commands.js";

describe("isLanguage", () => {
  it.each(LANGUAGES)("returns true for known language %j", (lang) => {
    expect(isLanguage(lang)).toBe(true);
  });

  it.each(["perl", "kotlin", "swift", "", "PYTHON", "C ", " python"])(
    "returns false for unknown value %j",
    (v) => {
      expect(isLanguage(v)).toBe(false);
    }
  );

  it.each([null, undefined, 42, {}, [], true])(
    "returns false for non-string value %j",
    (v) => {
      expect(isLanguage(v)).toBe(false);
    }
  );
});

describe("commandFor", () => {
  describe("python", () => {
    const cmd = commandFor("python");
    it("uses main.py as entrypoint and has no compile step", () => {
      expect(cmd.entrypoint).toBe("main.py");
      expect(cmd.compile).toBeNull();
    });
    it("runs via python3", () => {
      expect(cmd.run.shell).toBe("python3 main.py");
    });
  });

  describe("javascript", () => {
    const cmd = commandFor("javascript");
    it("uses main.js as entrypoint and has no compile step", () => {
      expect(cmd.entrypoint).toBe("main.js");
      expect(cmd.compile).toBeNull();
    });
    it("runs via node", () => {
      expect(cmd.run.shell).toBe("node main.js");
    });
  });

  describe("c", () => {
    const cmd = commandFor("c");
    it("uses main.c and compiles with gcc", () => {
      expect(cmd.entrypoint).toBe("main.c");
      expect(cmd.compile?.shell).toMatch(/^gcc /);
      expect(cmd.compile?.shell).toMatch(/\*\.c\b/);
    });
    it("runs the compiled binary at /tmp/out", () => {
      expect(cmd.run.shell).toBe("/tmp/out");
    });
    it("compile includes -Wall for warnings and -O0 for debuggability", () => {
      expect(cmd.compile?.shell).toMatch(/-Wall/);
      expect(cmd.compile?.shell).toMatch(/-O0/);
    });
  });

  describe("cpp", () => {
    const cmd = commandFor("cpp");
    it("uses main.cpp and compiles with g++", () => {
      expect(cmd.entrypoint).toBe("main.cpp");
      expect(cmd.compile?.shell).toMatch(/^g\+\+ /);
      expect(cmd.compile?.shell).toMatch(/\*\.cpp\b/);
    });
    it("compiles with c++17", () => {
      expect(cmd.compile?.shell).toMatch(/-std=c\+\+17/);
    });
    it("runs the compiled binary at /tmp/out", () => {
      expect(cmd.run.shell).toBe("/tmp/out");
    });
  });

  describe("java", () => {
    const cmd = commandFor("java");
    it("uses Main.java as entrypoint", () => {
      expect(cmd.entrypoint).toBe("Main.java");
    });
    it("compiles with javac over every .java file", () => {
      expect(cmd.compile?.shell).toBe("javac *.java");
    });
    it("runs the Main class", () => {
      expect(cmd.run.shell).toBe("java Main");
    });
  });

  describe("typescript", () => {
    const cmd = commandFor("typescript");
    it("uses main.ts as entrypoint and has no compile step", () => {
      expect(cmd.entrypoint).toBe("main.ts");
      expect(cmd.compile).toBeNull();
    });
    it("runs via tsx", () => {
      expect(cmd.run.shell).toBe("tsx main.ts");
    });
  });

  describe("go", () => {
    const cmd = commandFor("go");
    it("uses main.go and compiles every .go file", () => {
      expect(cmd.entrypoint).toBe("main.go");
      expect(cmd.compile?.shell).toMatch(/^go build /);
      expect(cmd.compile?.shell).toMatch(/\*\.go\b/);
    });
    it("runs the compiled binary at /tmp/out", () => {
      expect(cmd.run.shell).toBe("/tmp/out");
    });
  });

  describe("rust", () => {
    const cmd = commandFor("rust");
    it("uses main.rs and compiles with rustc", () => {
      expect(cmd.entrypoint).toBe("main.rs");
      expect(cmd.compile?.shell).toMatch(/^rustc /);
      expect(cmd.compile?.shell).toMatch(/main\.rs\b/);
    });
    it("compiles against the 2021 edition", () => {
      expect(cmd.compile?.shell).toMatch(/--edition=2021/);
    });
    it("runs the compiled binary at /tmp/out", () => {
      expect(cmd.run.shell).toBe("/tmp/out");
    });
  });

  describe("ruby", () => {
    const cmd = commandFor("ruby");
    it("uses main.rb and has no compile step", () => {
      expect(cmd.entrypoint).toBe("main.rb");
      expect(cmd.compile).toBeNull();
    });
    it("runs via ruby", () => {
      expect(cmd.run.shell).toBe("ruby main.rb");
    });
  });

  it("returns a non-null config for every Language in LANGUAGES", () => {
    for (const lang of LANGUAGES) {
      const cmd = commandFor(lang);
      expect(cmd.entrypoint).toBeTruthy();
      expect(cmd.run.shell).toBeTruthy();
      expect(cmd.run.label).toBe("run");
    }
  });

  it("marks compile-less languages correctly", () => {
    const compileless = LANGUAGES.filter((l) => commandFor(l).compile === null);
    expect(compileless.slice().sort()).toEqual(["javascript", "python", "ruby", "typescript"]);
  });

  it("marks compiled languages with a compile step labelled 'compile'", () => {
    const compiled = LANGUAGES.filter((l): l is Language => commandFor(l).compile !== null);
    expect(compiled.slice().sort()).toEqual(["c", "cpp", "go", "java", "rust"]);
    for (const lang of compiled) {
      expect(commandFor(lang).compile?.label).toBe("compile");
    }
  });
});
