#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

function requirePositiveInteger(value, name) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
}

export function deriveRebenchmarkBounds(totalTests, selectedShards) {
  requirePositiveInteger(totalTests, "benchmark.totalTests");
  requirePositiveInteger(selectedShards, "selectedShards");
  if (selectedShards < 2) {
    throw new Error("selectedShards must be at least 2 to derive a two-sided capacity band");
  }

  return {
    atOrBelowTests: Math.floor(totalTests * (selectedShards - 1) / selectedShards),
    atOrAboveTests: Math.ceil(totalTests * (selectedShards + 1) / selectedShards),
  };
}

export function deriveDatabaseStackFanout(workflowSource, { dynamicJobInstances = {} } = {}) {
  if (typeof workflowSource !== "string" || workflowSource.trim() === "") {
    throw new Error("workflow source must be a non-empty string");
  }

  const jobs = [...workflowSource.matchAll(
    /^  ([A-Za-z0-9_-]+):\s*\n([\s\S]*?)(?=^  [A-Za-z0-9_-]+:\s*\n|(?![\s\S]))/gm,
  )]
    .filter(([, , body]) => /\bdocker compose[^\n]*\bup\b/.test(body))
    .map(([, name, body]) => {
      const matrixBlock = body.match(
        /^      matrix:\s*\n((?:        [^\n]+\n?)*)/m,
      )?.[1];
      if (!matrixBlock) return { name, instances: 1 };

      const dimensions = [...matrixBlock.matchAll(
        /^        ([A-Za-z0-9_-]+):\s*\[([^\]]+)]\s*$/gm,
      )];
      if (dimensions.length === 0) {
        const dynamicInstances = dynamicJobInstances[name];
        if (Number.isInteger(dynamicInstances) && dynamicInstances > 0) {
          return { name, instances: dynamicInstances };
        }
        throw new Error(
          `database-backed job ${name} must use inline matrix lists or a verified dynamic instance count so fan-out can be verified`,
        );
      }
      const instances = dimensions.reduce((product, [, dimension, values]) => {
        const count = values.split(",").map((value) => value.trim()).filter(Boolean).length;
        if (count === 0) {
          throw new Error(`database-backed job ${name} has an empty ${dimension} matrix`);
        }
        return product * count;
      }, 1);
      return { name, instances };
    });

  if (jobs.length === 0) {
    throw new Error("workflow has no database-backed docker compose jobs");
  }
  return {
    jobs,
    totalConcurrentStacks: jobs.reduce((sum, job) => sum + job.instances, 0),
  };
}

export function evaluateShardCapacity({ record, totalTests, activeShards, workflowSource }) {
  if (record?.schemaVersion !== 1) {
    throw new Error("capacity record schemaVersion must be 1");
  }
  requirePositiveInteger(record.selectedShards, "selectedShards");
  requirePositiveInteger(record?.benchmark?.totalTests, "benchmark.totalTests");
  requirePositiveInteger(
    record?.operationalTopology?.maximumReliableConcurrentStacks,
    "operationalTopology.maximumReliableConcurrentStacks",
  );
  requirePositiveInteger(totalTests, "totalTests");
  requirePositiveInteger(activeShards, "activeShards");

  if (activeShards > record.selectedShards) {
    throw new Error(
      `active workflow has ${activeShards} shards but the proven operational fallback permits at most ${record.selectedShards}`,
    );
  }

  const fanout = deriveDatabaseStackFanout(workflowSource, {
    dynamicJobInstances: { e2e: activeShards },
  });
  const blockingJob = fanout.jobs.find(({ name }) => name === "e2e");
  if (!blockingJob || blockingJob.instances !== activeShards) {
    throw new Error(
      "workflow e2e matrix must match the active blocking Chromium shard count",
    );
  }
  if (
    fanout.totalConcurrentStacks
    > record.operationalTopology.maximumReliableConcurrentStacks
  ) {
    throw new Error(
      `operational workflow requests ${fanout.totalConcurrentStacks} concurrent stacks but the measured reliable limit is ${record.operationalTopology.maximumReliableConcurrentStacks}`,
    );
  }

  const expectedBounds = deriveRebenchmarkBounds(
    record.benchmark.totalTests,
    record.selectedShards,
  );
  const recordedBounds = record.rebenchmark ?? {};
  if (
    recordedBounds.atOrBelowTests !== expectedBounds.atOrBelowTests
    || recordedBounds.atOrAboveTests !== expectedBounds.atOrAboveTests
  ) {
    throw new Error(
      `capacity record bounds must be ${expectedBounds.atOrBelowTests}/${expectedBounds.atOrAboveTests} for the measured suite and topology`,
    );
  }

  const direction = totalTests <= expectedBounds.atOrBelowTests
    ? "lower"
    : totalTests >= expectedBounds.atOrAboveTests
      ? "upper"
      : null;

  return {
    eligible: true,
    rebenchmarkRecommended: direction !== null && activeShards === record.selectedShards,
    direction,
    totalTests,
    activeShards,
    selectedShards: record.selectedShards,
    benchmarkTests: record.benchmark.totalTests,
    allowedMinimum: expectedBounds.atOrBelowTests + 1,
    allowedMaximum: expectedBounds.atOrAboveTests - 1,
    totalConcurrentStacks: fanout.totalConcurrentStacks,
    ...expectedBounds,
  };
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error("expected --record, --workflow, --total-tests, and --active-shards arguments");
    }
    args[key.slice(2)] = value;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.record || !args.workflow || !args["total-tests"] || !args["active-shards"]) {
    throw new Error("expected --record, --workflow, --total-tests, and --active-shards arguments");
  }

  const [recordText, workflowSource] = await Promise.all([
    readFile(args.record, "utf8"),
    readFile(args.workflow, "utf8"),
  ]);
  const record = JSON.parse(recordText);
  const result = evaluateShardCapacity({
    record,
    totalTests: Number(args["total-tests"]),
    activeShards: Number(args["active-shards"]),
    workflowSource,
  });

  console.log(
    `Playwright shard capacity is safe: ${result.totalTests} tests, ${result.activeShards} Chromium shards, ${result.totalConcurrentStacks} total database stacks, rebenchmark recommended=${result.rebenchmarkRecommended}.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`e2e-shard-capacity: ${error.message}`);
    process.exitCode = 1;
  });
}
