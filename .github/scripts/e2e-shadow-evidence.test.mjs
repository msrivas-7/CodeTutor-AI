import assert from "node:assert/strict";
import test from "node:test";

import { aggregateShadowEvidence } from "./e2e-shadow-evidence.mjs";

const run = {
  id: 42,
  run_attempt: 1,
  event: "pull_request",
  head_sha: "abc123",
  created_at: "2026-07-30T10:00:00Z",
};

const jobs = {
  jobs: [
    {
      name: "Playwright critical lane (advisory)",
      conclusion: "success",
      started_at: "2026-07-30T10:00:20Z",
      completed_at: "2026-07-30T10:03:00Z",
    },
    ...[1, 2, 3, 4].map((shard) => ({
      name: `Playwright (chromium) (${shard})`,
      conclusion: "success",
      started_at: "2026-07-30T10:00:30Z",
      completed_at: `2026-07-30T10:0${shard + 3}:00Z`,
    })),
  ],
};

test("records queue-inclusive critical and full-suite readiness", () => {
  const evidence = aggregateShadowEvidence({
    run,
    jobs,
    changedFiles: [{ filename: "frontend/src/App.tsx" }, { filename: "e2e/specs/a.spec.ts" }],
    fullOutcome: "success",
    crossBrowserOutcome: "success",
    criticalOutcome: "success",
    contractOutcome: "success",
  });
  assert.equal(evidence.timing.criticalReadySeconds, 180);
  assert.equal(evidence.timing.fullReadySeconds, 420);
  assert.deepEqual(evidence.eligibility.changeClasses, ["e2e", "frontend"]);
  assert.equal(evidence.outcomes.miss, false);
  assert.equal(evidence.policy.blockingSourceOfTruth, "full-chromium-suite");
});

test("flags review when critical passes but the blocking full suite fails", () => {
  const evidence = aggregateShadowEvidence({
    run,
    jobs,
    fullOutcome: "failure",
    crossBrowserOutcome: "success",
    criticalOutcome: "success",
    contractOutcome: "success",
  });
  assert.equal(evidence.outcomes.miss, true);
  assert.equal(evidence.outcomes.reviewRequired, true);
});
