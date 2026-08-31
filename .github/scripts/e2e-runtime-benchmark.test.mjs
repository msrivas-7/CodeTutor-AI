import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { compareRuntimeExperiments } from "./e2e-runtime-benchmark.mjs";

const run = { id: 7, head_sha: "abc" };
const workflow = readFileSync(new URL("../workflows/e2e-runtime-benchmark.yml", import.meta.url), "utf8");
const topology = readFileSync(new URL("../workflows/e2e-shard-topology.yml", import.meta.url), "utf8");
const compose = readFileSync(new URL("../../docker-compose.yml", import.meta.url), "utf8");

function job(experiment, shard, { duration, boot, tests, conclusion = "success", offset = 0 }) {
  const start = new Date(Date.parse("2026-08-31T10:00:00Z") + offset * 1000);
  const bootStart = new Date(start.getTime() + 10_000);
  const bootEnd = new Date(bootStart.getTime() + boot * 1000);
  const testStart = new Date(bootEnd.getTime() + 20_000);
  const testEnd = new Date(testStart.getTime() + tests * 1000);
  return {
    name: `call / Playwright runtime ${experiment} (${shard}/16)`,
    conclusion,
    started_at: start.toISOString(),
    completed_at: new Date(start.getTime() + duration * 1000).toISOString(),
    steps: [
      { name: "Boot docker-compose stack", started_at: bootStart.toISOString(), completed_at: bootEnd.toISOString() },
      { name: "Run identical full suite without retries", started_at: testStart.toISOString(), completed_at: testEnd.toISOString() },
    ],
  };
}

function experiment(id, values) {
  return Array.from({ length: 16 }, (_, index) => job(id, index + 1, values));
}

function preparation(name, duration = 25, conclusion = "success") {
  const started = new Date("2026-08-31T09:55:00Z");
  return {
    name,
    conclusion,
    started_at: started.toISOString(),
    completed_at: new Date(started.getTime() + duration * 1000).toISOString(),
    steps: [],
  };
}

function reliableJobs() {
  return [
    preparation("Build backend E2E image once"),
    preparation("Build runner E2E image once", 20),
    preparation("Build frontend E2E image once", 22),
    ...experiment("local-w2", { duration: 360, boot: 120, tests: 190 }),
    ...experiment("prebuilt-w2", { duration: 300, boot: 55, tests: 190, offset: 500 }),
    ...experiment("prebuilt-w3", { duration: 270, boot: 55, tests: 160, offset: 900 }),
    ...experiment("prebuilt-w4", { duration: 265, boot: 55, tests: 155, offset: 1_300 }),
  ];
}

test("selects image reuse and only materially faster worker counts", () => {
  const result = compareRuntimeExperiments({
    benchmarkRun: run,
    benchmarkJobs: { jobs: reliableJobs() },
    totalTests: 439,
  });
  assert.deepEqual(result.provisionalSelection, { prebuiltImages: true, workersPerShard: 3 });
  assert.equal(result.preparation.readySeconds, 25);
  assert.deepEqual(result.cacheComparison, {
    localEndToEndSeconds: 360,
    prebuiltEndToEndSeconds: 325,
  });
  assert.equal(result.experiments[0].bootSeconds.median, 120);
  assert.equal(result.experiments[1].bootSeconds.p90, 55);
});

test("does not adopt image reuse without a material end-to-end gain", () => {
  const jobs = reliableJobs();
  for (const item of jobs.filter((candidate) => candidate.name.includes("prebuilt-w2"))) {
    item.completed_at = new Date(Date.parse(item.started_at) + 350_000).toISOString();
  }
  const result = compareRuntimeExperiments({ benchmarkRun: run, benchmarkJobs: jobs, totalTests: 439 });
  assert.deepEqual(result.provisionalSelection, { prebuiltImages: false, workersPerShard: null });
});

test("charges the complete image preparation critical path to reuse", () => {
  const jobs = reliableJobs();
  for (const item of jobs.filter((candidate) => candidate.name.includes("E2E image once"))) {
    item.completed_at = new Date(Date.parse(item.started_at) + 80_000).toISOString();
  }
  const result = compareRuntimeExperiments({ benchmarkRun: run, benchmarkJobs: jobs, totalTests: 439 });
  assert.deepEqual(result.cacheComparison, {
    localEndToEndSeconds: 360,
    prebuiltEndToEndSeconds: 380,
  });
  assert.deepEqual(result.provisionalSelection, { prebuiltImages: false, workersPerShard: null });
});

test("fails closed when any required image preparation job fails", () => {
  const jobs = reliableJobs();
  jobs.find((item) => item.name.includes("runner E2E image")).conclusion = "failure";
  const result = compareRuntimeExperiments({ benchmarkRun: run, benchmarkJobs: jobs, totalTests: 439 });
  assert.equal(result.preparation.reliable, false);
  assert.deepEqual(result.provisionalSelection, { prebuiltImages: false, workersPerShard: null });
});

test("never selects an unreliable worker experiment", () => {
  const jobs = reliableJobs().filter((item) => !item.name.includes("prebuilt-w4"));
  jobs.find((item) => item.name.includes("prebuilt-w3")).conclusion = "failure";
  const result = compareRuntimeExperiments({ benchmarkRun: run, benchmarkJobs: jobs, totalTests: 439 });
  assert.deepEqual(result.provisionalSelection, { prebuiltImages: true, workersPerShard: 2 });
  assert.equal(result.experiments.find((item) => item.id === "prebuilt-w3").reliable, false);
});

test("workflow holds shards constant and changes one worker variable per stage", () => {
  assert.match(workflow, /experiment: local-w2\n\s+workers: 2/);
  assert.match(workflow, /experiment: prebuilt-w2\n\s+workers: 2/);
  assert.match(workflow, /experiment: prebuilt-w3\n\s+workers: 3/);
  assert.match(workflow, /experiment: prebuilt-w4\n\s+workers: 4/);
  assert.equal((workflow.match(/name: Build (?:backend|runner|frontend) E2E image once/g) ?? []).length, 3);
  assert.match(workflow, /needs: \[prepare-backend, prepare-runner, prepare-frontend\]/);
  assert.doesNotMatch(workflow, /max_parallel: (?:2[1-9]|[3-9][0-9])/);
  assert.match(topology, /--workers=\$\{\{ inputs\.workers }}/);
  assert.match(topology, /docker compose up -d --no-build backend frontend/);
  assert.match(compose, /image: \$\{FRONTEND_IMAGE:-codetutor-ai-frontend:latest}/);
});

test("registry writes are restricted to labeled same-repository pull requests", () => {
  assert.match(workflow, /packages: write/);
  assert.match(
    workflow,
    /github\.event\.label\.name == 'ci-runtime-benchmark' && github\.event\.pull_request\.head\.repo\.full_name == github\.repository/,
  );
  assert.doesNotMatch(workflow, /pull_request_target/);
});

test("rejects an invalid test inventory", () => {
  assert.throws(
    () => compareRuntimeExperiments({ benchmarkRun: run, benchmarkJobs: [], totalTests: 0 }),
    /positive integer/,
  );
});
