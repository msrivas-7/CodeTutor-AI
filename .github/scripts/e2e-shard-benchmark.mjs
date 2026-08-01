#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function secondsBetween(start, end) {
  if (!start || !end) return null;
  const value = (Date.parse(end) - Date.parse(start)) / 1000;
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function summarizeTopology({ total, run, jobs, namePrefix }) {
  const selected = jobs.filter((job) => job.name.startsWith(namePrefix));
  const startedValues = selected
    .map((job) => Date.parse(job.started_at))
    .filter((value) => Number.isFinite(value));
  const topologyStartedAt =
    startedValues.length === total ? new Date(Math.min(...startedValues)).toISOString() : null;
  const topologyReadyValues = selected
    .map((job) => secondsBetween(topologyStartedAt, job.completed_at))
    .filter((value) => value !== null);
  const executionValues = selected
    .map((job) => secondsBetween(job.started_at, job.completed_at))
    .filter((value) => value !== null);
  return {
    shards: total,
    runId: run.id,
    expectedJobs: total,
    observedJobs: selected.length,
    reliable:
      selected.length === total && selected.every((job) => job.conclusion === "success"),
    topologyStartedAt,
    topologyReadySeconds:
      topologyReadyValues.length === total ? Math.max(...topologyReadyValues) : null,
    slowestExecutionSeconds:
      executionValues.length === total ? Math.max(...executionValues) : null,
    jobs: selected.map((job) => ({
      name: job.name,
      conclusion: job.conclusion ?? "unknown",
      executionSeconds: secondsBetween(job.started_at, job.completed_at),
      topologyRelativeSeconds: secondsBetween(topologyStartedAt, job.completed_at),
    })),
  };
}

export function compareShardTopologies({ baselineRun, baselineJobs, benchmarkRun, benchmarkJobs }) {
  const topologies = [
    summarizeTopology({
      total: 4,
      run: baselineRun,
      jobs: baselineJobs.jobs ?? baselineJobs,
      namePrefix: "Playwright (chromium)",
    }),
    summarizeTopology({
      total: 6,
      run: benchmarkRun,
      jobs: benchmarkJobs.jobs ?? benchmarkJobs,
      namePrefix: "Playwright benchmark 6 shards",
    }),
    summarizeTopology({
      total: 8,
      run: benchmarkRun,
      jobs: benchmarkJobs.jobs ?? benchmarkJobs,
      namePrefix: "Playwright benchmark 8 shards",
    }),
  ];
  const reliable = topologies
    .filter((item) => item.reliable && item.topologyReadySeconds !== null)
    .sort(
      (left, right) =>
        left.topologyReadySeconds - right.topologyReadySeconds ||
        left.slowestExecutionSeconds - right.slowestExecutionSeconds ||
        left.shards - right.shards,
    );
  return {
    schemaVersion: 1,
    headSha: benchmarkRun.head_sha,
    policy: {
      workersPerShard: 2,
      retries: 0,
      selectionMetric: "fastest reliable topology-relative completion",
      status:
        "topologies run sequentially to protect shared services; actual PR p95 remains queue-inclusive; shadow pilot remains required before test demotion",
    },
    topologies,
    provisionalSelection: reliable[0]?.shards ?? null,
  };
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function main() {
  const required = ["--baseline-run", "--baseline-jobs", "--benchmark-run", "--benchmark-jobs", "--output"];
  for (const option of required) {
    if (!argument(option)) throw new Error(`Missing ${option}`);
  }
  const result = compareShardTopologies({
    baselineRun: JSON.parse(fs.readFileSync(argument("--baseline-run"), "utf8")),
    baselineJobs: JSON.parse(fs.readFileSync(argument("--baseline-jobs"), "utf8")),
    benchmarkRun: JSON.parse(fs.readFileSync(argument("--benchmark-run"), "utf8")),
    benchmarkJobs: JSON.parse(fs.readFileSync(argument("--benchmark-jobs"), "utf8")),
  });
  const output = argument("--output");
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
  console.log(
    `Shard benchmark provisional selection: ${result.provisionalSelection ?? "none"}; ` +
      result.topologies
        .map((item) => `${item.shards}=${item.reliable ? `${item.topologyReadySeconds}s` : "unreliable"}`)
        .join(", "),
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
