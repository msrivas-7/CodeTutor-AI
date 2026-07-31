#!/usr/bin/env tsx
import fs from "node:fs/promises";
import path from "node:path";
import {
  EVAL_DATASET_VERSION,
  EVAL_EVALUATOR_VERSION,
  EVAL_INTENTS,
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
  isModelEvaluatedForTutorIntent,
} from "../src/services/ai/modelRegistry.js";
import {
  PLATFORM_TUTOR_ROUTING_POLICY_VERSION,
  platformTutorModelForIntent,
} from "../src/services/ai/modelRouting.js";
import { DEFAULT_JUDGE_MODEL } from "./judgeModel.js";

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
    failures.push(
      `tutor quality contract changed after baseline approval (approved=${baseline.qualityContractFingerprint.slice(0, 16)}, current=${versions.qualityContractFingerprint.slice(0, 16)})`,
    );
  }
  if (
    baseline.approvedRoutingPolicyVersion !==
      PLATFORM_TUTOR_ROUTING_POLICY_VERSION ||
    baseline.approvedModel !== PLATFORM_TUTOR_ROUTING_POLICY_VERSION
  ) {
    failures.push("approved tutor routing policy is stale");
  }
  if (baseline.approvedJudgeModel !== DEFAULT_JUDGE_MODEL) {
    failures.push("approved judge model is stale");
  }
  const expectedModels = new Set<string>();
  for (const intent of EVAL_INTENTS) {
    const model = platformTutorModelForIntent(intent);
    expectedModels.add(model);
    if (baseline.approvedModelByIntent?.[intent] !== model) {
      failures.push(`${intent} baseline model does not match production routing`);
    }
    if (!isModelEvaluatedForTutorIntent(model, intent)) {
      failures.push(`${model} is not evaluated for routed ${intent} use`);
    }
    const policy = getModelPolicy(model);
    if (policy.evalSetVersion !== TUTOR_EVAL_SET_VERSION) {
      failures.push(`${model} registry eval version does not match the approved baseline`);
    }
  }
  const baselineModels = new Set(baseline.approvedModels ?? []);
  if (
    baselineModels.size !== expectedModels.size ||
    [...expectedModels].some((model) => !baselineModels.has(model))
  ) {
    failures.push("approved model set does not match production routing");
  }
  if (failures.length) {
    throw new Error(
      `${failures.join("; ")}. Run the complete independent model gate and review the new baseline before release.`,
    );
  }
  console.log(
    `[eval-v2] approved baseline verified tutor=${baseline.approvedModel} contract=${versions.qualityContractFingerprint.slice(0, 16)}`,
  );
}

void main().catch((err) => {
  console.error(`[eval-v2] baseline verification failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
