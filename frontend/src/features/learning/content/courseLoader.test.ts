import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LessonLoaderError,
  isCourseCompleted,
  listAllCourses,
  loadStarterFiles,
} from "./courseLoader";

// QA-M1 + QA-M2 coverage. Two behaviors are pinned here:
//
//   1. `LessonLoaderError` carries a `.kind` discriminant ("not_found" vs
//      "schema_error") + the Zod issue list, so the LessonPage route shell
//      can render "this lesson is malformed" copy instead of a generic 404.
//      A regression to a plain `Error` would silently collapse both branches.
//
//   2. `listAllCourses()` sorts by `course.displayOrder`, with missing values
//      last and ties broken by title. Before this, the dashboard order fell
//      out of `readdirSync` sort — which put `_internal-...` ahead of
//      learner-facing courses and broke onboarding expectations.
//
// `fetch` is stubbed so the test doesn't touch the real registry.

type FetchInit = { method?: string };
type FetchHandler = (url: string, init?: FetchInit) => Promise<Response>;

let fetchHandler: FetchHandler | null = null;

beforeEach(() => {
  fetchHandler = null;
  vi.stubGlobal("fetch", (url: string, init?: FetchInit) => {
    if (!fetchHandler) throw new Error(`No fetchHandler set for URL ${url}`);
    return fetchHandler(url, init);
  });
  // The module caches the registry at import time — reset between cases.
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function notFoundResponse(): Response {
  return new Response("not found", { status: 404 });
}

describe("LessonLoaderError", () => {
  it("surfaces the discriminated 'kind' so callers can branch on it", () => {
    const nf = new LessonLoaderError({ kind: "not_found", message: "no lesson" });
    expect(nf.kind).toBe("not_found");
    expect(nf.issues).toEqual([]);
    expect(nf.message).toBe("no lesson");
    expect(nf instanceof Error).toBe(true);
  });

  it("carries the Zod issue list on schema_error so DEV logs can surface it", () => {
    const se = new LessonLoaderError({
      kind: "schema_error",
      message: "bad meta",
      issues: ["order: too small", "language: invalid enum value"],
    });
    expect(se.kind).toBe("schema_error");
    expect(se.issues).toHaveLength(2);
    expect(se.issues[0]).toContain("order");
  });
});

describe("loadStarterFiles", () => {
  it("loads a single-file entrypoint without probing a missing index", async () => {
    const requested: string[] = [];
    fetchHandler = async (url) => {
      requested.push(url);
      return new Response('print("hello")\n', { status: 200 });
    };

    await expect(loadStarterFiles("course", "lesson", "python")).resolves.toEqual([
      { path: "main.py", content: 'print("hello")\n' },
    ]);
    expect(requested).toEqual([
      "/courses/course/lessons/lesson/starter/main.py",
    ]);
  });

  it("loads every metadata-declared file for a multi-file lesson", async () => {
    fetchHandler = async (url) =>
      new Response(url.endsWith("main.py") ? "import helper\n" : "VALUE = 1\n", {
        status: 200,
      });

    await expect(
      loadStarterFiles("course", "lesson", "python", ["main.py", "helper.py"]),
    ).resolves.toEqual([
      { path: "main.py", content: "import helper\n" },
      { path: "helper.py", content: "VALUE = 1\n" },
    ]);
  });
});

describe("listAllCourses — displayOrder sort", () => {
  it("sorts by displayOrder ascending; missing values go last, tie-break on title", async () => {
    const { listAllCourses: freshListAll } = await import("./courseLoader");
    fetchHandler = async (url) => {
      if (url.endsWith("/courses/registry.json")) {
        return jsonResponse({
          courses: [
            { id: "python-fundamentals" },
            { id: "javascript-fundamentals" },
            { id: "no-order-b" },
            { id: "no-order-a" },
          ],
        });
      }
      const match = url.match(/\/courses\/([^/]+)\/course\.json$/);
      if (!match) return notFoundResponse();
      const id = match[1];
      const fixtures: Record<string, Record<string, unknown>> = {
        "python-fundamentals": {
          id: "python-fundamentals",
          title: "Python Fundamentals",
          description: "py",
          language: "python",
          lessonOrder: ["a"],
          displayOrder: 1,
        },
        "javascript-fundamentals": {
          id: "javascript-fundamentals",
          title: "JavaScript Fundamentals",
          description: "js",
          language: "javascript",
          lessonOrder: ["a"],
          displayOrder: 2,
        },
        "no-order-b": {
          id: "no-order-b",
          title: "Z-last",
          description: "z",
          language: "python",
          lessonOrder: ["a"],
        },
        "no-order-a": {
          id: "no-order-a",
          title: "A-first",
          description: "a",
          language: "python",
          lessonOrder: ["a"],
        },
      };
      const fx = fixtures[id];
      if (!fx) return notFoundResponse();
      return jsonResponse(fx);
    };

    const got = await freshListAll();
    expect(got.map((c) => c.id)).toEqual([
      "python-fundamentals",      // displayOrder 1
      "javascript-fundamentals",  // displayOrder 2
      "no-order-a",               // no displayOrder, title "A-first" wins tie
      "no-order-b",               // no displayOrder, title "Z-last"
    ]);
  });

  it("returns [] — not a crash — when the registry fetch 404s", async () => {
    const { listAllCourses: freshListAll } = await import("./courseLoader");
    fetchHandler = async () => notFoundResponse();
    const got = await freshListAll();
    expect(got).toEqual([]);
  });

  it("swallows a single corrupt course — the rest still render on the dashboard", async () => {
    const { listAllCourses: freshListAll } = await import("./courseLoader");
    fetchHandler = async (url) => {
      if (url.endsWith("/courses/registry.json")) {
        return jsonResponse({
          courses: [{ id: "good" }, { id: "broken" }],
        });
      }
      if (url.includes("/good/course.json")) {
        return jsonResponse({
          id: "good",
          title: "Good",
          description: "g",
          language: "python",
          lessonOrder: ["a"],
          displayOrder: 1,
        });
      }
      if (url.includes("/broken/course.json")) {
        // Missing required fields — zod parse will throw, list should skip.
        return jsonResponse({ id: "broken" });
      }
      return notFoundResponse();
    };
    const got = await listAllCourses();
    expect(got.map((c) => c.id)).toEqual(["good"]);
  });
});

// Phase 22F2A — B6: course-completion helper used by the dashboard prereq
// gate. The dashboard checks "did the learner complete every lesson in this
// course?" before deciding whether to surface the soft-warning modal.
describe("isCourseCompleted", () => {
  it("returns true when every lesson in lessonOrder is completed", () => {
    expect(
      isCourseCompleted({ lessonOrder: ["a", "b", "c"] }, ["a", "b", "c"]),
    ).toBe(true);
  });

  it("returns true regardless of completed-set order or extras", () => {
    expect(
      isCourseCompleted({ lessonOrder: ["a", "b"] }, ["b", "ghost", "a"]),
    ).toBe(true);
  });

  it("returns false when any lesson is missing", () => {
    expect(
      isCourseCompleted({ lessonOrder: ["a", "b", "c"] }, ["a", "b"]),
    ).toBe(false);
  });

  it("returns false on an empty completed set when the course has lessons", () => {
    expect(isCourseCompleted({ lessonOrder: ["a"] }, [])).toBe(false);
  });

  it("returns false for an empty course (defensive — no completion claim)", () => {
    expect(isCourseCompleted({ lessonOrder: [] }, ["a", "b"])).toBe(false);
  });
});
