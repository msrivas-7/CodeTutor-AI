import assert from "node:assert/strict";
import test from "node:test";

import { mergeDurationHistory } from "./e2e-duration-history.mjs";

test("merges clean shard timings with a bounded moving average", () => {
  const result = mergeDurationHistory({
    base: { tests: { existing: 10_000, old: { durationMs: 4_000, samples: 20 } } },
    reports: [
      { name: "shard-1.json", report: { schemaVersion: 1, status: "passed", tests: {
        existing: { durationMs: 20_000, status: "passed" },
        unseen: { durationMs: 5_000, status: "passed" },
        skipped: { durationMs: 0, status: "skipped" },
      } } },
      { name: "shard-2.json", report: { schemaVersion: 1, status: "passed", tests: {
        old: { durationMs: 6_000, status: "passed" },
      } } },
    ],
  });
  assert.deepEqual(result.tests.existing, { durationMs: 13_000, samples: 2 });
  assert.deepEqual(result.tests.unseen, { durationMs: 5_000, samples: 1 });
  assert.deepEqual(result.tests.old, { durationMs: 4_600, samples: 20 });
  assert.equal(result.tests.skipped, undefined);
});
test("rejects failed reports and duplicate coverage", () => {
  assert.throws(() => mergeDurationHistory({
    base: { tests: {} },
    reports: [{ name: "failed.json", report: { schemaVersion: 1, status: "failed", tests: {} } }],
  }), /did not record a clean/);
  const report = { schemaVersion: 1, status: "passed", tests: { same: { durationMs: 1_000, status: "passed" } } };
  assert.throws(() => mergeDurationHistory({
    base: { tests: {} },
    reports: [{ name: "one.json", report }, { name: "two.json", report }],
  }), /duplicate timing/);
});
