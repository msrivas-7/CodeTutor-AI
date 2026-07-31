#!/usr/bin/env tsx
import fs from "node:fs/promises";
import path from "node:path";
import {
  EVAL_DATASET_VERSION,
  EVAL_EVALUATOR_VERSION,
  type EvalBaselineV2,
} from "./evalGate.js";
import {
  EVAL_REPO_ROOT,
  readEvalDatasets,
  sourceVersions,
} from "./evalProvenance.js";
import {
  TUTOR_EVAL_SET_VERSION,
  getModelPolicy,
} from "../src/services/ai/modelRegistry.js";

async function main(): Promise<void> {
  const baseline = JSON.parse(
    await fs.readFile(path.join(EVAL_REPO_ROOT, "eval/baseline-v2.json"), "utf8"),
  ) as EvalBaselineV2;
  const [dataset, versions] = await Promise.all([
    readEvalDatasets(),
    sourceVersions(),
  ]);
  const failures: string[] = [];
  if (baseline.datasetVersion !== EVAL_DATASET_VERSION) {
    failures.push("baseline dataset version is stale");
  }
  if (baseline.evaluatorVersion !== EVAL_EVALUATOR_VERSION) {
    failures.push("baseline evaluator version is stale");
  }
  if (baseline.datasetFingerprint !== dataset.datasetFingerprint) {
    failures.push("eval dataset changed after baseline approval");
  }
  if (baseline.qualityContractFingerprint !== versions.qualityContractFingerprint) {
    failures.push("tutor quality contract changed after baseline approval");
  }
  const policy = getModelPolicy(baseline.approvedModel);
  if (!policy.contextualTutorEligible || policy.qualityStatus !== "evaluated") {
    failures.push("approved model is not contextual-tutor eligible in the registry");
  }
  if (policy.evalSetVersion !== TUTOR_EVAL_SET_VERSION) {
    failures.push("model registry eval version does not match the approved baseline");
  }
  if (failures.length) {
    throw new Error(
      `${failures.join("; ")}. Run the complete independent model gate and review the new baseline before release.`,
    );
  }
  console.log(
    `[eval-v2] approved baseline verified model=${baseline.approvedModel} contract=${versions.qualityContractFingerprint.slice(0, 16)}`,
  );
}

void main().catch((err) => {
  console.error(`[eval-v2] baseline verification failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
