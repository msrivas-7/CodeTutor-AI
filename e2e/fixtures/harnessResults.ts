// Canned TestReport payloads for mocking /api/execute/tests. Shapes match
// frontend/src/features/learning/types.ts (TestReport / TestCaseResult).
//
// For most function-tests specs we hit the real backend harness — it's fast
// and exercises the full stack. These mocks exist for two cases:
//   1. Tests that want to assert on specific failure copy without authoring
//      learner code that reproduces it (e.g. the hidden-category-reveal gate
//      on the 2nd consecutive same-test fail).
//   2. Tests that need to exercise the harness-error surface without
//      triggering an actual interpreter crash.

import type { Page, Route } from "@playwright/test";

export interface TestCaseResult {
  name: string;
  hidden: boolean;
  category: string | null;
  passed: boolean;
  actualRepr: string | null;
  expectedRepr: string | null;
  stdoutDuring: string;
  error: string | null;
}

export interface TestReport {
  results: TestCaseResult[];
  harnessError: string | null;
  cleanStdout: string;
}

export interface ExecuteTestsResponse {
  stdout: string;
  stderr: string;
  durationMs: number;
  testReport: TestReport;
}

// Baseline: everything passes. Useful for "assert the completion modal opens".
export const allPassing: ExecuteTestsResponse = {
  stdout: "",
  stderr: "",
  durationMs: 42,
  testReport: {
    cleanStdout: "",
    harnessError: null,
    results: [
      {
        name: "visible_basic",
        hidden: false,
        category: "basic",
        passed: true,
        actualRepr: "3",
        expectedRepr: "3",
        stdoutDuring: "",
        error: null,
      },
      {
        name: "visible_edge",
        hidden: false,
        category: "edge",
        passed: true,
        actualRepr: "[]",
        expectedRepr: "[]",
        stdoutDuring: "",
        error: null,
      },
      {
        name: "hidden_boundary",
        hidden: true,
        category: "boundary",
        passed: true,
        actualRepr: "0",
        expectedRepr: "0",
        stdoutDuring: "",
        error: null,
      },
    ],
  },
};

// One visible test fails — should route the learner to the Examples tab and
// show the FailedTestCallout with actual vs expected side-by-side.
export const oneVisibleFail: ExecuteTestsResponse = {
  stdout: "",
  stderr: "",
  durationMs: 38,
  testReport: {
    cleanStdout: "",
    harnessError: null,
    results: [
      {
        name: "visible_basic",
        hidden: false,
        category: "basic",
        passed: true,
        actualRepr: "3",
        expectedRepr: "3",
        stdoutDuring: "",
        error: null,
      },
      {
        name: "visible_edge",
        hidden: false,
        category: "edge",
        passed: false,
        actualRepr: "None",
        expectedRepr: "0",
        stdoutDuring: "",
        error: null,
      },
      {
        name: "hidden_boundary",
        hidden: true,
        category: null,
        passed: true,
        actualRepr: "0",
        expectedRepr: "0",
        stdoutDuring: "",
        error: null,
      },
    ],
  },
};

// Hidden failure, no category revealed yet. Reveals `category` only after
// the same test fails consecutively ≥2 times (LessonPage.sameFailStreak).
export const hiddenFailFirstTime: ExecuteTestsResponse = {
  stdout: "",
  stderr: "",
  durationMs: 55,
  testReport: {
    cleanStdout: "",
    harnessError: null,
    results: [
      {
        name: "visible_basic",
        hidden: false,
        category: "basic",
        passed: true,
        actualRepr: "3",
        expectedRepr: "3",
        stdoutDuring: "",
        error: null,
      },
      {
        name: "hidden_edge_case",
        hidden: true,
        category: "edge",
        passed: false,
        actualRepr: "1",
        expectedRepr: "0",
        stdoutDuring: "",
        error: null,
      },
    ],
  },
};

// Harness itself crashed (e.g. learner code raised at import time). The UI
// should show a generic fallback, not the per-test failure panel.
export const harnessCrash: ExecuteTestsResponse = {
  stdout: "",
  stderr: 'Traceback (most recent call last):\n  File "main.py", line 1\n    def !!: pass\n        ^\nSyntaxError: invalid syntax\n',
  durationMs: 12,
  testReport: {
    cleanStdout: "",
    harnessError: "SyntaxError in learner code — tests could not run",
    results: [],
  },
};

export type HarnessScenario = "allPassing" | "oneVisibleFail" | "hiddenFailFirstTime" | "harnessCrash";

const SCENARIOS: Record<HarnessScenario, ExecuteTestsResponse> = {
  allPassing,
  oneVisibleFail,
  hiddenFailFirstTime,
  harnessCrash,
};

export async function mockExecuteTests(page: Page, scenario: HarnessScenario): Promise<void> {
  await page.route("**/api/execute/tests", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(SCENARIOS[scenario]),
    });
  });
}

// Cycles through scenarios on repeated calls. Useful for "fail, fail again
// with the same test → category reveals".
export async function mockExecuteTestsQueue(page: Page, scenarios: HarnessScenario[]): Promise<void> {
  if (scenarios.length === 0) throw new Error("mockExecuteTestsQueue needs at least one scenario");
  let i = 0;
  await page.route("**/api/execute/tests", async (route: Route) => {
    const s = scenarios[Math.min(i, scenarios.length - 1)];
    i++;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(SCENARIOS[s]),
    });
  });
}
