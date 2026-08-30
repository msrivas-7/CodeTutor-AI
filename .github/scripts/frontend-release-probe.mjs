#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";

function positiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function releaseProbeUrl(baseUrl, expectedSha, attempt, now) {
  const url = new URL(baseUrl);
  url.searchParams.set("candidate", expectedSha);
  url.searchParams.set("probe", `${now}-${attempt}`);
  return url;
}

export async function waitForFrontendRelease({
  url,
  expectedSha,
  deadlineMs = 300_000,
  delayMs = 10_000,
  timeoutMs = 20_000,
  fetchImpl = globalThis.fetch,
  sleepImpl = sleep,
  now = Date.now,
  onAttempt = () => {},
}) {
  if (!url) throw new Error("url is required");
  if (!/^[0-9a-f]{40}$/.test(expectedSha ?? "")) {
    throw new Error("expectedSha must be a full lowercase Git SHA");
  }
  deadlineMs = positiveInteger(deadlineMs, "deadlineMs");
  delayMs = positiveInteger(delayMs, "delayMs");
  timeoutMs = positiveInteger(timeoutMs, "timeoutMs");

  const deadlineAt = now() + deadlineMs;
  let lastObservation = "no response";
  let attempt = 0;
  while (now() < deadlineAt) {
    attempt += 1;
    const probeUrl = releaseProbeUrl(url, expectedSha, attempt, now());
    try {
      const requestBudgetMs = Math.max(1, Math.min(timeoutMs, deadlineAt - now()));
      const response = await fetchImpl(probeUrl, {
        headers: { "cache-control": "no-cache" },
        redirect: "follow",
        signal: AbortSignal.timeout(requestBudgetMs),
      });
      const body = await response.text();
      if (!response.ok) {
        lastObservation = `HTTP ${response.status}`;
      } else {
        try {
          const release = JSON.parse(body);
          lastObservation = typeof release.gitSha === "string"
            ? `gitSha ${release.gitSha}`
            : "JSON without gitSha";
          if (release.gitSha === expectedSha) {
            onAttempt({ attempt, matched: true, observation: lastObservation, url: probeUrl });
            return release;
          }
        } catch {
          lastObservation = "invalid JSON";
        }
      }
    } catch (error) {
      lastObservation = error instanceof Error ? error.message : String(error);
    }

    onAttempt({ attempt, matched: false, observation: lastObservation, url: probeUrl });
    const remainingMs = deadlineAt - now();
    if (remainingMs > 0) await sleepImpl(Math.min(delayMs, remainingMs));
  }

  throw new Error(
    `deployed frontend did not report ${expectedSha} within ${deadlineMs}ms (${attempt} cache-busted probes); last observation: ${lastObservation}`,
  );
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error("arguments must be passed as --name value pairs");
    }
    args[key.slice(2)] = value;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.url || !args["expected-sha"] || !args.output) {
    throw new Error("--url, --expected-sha, and --output are required");
  }

  const release = await waitForFrontendRelease({
    url: args.url,
    expectedSha: args["expected-sha"],
    deadlineMs: args["deadline-ms"] ? Number(args["deadline-ms"]) : undefined,
    delayMs: args["delay-ms"] ? Number(args["delay-ms"]) : undefined,
    timeoutMs: args["timeout-ms"] ? Number(args["timeout-ms"]) : undefined,
    onAttempt: ({ attempt, matched, observation }) => {
      console.log(`Frontend identity probe ${attempt}: ${matched ? "matched" : observation}`);
    },
  });
  await mkdir(dirname(args.output), { recursive: true });
  await writeFile(args.output, `${JSON.stringify(release)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`frontend-release-probe: ${error.message}`);
    process.exitCode = 1;
  });
}
