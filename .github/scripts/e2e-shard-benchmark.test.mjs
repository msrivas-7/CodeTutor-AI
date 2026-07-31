import assert from "node:assert/strict";
import test from "node:test";

import { compareShardTopologies } from "./e2e-shard-benchmark.mjs";

function job(name, minute, conclusion = "success") {
  return {
    name,
    conclusion,
    started_at: "2026-07-30T10:00:30Z",
    completed_at: `2026-07-30T10:${String(minute).padStart(2, "0")}:00Z`,
  };
}

const baselineRun = { id: 1, created_at: "2026-07-30T10:00:00Z", head_sha: "abc" };
const benchmarkRun = { id: 2, created_at: "2026-07-30T10:00:00Z", head_sha: "abc" };

test("selects the fastest reliable queue-inclusive topology", () => {
  const result = compareShardTopologies({
    baselineRun,
    baselineJobs: { jobs: Array.from({ length: 4 }, (_, index) => job(`Playwright (chromium) (${index + 1})`, 8)) },
    benchmarkRun,
    benchmarkJobs: {
      jobs: [
        ...Array.from({ length: 6 }, (_, index) => job(`Playwright benchmark 6 shards (${index + 1}/6)`, 6)),
        ...Array.from({ length: 8 }, (_, index) => job(`Playwright benchmark 8 shards (${index + 1}/8)`, 7)),
      ],
    },
  });
  assert.equal(result.provisionalSelection, 6);
  assert.equal(result.topologies[1].reliable, true);
  assert.equal(result.topologies[1].queueInclusiveReadySeconds, 360);
});

test("never selects an incomplete or failing topology", () => {
  const result = compareShardTopologies({
    baselineRun,
    baselineJobs: { jobs: Array.from({ length: 4 }, (_, index) => job(`Playwright (chromium) (${index + 1})`, 8)) },
    benchmarkRun,
    benchmarkJobs: {
      jobs: [
        ...Array.from({ length: 6 }, (_, index) =>
          job(`Playwright benchmark 6 shards (${index + 1}/6)`, 5, index === 0 ? "failure" : "success"),
        ),
        ...Array.from({ length: 7 }, (_, index) => job(`Playwright benchmark 8 shards (${index + 1}/8)`, 4)),
      ],
    },
  });
  assert.equal(result.provisionalSelection, 4);
  assert.equal(result.topologies[1].reliable, false);
  assert.equal(result.topologies[2].reliable, false);
});
