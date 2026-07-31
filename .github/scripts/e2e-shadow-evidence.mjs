#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function secondsBetween(start, end) {
  if (!start || !end) return null;
  const duration = (Date.parse(end) - Date.parse(start)) / 1000;
  return Number.isFinite(duration) && duration >= 0 ? duration : null;
}

function summarizeJob(job, runCreatedAt) {
  return {
    name: job.name,
    conclusion: job.conclusion ?? "unknown",
    executionSeconds: secondsBetween(job.started_at, job.completed_at),
    queueInclusiveSeconds: secondsBetween(runCreatedAt, job.completed_at),
  };
}

function latestCompletionSeconds(jobs, runCreatedAt) {
  const durations = jobs
    .map((job) => secondsBetween(runCreatedAt, job.completed_at))
    .filter((value) => value !== null);
  return durations.length === 0 ? null : Math.max(...durations);
}

function classifyChanges(files) {
  const classes = new Set();
  for (const item of files) {
    const file = typeof item === "string" ? item : item.filename;
    if (!file) continue;
    if (file.startsWith("frontend/public/courses/")) classes.add("content");
    if (file.startsWith("frontend/")) classes.add("frontend");
    if (file.startsWith("backend/")) classes.add("backend");
    if (file.startsWith("supabase/")) classes.add("database");
    if (file.startsWith("e2e/")) classes.add("e2e");
    if (
      file.startsWith(".github/") ||
      file.startsWith("infra/") ||
      file === "docker-compose.yml"
    ) {
      classes.add("infra");
    }
  }
  return [...classes].sort();
}

export function aggregateShadowEvidence({
  run,
  jobs,
  changedFiles = [],
  fullOutcome,
  crossBrowserOutcome,
  criticalOutcome,
  contractOutcome,
}) {
  const allJobs = jobs.jobs ?? jobs;
  const fullJobs = allJobs.filter((job) => job.name.startsWith("Playwright (chromium)"));
  const criticalJobs = allJobs.filter((job) => job.name.startsWith("Playwright critical lane"));
  const crossBrowserJobs = allJobs.filter((job) => job.name.startsWith("Playwright core"));
  const criticalPassed = criticalOutcome === "success" && contractOutcome === "success";
  const fullPassed = fullOutcome === "success";
  const miss = criticalPassed && !fullPassed;

  return {
    schemaVersion: 1,
    run: {
      id: run.id,
      attempt: run.run_attempt,
      event: run.event,
      headSha: run.head_sha,
      createdAt: run.created_at,
    },
    eligibility: {
      eligible: fullOutcome !== "skipped" && fullJobs.length > 0,
      changeClasses: classifyChanges(changedFiles),
    },
    policy: {
      mode: "shadow",
      blockingSourceOfTruth: "full-chromium-suite",
      criticalRetries: 0,
      confirmedP0OrP1MissAction: "retain full blocking suite and repair critical selection before any demotion",
    },
    outcomes: {
      contract: contractOutcome || "not-run",
      critical: criticalOutcome || "not-run",
      fullChromium: fullOutcome || "not-run",
      crossBrowser: crossBrowserOutcome || "not-run",
      criticalPassed,
      fullPassed,
      miss,
      reviewRequired: miss,
    },
    timing: {
      criticalReadySeconds: latestCompletionSeconds(criticalJobs, run.created_at),
      fullReadySeconds: latestCompletionSeconds(fullJobs, run.created_at),
      fullShards: fullJobs.map((job) => summarizeJob(job, run.created_at)),
      crossBrowser: crossBrowserJobs.map((job) => summarizeJob(job, run.created_at)),
    },
  };
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function main() {
  const runPath = argument("--run");
  const jobsPath = argument("--jobs");
  const outputPath = argument("--output");
  if (!runPath || !jobsPath || !outputPath) {
    throw new Error(
      "Usage: e2e-shadow-evidence.mjs --run <json> --jobs <json> --output <json> [--changed-files <json>]",
    );
  }
  const evidence = aggregateShadowEvidence({
    run: readJson(runPath),
    jobs: readJson(jobsPath),
    changedFiles: argument("--changed-files") ? readJson(argument("--changed-files")) : [],
    fullOutcome: argument("--full-outcome"),
    crossBrowserOutcome: argument("--cross-browser-outcome"),
    criticalOutcome: argument("--critical-outcome"),
    contractOutcome: argument("--contract-outcome"),
  });
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(
    `Shadow evidence: critical=${evidence.outcomes.critical}, full=${evidence.outcomes.fullChromium}, miss=${evidence.outcomes.miss}, critical-ready=${evidence.timing.criticalReadySeconds ?? "n/a"}s, full-ready=${evidence.timing.fullReadySeconds ?? "n/a"}s`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
