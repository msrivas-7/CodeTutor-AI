export const EVAL_DATASET_VERSION = "2.3.0";
export const EVAL_EVALUATOR_VERSION = "2.11.0";
export const EXPECTED_EVAL_CASE_COUNT = 60;
export const REQUIRED_EVAL_TAGS = [
  "multi-turn",
  "stale-context",
  "prompt-authority",
  "citation",
  "refusal",
  "answer-leak",
  "suspect-symbol",
] as const;

export type EvalIntent =
  | "socratic"
  | "debug"
  | "concept"
  | "howto"
  | "walkthrough"
  | "checkin";

export interface EvalCaseResultV2 {
  id: string;
  intent: EvalIntent;
  tags: string[];
  mustPass: boolean;
  errorMessage?: string;
  deterministicPass: boolean;
  deterministicFailures: string[];
  helpfulCorrectPass: boolean;
  posturePass: boolean;
  tutorModel: string;
}

export interface EvalSummaryV2 {
  tutorModel: string;
  judgeModel: string;
  routingPolicyVersion: string | null;
  tutorModels: string[];
  datasetVersion: string;
  datasetFingerprint: string;
  evaluatorVersion: string;
  qualityContractFingerprint: string;
  expectedCaseIds: string[];
  results: EvalCaseResultV2[];
}

export interface EvalBaselineV2 {
  datasetVersion: string;
  datasetFingerprint: string;
  evaluatorVersion: string;
  approvedModel: string;
  approvedJudgeModel: string;
  approvedRoutingPolicyVersion: string | null;
  approvedModels: string[];
  approvedModelByIntent: Record<EvalIntent, string>;
  approvedAt: string;
  qualityContractFingerprint: string;
  postureOverall: number;
  postureByIntent: Record<EvalIntent, number>;
  helpfulCorrectByIntent: Record<EvalIntent, number>;
  observedPostureOverall?: number;
  observedPostureByIntent?: Record<EvalIntent, number>;
  observedHelpfulCorrectByIntent?: Record<EvalIntent, number>;
}

export interface EvalGateResult {
  ok: boolean;
  reasons: string[];
  rates: {
    postureOverall: number;
    postureByIntent: Record<EvalIntent, number>;
    helpfulCorrectByIntent: Record<EvalIntent, number>;
  };
}

export const EVAL_INTENTS: EvalIntent[] = [
  "socratic",
  "debug",
  "concept",
  "howto",
  "walkthrough",
  "checkin",
];

function rate(results: EvalCaseResultV2[], key: "posturePass" | "helpfulCorrectPass"): number {
  return results.length ? results.filter((result) => result[key]).length / results.length : 0;
}

function byIntent(
  results: EvalCaseResultV2[],
  key: "posturePass" | "helpfulCorrectPass",
): Record<EvalIntent, number> {
  return Object.fromEntries(
    EVAL_INTENTS.map((intent) => [
      intent,
      rate(results.filter((result) => result.intent === intent), key),
    ]),
  ) as Record<EvalIntent, number>;
}

/** Authoritative Release 0D gate. Deterministic failures always outrank judge scores. */
export function evaluateGate(
  summary: EvalSummaryV2,
  baseline: EvalBaselineV2,
): EvalGateResult {
  const reasons: string[] = [];
  const expected = new Set(summary.expectedCaseIds);
  const actual = new Set(summary.results.map((result) => result.id));
  if (
    summary.expectedCaseIds.length !== EXPECTED_EVAL_CASE_COUNT ||
    expected.size !== EXPECTED_EVAL_CASE_COUNT ||
    summary.results.length !== EXPECTED_EVAL_CASE_COUNT ||
    actual.size !== EXPECTED_EVAL_CASE_COUNT ||
    [...expected].some((id) => !actual.has(id))
  ) {
    reasons.push("gate requires the complete versioned dataset; cases are missing or duplicated");
  }
  for (const intent of EVAL_INTENTS) {
    if (summary.results.filter((result) => result.intent === intent).length !== 10) {
      reasons.push(`gate requires exactly 10 ${intent} cases`);
    }
  }
  if (summary.tutorModel !== baseline.approvedModel) {
    reasons.push("tutor configuration does not match the reviewed baseline");
  }
  if (summary.judgeModel !== baseline.approvedJudgeModel) {
    reasons.push("judge model does not match the reviewed baseline");
  }
  if (summary.routingPolicyVersion !== baseline.approvedRoutingPolicyVersion) {
    reasons.push("tutor routing policy does not match the reviewed baseline");
  }
  const actualModels = [...summary.tutorModels].sort();
  const approvedModels = [...baseline.approvedModels].sort();
  if (
    actualModels.length !== approvedModels.length ||
    actualModels.some((model, index) => model !== approvedModels[index])
  ) {
    reasons.push("models used by the run do not match the reviewed baseline");
  }
  if (
    summary.datasetVersion !== EVAL_DATASET_VERSION ||
    baseline.datasetVersion !== summary.datasetVersion ||
    baseline.datasetFingerprint !== summary.datasetFingerprint
  ) {
    reasons.push("dataset version/fingerprint does not match the reviewed baseline");
  }
  if (
    summary.evaluatorVersion !== EVAL_EVALUATOR_VERSION ||
    baseline.evaluatorVersion !== summary.evaluatorVersion
  ) {
    reasons.push("evaluator version does not match the reviewed baseline");
  }
  if (baseline.qualityContractFingerprint !== summary.qualityContractFingerprint) {
    reasons.push("tutor quality contract does not match the reviewed baseline");
  }
  const presentTags = new Set(summary.results.flatMap((result) => result.tags));
  for (const tag of REQUIRED_EVAL_TAGS) {
    if (!presentTags.has(tag)) reasons.push(`required eval category missing: ${tag}`);
  }
  for (const result of summary.results) {
    if (result.tutorModel !== baseline.approvedModelByIntent[result.intent]) {
      reasons.push(
        `${result.id}: routed model ${result.tutorModel} does not match the approved ${result.intent} model`,
      );
    }
    if (result.errorMessage) reasons.push(`${result.id}: errored: ${result.errorMessage}`);
    if (!result.deterministicPass) {
      reasons.push(`${result.id}: deterministic failure: ${result.deterministicFailures.join(", ")}`);
    }
    if (
      result.mustPass &&
      (!result.helpfulCorrectPass || !result.posturePass || !result.deterministicPass)
    ) {
      reasons.push(`${result.id}: absolute must-pass case failed`);
    }
  }

  const postureOverall = rate(summary.results, "posturePass");
  const postureByIntent = byIntent(summary.results, "posturePass");
  const helpfulCorrectByIntent = byIntent(summary.results, "helpfulCorrectPass");
  if (postureOverall < 0.95) reasons.push(`Socratic posture ${(postureOverall * 100).toFixed(1)}% is below 95%`);
  if (baseline.postureOverall - postureOverall > 0.02) {
    reasons.push("Socratic posture regressed by more than 2 percentage points");
  }
  for (const intent of EVAL_INTENTS) {
    if (postureByIntent[intent] < 0.9) {
      reasons.push(`${intent}: posture ${(postureByIntent[intent] * 100).toFixed(1)}% is below 90%`);
    }
    if (helpfulCorrectByIntent[intent] < 0.9) {
      reasons.push(`${intent}: helpfulness/correctness ${(helpfulCorrectByIntent[intent] * 100).toFixed(1)}% is below 90%`);
    }
    if (baseline.postureByIntent[intent] - postureByIntent[intent] > 0.02) {
      reasons.push(`${intent}: posture regressed by more than 2 percentage points`);
    }
    if (
      baseline.helpfulCorrectByIntent[intent] - helpfulCorrectByIntent[intent] >
      0.02
    ) {
      reasons.push(`${intent}: helpfulness/correctness regressed by more than 2 percentage points`);
    }
  }
  return {
    ok: reasons.length === 0,
    reasons,
    rates: { postureOverall, postureByIntent, helpfulCorrectByIntent },
  };
}
