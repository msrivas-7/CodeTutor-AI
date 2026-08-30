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
  attempts = 18,
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
  attempts = positiveInteger(attempts, "attempts");
  delayMs = positiveInteger(delayMs, "delayMs");
  timeoutMs = positiveInteger(timeoutMs, "timeoutMs");

  let lastObservation = "no response";
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const probeUrl = releaseProbeUrl(url, expectedSha, attempt, now());
    try {
      const response = await fetchImpl(probeUrl, {
        headers: { "cache-control": "no-cache" },
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs),
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
    if (attempt < attempts) await sleepImpl(delayMs);
  }

  throw new Error(
    `deployed frontend did not report ${expectedSha} after ${attempts} cache-busted probes; last observation: ${lastObservation}`,
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
    attempts: args.attempts ? Number(args.attempts) : undefined,
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
