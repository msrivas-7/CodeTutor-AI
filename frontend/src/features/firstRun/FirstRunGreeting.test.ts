import { describe, expect, it } from "vitest";
import { resolveWelcomeHandoff } from "./FirstRunGreeting";

describe("welcome handoff ownership", () => {
  it("sends a brand-new learner into the coordinated first lesson", () => {
    expect(resolveWelcomeHandoff(false, false)).toEqual({
      replay: false,
      target: "/learn/course/python-fundamentals/lesson/hello-world?firstRun=1",
    });
  });

  it("keeps explicit and direct replays away from destructive first-run state", () => {
    expect(resolveWelcomeHandoff(true, false)).toEqual({
      replay: true,
      target: "/start",
    });
    expect(resolveWelcomeHandoff(false, true)).toEqual({
      replay: true,
      target: "/start",
    });
  });

  it("returns a replay to its validated internal origin", () => {
    const practice = "/learn/course/python-fundamentals/lesson/variables?mode=practice#task";
    expect(resolveWelcomeHandoff(true, true, practice)).toEqual({
      replay: true,
      target: practice,
    });
    expect(resolveWelcomeHandoff(true, true, "https://evil.example/steal").target)
      .toBe("/start");
    expect(resolveWelcomeHandoff(true, true, "/welcome?replay=1").target)
      .toBe("/start");
  });

  it("cannot return a replay into destructive first-run lesson state", () => {
    expect(
      resolveWelcomeHandoff(
        true,
        true,
        "/learn/course/python-fundamentals/lesson/hello-world?firstRun=1&from=settings#editor",
      ).target,
    ).toBe(
      "/learn/course/python-fundamentals/lesson/hello-world?from=settings#editor",
    );
  });
});
