export type Language =
  | "python"
  | "javascript"
  | "typescript"
  | "c"
  | "cpp"
  | "java"
  | "go"
  | "rust"
  | "ruby";

export interface LanguageCommand {
  entrypoint: string;
  compile: { label: string; shell: string } | null;
  run: { label: string; shell: string };
}

export const LANGUAGES: readonly Language[] = [
  "python",
  "javascript",
  "typescript",
  "c",
  "cpp",
  "java",
  "go",
  "rust",
  "ruby",
] as const;

export function isLanguage(x: unknown): x is Language {
  return typeof x === "string" && (LANGUAGES as readonly string[]).includes(x);
}

export function commandFor(language: Language): LanguageCommand {
  switch (language) {
    case "python":
      return {
        entrypoint: "main.py",
        compile: null,
        run: { label: "run", shell: "python3 main.py" },
      };
    case "javascript":
      return {
        entrypoint: "main.js",
        compile: null,
        run: { label: "run", shell: "node main.js" },
      };
    case "c":
      return {
        entrypoint: "main.c",
        compile: { label: "compile", shell: "gcc -O0 -Wall -o /tmp/out *.c" },
        run: { label: "run", shell: "/tmp/out" },
      };
    case "cpp":
      return {
        entrypoint: "main.cpp",
        compile: {
          label: "compile",
          shell: "g++ -std=c++17 -O0 -Wall -o /tmp/out *.cpp",
        },
        run: { label: "run", shell: "/tmp/out" },
      };
    case "java":
      return {
        entrypoint: "Main.java",
        compile: { label: "compile", shell: "javac *.java" },
        run: { label: "run", shell: "java Main" },
      };
    case "typescript":
      return {
        entrypoint: "main.ts",
        compile: null,
        run: { label: "run", shell: "tsx main.ts" },
      };
    case "go":
      return {
        entrypoint: "main.go",
        compile: { label: "compile", shell: "go build -o /tmp/out *.go" },
        run: { label: "run", shell: "/tmp/out" },
      };
    case "rust":
      return {
        entrypoint: "main.rs",
        compile: {
          label: "compile",
          shell: "rustc --edition=2021 -O -o /tmp/out main.rs",
        },
        run: { label: "run", shell: "/tmp/out" },
      };
    case "ruby":
      return {
        entrypoint: "main.rb",
        compile: null,
        run: { label: "run", shell: "ruby main.rb" },
      };
  }
}
