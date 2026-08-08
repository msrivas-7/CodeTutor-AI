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
});
