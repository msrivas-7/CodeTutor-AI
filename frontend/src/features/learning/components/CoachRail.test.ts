import { describe, it, expect } from "vitest";
import { pickNudge } from "./CoachRail";

const base = {
  hasEdited: false,
  hasRun: false,
  hasError: false,
  hasChecked: false,
  checkPassed: false,
  failedCheckCount: 0,
  lessonComplete: false,
  tutorConfigured: false,
};

const none = new Set<string>();

describe("pickNudge", () => {
  it("returns null when no conditions met (too early)", () => {
    expect(pickNudge(base, 10, 10, none)).toBeNull();
  });

  it("returns 'read instructions' after 30s with no edits", () => {
    const n = pickNudge(base, 35, 35, none);
    expect(n?.id).toBe("no-edits-short");
    expect(n?.message).toMatch(/reading the instructions/i);
  });

  it("returns 'try editing' after 60s (higher priority than 30s)", () => {
    const n = pickNudge(base, 65, 65, none);
    expect(n?.id).toBe("no-edits-long");
    expect(n?.message).toMatch(/try changing the code/i);
  });

  it("returns 'run your code' when edited but not run and idle > 45s", () => {
    const n = pickNudge({ ...base, hasEdited: true }, 60, 50, none);
    expect(n?.id).toBe("edited-no-run");
    expect(n?.message).toMatch(/Run button/);
  });

  it("returns null when edited but not run and idle < 45s", () => {
    expect(pickNudge({ ...base, hasEdited: true }, 20, 10, none)).toBeNull();
  });

  it("returns 'check solution' when run ok but not checked", () => {
    const n = pickNudge({ ...base, hasEdited: true, hasRun: true }, 60, 5, none);
    expect(n?.id).toBe("ran-ok-check");
    expect(n?.message).toMatch(/Check Solution/);
  });

  it("returns error nudge when run has error and idle > 30s", () => {
    const n = pickNudge({ ...base, hasEdited: true, hasRun: true, hasError: true }, 60, 35, none);
    expect(n?.id).toBe("ran-error");
  });

  it("error nudge mentions 'Explain Error' when tutor configured", () => {
    const n = pickNudge({ ...base, hasEdited: true, hasRun: true, hasError: true, tutorConfigured: true }, 60, 35, none);
    expect(n?.message).toMatch(/Explain Error/);
  });

  it("error nudge omits tutor reference when not configured", () => {
    const n = pickNudge({ ...base, hasEdited: true, hasRun: true, hasError: true, tutorConfigured: false }, 60, 35, none);
    expect(n?.message).not.toMatch(/Explain Error/);
  });

  it("returns 'not quite' after failed check and idle > 30s", () => {
    const n = pickNudge({ ...base, hasEdited: true, hasRun: true, hasChecked: true }, 60, 35, none);
    expect(n?.id).toBe("failed-check");
    expect(n?.message).toMatch(/Re-read/);
  });

  it("returns 'tricky' after 3+ failed checks", () => {
    const n = pickNudge({ ...base, hasEdited: true, hasRun: true, hasChecked: true, failedCheckCount: 3 }, 60, 5, none);
    expect(n?.id).toBe("many-fails");
    expect(n?.message).toMatch(/tricky/i);
  });

  it("returns completion nudge when lesson complete", () => {
    const n = pickNudge({ ...base, lessonComplete: true }, 5, 5, none);
    expect(n?.id).toBe("completed-idle");
    expect(n?.message).toMatch(/Nice work/);
  });

  it("completion nudge takes priority over other states", () => {
    const n = pickNudge({ ...base, lessonComplete: true, hasEdited: true, hasRun: true }, 60, 60, none);
    expect(n?.id).toBe("completed-idle");
  });

  it("skips dismissed nudges", () => {
    const dismissed = new Set(["completed-idle"]);
    const n = pickNudge({ ...base, lessonComplete: true }, 5, 5, dismissed);
    expect(n?.id).not.toBe("completed-idle");
  });

  it("returns null when all matching nudges are dismissed", () => {
    const dismissed = new Set(["no-edits-long", "no-edits-short"]);
    expect(pickNudge(base, 65, 65, dismissed)).toBeNull();
  });

  it("returns null when check passed and no special state", () => {
    const n = pickNudge({ ...base, hasEdited: true, hasRun: true, hasChecked: true, checkPassed: true, lessonComplete: true }, 5, 5, new Set(["completed-idle"]));
    expect(n).toBeNull();
  });
});
