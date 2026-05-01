// Phase 20-P3 Bucket 3 (#2): unit tests for the row parsers that sit at the
// DB boundary. These exercise the Zod schemas directly (no Postgres needed)
// so we catch shape drift without paying the cost of an integration test.
//
// The schemas are the same ones the rowToX helpers use — a bad migration
// that writes e.g. status='done' on course_progress will fail these specs
// and surface as `HttpError(500, "corrupt course_progress row: ...")` in
// production instead of silently mis-rendering prompts/dashboards.

import { describe, expect, it } from "vitest";
import { CourseRowSchema } from "./courseProgress.js";
import { LessonRowSchema } from "./lessonProgress.js";
import { PrefsRowSchema } from "./preferences.js";
import { ProjectRowSchema } from "./editorProject.js";

describe("DB row parsers", () => {
  describe("CourseRowSchema", () => {
    const wellFormed = {
      course_id: "python",
      status: "in_progress",
      started_at: new Date(),
      completed_at: null,
      updated_at: new Date(),
      last_lesson_id: "lesson-3",
      completed_lesson_ids: ["lesson-1", "lesson-2"],
    };

    it("accepts a well-formed row", () => {
      expect(CourseRowSchema.safeParse(wellFormed).success).toBe(true);
    });

    it("rejects a row with an unknown status", () => {
      const r = CourseRowSchema.safeParse({ ...wellFormed, status: "done" });
      expect(r.success).toBe(false);
    });

    it("rejects a row with a non-date updated_at", () => {
      const r = CourseRowSchema.safeParse({
        ...wellFormed,
        updated_at: "2026-04-21T00:00:00Z",
      });
      expect(r.success).toBe(false);
    });

    it("accepts null completed_lesson_ids (new row)", () => {
      expect(
        CourseRowSchema.safeParse({ ...wellFormed, completed_lesson_ids: null }).success,
      ).toBe(true);
    });
  });

  describe("LessonRowSchema", () => {
    const wellFormed = {
      course_id: "python",
      lesson_id: "lesson-1",
      status: "completed",
      started_at: new Date(),
      completed_at: new Date(),
      updated_at: new Date(),
      attempt_count: 3,
      run_count: 7,
      hint_count: 1,
      time_spent_ms: "12345",
      last_code: { "main.py": "print('hi')" },
      last_output: "hi\n",
      practice_completed_ids: ["ex-1"],
      practice_exercise_code: { "ex-1": { "main.py": "print('hi')" } },
    };

    it("accepts a well-formed row", () => {
      expect(LessonRowSchema.safeParse(wellFormed).success).toBe(true);
    });

    it("accepts string-typed numeric counters (pg bigint)", () => {
      expect(
        LessonRowSchema.safeParse({ ...wellFormed, time_spent_ms: "99999" }).success,
      ).toBe(true);
    });

    it("rejects a row with a stray status", () => {
      const r = LessonRowSchema.safeParse({ ...wellFormed, status: "paused" });
      expect(r.success).toBe(false);
    });
  });

  describe("PrefsRowSchema", () => {
    const wellFormed = {
      persona: "intermediate",
      openai_model: "gpt-4o-mini",
      theme: "dark",
      welcome_done: true,
      workspace_coach_done: false,
      editor_coach_done: false,
      ui_layout: { panel: "split" },
      has_openai_key: true,
      last_welcome_back_at: null,
      // Phase 22D: streak-nudge opt-in. Defaults true at the DB layer
      // via the migration, but the row parser still requires the
      // boolean to be present in the SELECT result.
      email_opt_in: true,
      // Phase 27: per-user opt-out for the streak system. Defaults
      // false at the DB layer; row parser requires the boolean.
      disable_streaks: false,
      updated_at: new Date(),
    };

    it("accepts a well-formed row", () => {
      expect(PrefsRowSchema.safeParse(wellFormed).success).toBe(true);
    });

    it("rejects a row with an unknown persona", () => {
      const r = PrefsRowSchema.safeParse({ ...wellFormed, persona: "expert" });
      expect(r.success).toBe(false);
    });

    it("rejects a row with an unknown theme", () => {
      const r = PrefsRowSchema.safeParse({ ...wellFormed, theme: "neon" });
      expect(r.success).toBe(false);
    });

    it("accepts a null ui_layout (bare INSERT default)", () => {
      expect(
        PrefsRowSchema.safeParse({ ...wellFormed, ui_layout: null }).success,
      ).toBe(true);
    });
  });

  describe("ProjectRowSchema", () => {
    const wellFormed = {
      language: "python",
      files: { "main.py": "print('hi')" },
      active_file: "main.py",
      open_tabs: ["main.py"],
      file_order: ["main.py"],
      stdin: "",
      updated_at: new Date(),
    };

    it("accepts a well-formed row", () => {
      expect(ProjectRowSchema.safeParse(wellFormed).success).toBe(true);
    });

    it("rejects a row with a non-string file value", () => {
      const r = ProjectRowSchema.safeParse({
        ...wellFormed,
        files: { "main.py": 42 },
      });
      expect(r.success).toBe(false);
    });
  });
});
