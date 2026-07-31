#!/usr/bin/env tsx
import fs from "node:fs/promises";
import path from "node:path";
import {
  evaluateB3ModelGate,
  type B3RunArtifact,
} from "./b3ModelGate.js";
import {
  EVAL_REPO_ROOT,
  computeB3DecisionGateFingerprint,
  computeQualityContractFingerprint,
  readEvalDatasets,
} from "./evalProvenance.js";
import {
  EVAL_DATASET_VERSION,
  EVAL_EVALUATOR_VERSION,
} from "./evalGate.js";

function pathsFor(argv: string[], flag: string): string[] {
  const index = argv.indexOf(flag);
  if (index < 0 || !argv[index + 1]) {
    throw new Error(`${flag} requires three comma-separated artifact paths`);
  }
  return argv[index + 1].split(",").map((value) => value.trim()).filter(Boolean);
}

async function readRuns(paths: string[]): Promise<B3RunArtifact[]> {
  return Promise.all(
    paths.map(async (file) =>
      JSON.parse(await fs.readFile(path.resolve(file), "utf8")) as B3RunArtifact,
    ),
  );
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const controlRuns = await readRuns(pathsFor(argv, "--control"));
  const candidateRuns = await readRuns(pathsFor(argv, "--candidate"));
  const [
    { datasetFingerprint },
    qualityContractFingerprint,
    decisionGateFingerprint,
  ] = await Promise.all([
    readEvalDatasets(),
    computeQualityContractFingerprint(),
    computeB3DecisionGateFingerprint(),
  ]);
  const report = evaluateB3ModelGate({
    controlRuns,
    candidateRuns,
    expectedProvenance: {
      datasetVersion: EVAL_DATASET_VERSION,
      datasetFingerprint,
      evaluatorVersion: EVAL_EVALUATOR_VERSION,
      qualityContractFingerprint,
    },
    decisionGateFingerprint,
  });
  const outputPath = path.join(EVAL_REPO_ROOT, "eval/b3-model-comparison.json");
  await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`[b3-model-gate] ${report.decision}`);
  console.log(
    `[b3-model-gate] pass rate nano=${(report.control.passRate * 100).toFixed(1)}% mini=${(report.candidate.passRate * 100).toFixed(1)}% delta=${(report.qualityImprovement * 100).toFixed(1)}pp`,
  );
  for (const intent of ["walkthrough", "checkin"] as const) {
    const result = report.intentDecisions[intent];
    console.log(
      `[b3-model-gate] ${intent}=${result.upgrade ? "upgrade" : "retain"} nano=${(result.controlPassRate * 100).toFixed(1)}% mini=${(result.candidatePassRate * 100).toFixed(1)}% delta=${(result.improvement * 100).toFixed(1)}pp`,
    );
    for (const reason of result.reasons) console.log(`  - ${intent}: ${reason}`);
  }
  console.log(
    `[b3-model-gate] cost/pass nano=$${report.control.costPerPassUsd.toFixed(6)} mini=$${report.candidate.costPerPassUsd.toFixed(6)} mixed/day=$${report.mixedCostPerActiveDayUsd.toFixed(4)}`,
  );
  console.log(`[b3-model-gate] report ${outputPath}`);
  if (!report.ok) {
    for (const reason of report.reasons) console.log(`  - ${reason}`);
    process.exitCode = 1;
  }
}

void main().catch((error) => {
  console.error(
    `[b3-model-gate] fatal: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 2;
});
