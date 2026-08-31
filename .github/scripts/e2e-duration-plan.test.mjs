import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildDurationPlan, inventoryTests, writeDurationPlan } from "./e2e-duration-plan.mjs";

function inventory() {
  return {
    suites: [{
      title: "lesson.spec.ts",
      file: "lesson.spec.ts",
      suites: [{
        title: "lesson journey",
        specs: [
          { id: "slow", title: "slow path", file: "lesson.spec.ts", line: 10, column: 3, tags: ["lane:critical"], tests: [{ projectName: "chromium" }] },
          { id: "medium", title: "medium path", file: "lesson.spec.ts", line: 20, column: 3, tags: [], tests: [{ projectName: "chromium" }] },
          { id: "fast", title: "fast path", file: "lesson.spec.ts", line: 30, column: 3, tags: ["lane:critical"], tests: [{ projectName: "chromium" }] },
          { id: "webkit", title: "other browser", file: "lesson.spec.ts", line: 40, column: 3, tags: [], tests: [{ projectName: "webkit" }] },
        ],
      }],
    }],
  };
}

test("balances measured durations and assigns every Chromium test once", () => {
  const tests = inventoryTests(inventory());
  const plan = buildDurationPlan({
    tests,
    history: { tests: { slow: 20_000, medium: 11_000, fast: 9_000 } },
    shardCount: 2,
  });
  assert.equal(plan.testCount, 3);
  assert.deepEqual(plan.shards.map((shard) => shard.predictedWorkMs), [20_000, 20_000]);
  assert.deepEqual(
    plan.shards.flatMap((shard) => shard.tests.map((candidate) => candidate.id)).sort(),
    ["fast", "medium", "slow"],
  );
});

test("uses a conservative default for unseen tests and can select a tagged lane", () => {
  const tests = inventoryTests(inventory(), { tag: "lane:critical" });
  const plan = buildDurationPlan({ tests, history: { tests: { slow: 12_000 } }, shardCount: 2 });
  assert.deepEqual(plan.shards.map((shard) => shard.predictedWorkMs), [12_000, 8_000]);
});

test("writes Playwright test-list files plus a compact manifest", () => {
  const output = mkdtempSync(join(tmpdir(), "e2e-duration-plan-"));
  const plan = buildDurationPlan({
    tests: inventoryTests(inventory()),
    history: { tests: {} },
    shardCount: 2,
  });
  const manifest = writeDurationPlan(plan, output);
  assert.equal(manifest.testCount, 3);
  const selectors = [1, 2]
    .flatMap((shard) => readFileSync(join(output, `shard-${shard}.txt`), "utf8").trim().split("\n"))
    .sort();
  assert.deepEqual(selectors, [
    "[chromium] › lesson.spec.ts:10:3 › lesson journey › slow path",
    "[chromium] › lesson.spec.ts:20:3 › lesson journey › medium path",
    "[chromium] › lesson.spec.ts:30:3 › lesson journey › fast path",
  ]);
});

test("rejects duplicate ids instead of silently dropping coverage", () => {
  const report = inventory();
  report.suites[0].suites[0].specs[1].id = "slow";
  assert.throws(() => inventoryTests(report), /duplicate test id/);
});
