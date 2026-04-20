import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock localStorage with iteration support (applyProfile's allOwnedKeys uses
// localStorage.key(i), so a real iterable backing is required).
const storage = new Map<string, string>();
const localStorageMock = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
  clear: () => storage.clear(),
  get length() {
    return storage.size;
  },
  key: (i: number): string | null => {
    const keys = Array.from(storage.keys());
    return keys[i] ?? null;
  },
};
vi.stubGlobal("localStorage", localStorageMock);

import { PROFILES, profileById } from "./profiles";
import {
  applyProfile,
  captureRealSnapshotOnce,
  currentSnapshotJson,
  disableDevMode,
  enableDevMode,
  exitProfile,
  isDevModeEnabled,
  pasteSnapshot,
  __testing__,
} from "./applyProfile";
import { pickShakyLessons } from "../features/learning/utils/mastery";
import type { LessonMeta, LessonProgress } from "../features/learning/types";

function reset() {
  storage.clear();
}

describe("PROFILES", () => {
  beforeEach(reset);

  it("has exactly 10 profiles with unique ids", () => {
    expect(PROFILES.length).toBe(10);
    const ids = PROFILES.map((p) => p.id);
    expect(new Set(ids).size).toBe(10);
  });

  it("has exactly one sandbox profile (frozen=false)", () => {
    const sandbox = PROFILES.filter((p) => !p.frozen);
    expect(sandbox.length).toBe(1);
    expect(sandbox[0].id).toBe("sandbox");
  });

  it("every profile has a non-empty label and description", () => {
    for (const p of PROFILES) {
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.description.length).toBeGreaterThan(0);
    }
  });

  it("seedStorage() keys are all owned (profile-managed) — no OpenAI/theme/UI leakage", () => {
    for (const p of PROFILES) {
      const seed = p.seedStorage();
      for (const k of Object.keys(seed)) {
        expect(
          __testing__.isOwnedKey(k),
          `profile ${p.id} seeds non-owned key: ${k}`,
        ).toBe(true);
      }
    }
  });

  it("seedStorage() values are valid JSON strings (except raw '1' flags)", () => {
    for (const p of PROFILES) {
      const seed = p.seedStorage();
      for (const [k, v] of Object.entries(seed)) {
        if (k.startsWith("onboarding:")) {
          // Flag keys: raw "1" is acceptable
          expect(v).toBe("1");
        } else {
          expect(() => JSON.parse(v), `${p.id} bad JSON for ${k}`).not.toThrow();
        }
      }
    }
  });
});

describe("profileById", () => {
  it("returns profile for known id", () => {
    expect(profileById("fresh-install")?.id).toBe("fresh-install");
    expect(profileById("sandbox")?.frozen).toBe(false);
  });

  it("returns null for unknown id", () => {
    expect(profileById("does-not-exist")).toBeNull();
  });
});

describe("needs-help-dashboard profile", () => {
  beforeEach(reset);

  function metaFor(lessonId: string, order: number, estimatedMinutes = 15): LessonMeta {
    return {
      id: lessonId,
      courseId: "python-fundamentals",
      title: lessonId,
      description: "",
      order,
      language: "python",
      estimatedMinutes,
      objectives: [],
      teachesConceptTags: [],
      usesConceptTags: [],
      completionRules: [],
      prerequisiteLessonIds: [],
    };
  }

  it("produces exactly 3 shaky Python lessons via pickShakyLessons", () => {
    const profile = profileById("needs-help-dashboard")!;
    const seed = profile.seedStorage();

    // Parse only Python lesson progress — the profile also seeds two clean JS
    // lessons to populate the multi-course dashboard, but the review card is
    // per-course and this test covers the Python side.
    const lessonProgress: LessonProgress[] = [];
    for (const [k, v] of Object.entries(seed)) {
      if (!k.startsWith("learner:v1:lesson:python-fundamentals:")) continue;
      lessonProgress.push(JSON.parse(v) as LessonProgress);
    }

    const metasById: Record<string, LessonMeta> = {
      "hello-world": metaFor("hello-world", 1, 10),
      variables: metaFor("variables", 2, 15),
      "input-output": metaFor("input-output", 3, 15),
      conditionals: metaFor("conditionals", 4, 20),
      loops: metaFor("loops", 5, 20),
    };

    const shaky = pickShakyLessons(lessonProgress, metasById, 3);
    expect(shaky.length).toBe(3);
    const shakyIds = shaky.map((s) => s.lessonId).sort();
    expect(shakyIds).toEqual(["hello-world", "input-output", "variables"]);
  });
});

describe("capstone-first-fail profile", () => {
  it("seeds broken capstone-word-frequency code", () => {
    const profile = profileById("capstone-first-fail")!;
    const seed = profile.seedStorage();
    const capstoneKey = "learner:v1:lesson:python-fundamentals:capstone-word-frequency";
    const lp = JSON.parse(seed[capstoneKey]) as LessonProgress;
    expect(lp.status).toBe("in_progress");
    const code = lp.lastCode?.["main.py"] ?? "";
    // The broken code must contain tokenize (correct) + count_words bug marker.
    expect(code).toContain("def tokenize");
    expect(code).toContain("def count_words");
    expect(code).toContain("list of tuples");
  });
});

describe("applyProfile — allow-list preservation", () => {
  beforeEach(reset);

  it("does not wipe OpenAI keys, theme, or UI size prefs when applying any frozen profile", () => {
    // Simulate a dev's real preserved state.
    const preserved: Record<string, string> = {
      "codetutor:openai-key": "sk-secret-key-do-not-touch",
      "codetutor:openai-model": "gpt-5",
      "ui:theme-pref": "dark",
      "ui:tutorCollapsed": "1",
      "ui:lesson:instrW": "380",
    };
    for (const [k, v] of Object.entries(preserved)) storage.set(k, v);

    for (const p of PROFILES.filter((x) => x.frozen)) {
      applyProfile(p);
      for (const [k, v] of Object.entries(preserved)) {
        expect(
          storage.get(k),
          `profile ${p.id} clobbered preserved key ${k}`,
        ).toBe(v);
      }
    }
  });
});

describe("real-snapshot round trip", () => {
  beforeEach(reset);

  it("captures → applies profile → exits → restores original owned state", () => {
    // Seed real-user state.
    const original: Record<string, string> = {
      "learner:v1:identity": JSON.stringify({ learnerId: "real-u", createdAt: "x", isAnonymous: true }),
      "learner:v1:progress:python-fundamentals": JSON.stringify({
        learnerId: "real-u",
        courseId: "python-fundamentals",
        status: "in_progress",
        startedAt: null,
        updatedAt: "y",
        completedAt: null,
        lastLessonId: "loops",
        completedLessonIds: ["hello-world"],
      }),
      // Non-owned key that must survive regardless.
      "codetutor:openai-key": "sk-keep-me",
    };
    for (const [k, v] of Object.entries(original)) storage.set(k, v);

    enableDevMode();
    captureRealSnapshotOnce();
    expect(isDevModeEnabled()).toBe(true);

    const profile = profileById("all-complete")!;
    applyProfile(profile);

    // After apply, identity has changed to the seeded one.
    const identityAfterApply = storage.get("learner:v1:identity");
    expect(identityAfterApply).not.toBe(original["learner:v1:identity"]);

    // Non-owned keys preserved through apply.
    expect(storage.get("codetutor:openai-key")).toBe("sk-keep-me");

    exitProfile();

    // Owned state restored to original.
    expect(storage.get("learner:v1:identity")).toBe(original["learner:v1:identity"]);
    expect(storage.get("learner:v1:progress:python-fundamentals")).toBe(
      original["learner:v1:progress:python-fundamentals"],
    );
    expect(storage.get("codetutor:openai-key")).toBe("sk-keep-me");

    disableDevMode();
    expect(isDevModeEnabled()).toBe(false);
  });
});

describe("pasteSnapshot security", () => {
  beforeEach(reset);

  it("rejects snapshots containing non-owned keys", () => {
    const bad = JSON.stringify({
      "learner:v1:identity": "ok",
      "codetutor:openai-key": "malicious-overwrite",
    });
    expect(() => pasteSnapshot(bad)).toThrow(/non-owned/);
  });

  it("accepts snapshots with only owned keys", () => {
    storage.set("codetutor:openai-key", "sk-preserved");
    const ok = JSON.stringify({
      "learner:v1:identity": JSON.stringify({ learnerId: "pasted", createdAt: "z", isAnonymous: true }),
    });
    expect(() => pasteSnapshot(ok)).not.toThrow();
    expect(storage.get("codetutor:openai-key")).toBe("sk-preserved");
    expect(storage.has("learner:v1:identity")).toBe(true);
  });

  it("rejects invalid JSON", () => {
    expect(() => pasteSnapshot("{not json")).toThrow(/invalid JSON/);
  });

  it("rejects non-object payloads", () => {
    expect(() => pasteSnapshot("[]")).toThrow(/invalid JSON/);
    expect(() => pasteSnapshot('"string"')).toThrow(/invalid JSON/);
  });
});

describe("currentSnapshotJson", () => {
  beforeEach(reset);

  it("returns only owned keys, excluding preserved config", () => {
    storage.set("codetutor:openai-key", "sk-hidden");
    storage.set("ui:theme-pref", "dark");
    storage.set("learner:v1:identity", JSON.stringify({ a: 1 }));

    const snap = JSON.parse(currentSnapshotJson()) as Record<string, string>;
    expect(Object.keys(snap)).toEqual(["learner:v1:identity"]);
  });
});
