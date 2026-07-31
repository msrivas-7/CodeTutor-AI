#!/usr/bin/env tsx
import {
  evaluateSuspectApiCalibration,
  loadSuspectApiCalibration,
} from "./suspectApiCalibration.js";

async function main(): Promise<void> {
  const corpus = await loadSuspectApiCalibration();
  const result = evaluateSuspectApiCalibration(corpus);
  console.log(
    `[suspect-api] corpus=${corpus.version} cases=${corpus.cases.length} ` +
      `precision=${(result.metrics.precision * 100).toFixed(1)}% ` +
      `recall=${(result.metrics.recall * 100).toFixed(1)}% ` +
      `exact=${(result.metrics.exactCaseAccuracy * 100).toFixed(1)}% ` +
      `clean=${(result.metrics.cleanCaseRate * 100).toFixed(1)}%`,
  );
  if (!result.ok) {
    for (const failure of result.failures) console.error(`[suspect-api] ${failure}`);
    for (const entry of result.cases.filter((item) => !item.exact)) {
      console.error(
        `[suspect-api] ${entry.id} expected=${entry.expected.join(",") || "none"} ` +
          `actual=${entry.actual.join(",") || "none"}`,
      );
    }
    process.exitCode = 1;
    return;
  }
  console.log("[suspect-api] calibration gate passed");
}

void main().catch((error) => {
  console.error(
    `[suspect-api] fatal: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 2;
});
