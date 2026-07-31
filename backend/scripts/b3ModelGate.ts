import type {
  EvalCaseResultV2,
  EvalIntent,
  EvalSummaryV2,
} from "./evalGate.js";

export const B3_CONTROL_MODEL = "gpt-4.1-nano";
export const B3_CANDIDATE_MODEL = "gpt-4.1-mini";
export const B3_JUDGE_MODEL = "gpt-4.1";
export const B3_REPEATS_PER_MODEL = 3;
export const B3_MIN_IMPROVEMENT = 0.05;
export const B3_MIN_CANDIDATE_PASS_RATE = 0.95;
export const B3_MAX_ONE_SIDED_P_VALUE = 0.05;
export const B3_MAX_P95_LATENCY_MS = 15_000;
export const B3_MAX_LATENCY_MULTIPLIER = 2.5;
export const B3_MAX_COST_PER_PASS_USD = 0.005;
export const B3_MAX_MIXED_COST_PER_ACTIVE_DAY_USD = 0.05;
export const B3_HEAVY_CALLS_PER_ACTIVE_DAY = 30;
export const B3_PER_INTENT_TRAFFIC_SHARE = 1 / 6;
export const B3_PROJECTION_DAU = [100, 500, 1_000, 10_000] as const;

export const B3_TARGET_CASE_IDS = [
  "g019",
  "g020",
  "g021",
  "g022",
  "g023",
  "g024",
  "g025",
  "g026",
  "g027",
  "g028",
  "g029",
  "g030",
  "r007",
  "r013",
  "r014",
  "r015",
  "r016",
  "r017",
  "r018",
  "r019",
] as const;

export interface B3CaseResult extends EvalCaseResultV2 {
  responseLatencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  tutorCostUsd?: number;
}

export interface B3RunArtifact extends EvalSummaryV2 {
  timestamp: string;
  judgeModel: string;
  results: B3CaseResult[];
}

export interface B3ModelStats {
  model: string;
  samples: number;
  passRate: number;
  passRateByIntent: Record<"walkthrough" | "checkin", number>;
  meanLatencyMs: number;
  p95LatencyMs: number;
  meanInputTokens: number;
  meanOutputTokens: number;
  meanCostUsd: number;
  costPerPassUsd: number;
}

export interface B3GateReport {
  ok: boolean;
  decision:
    | "upgrade-both"
    | "upgrade-walkthrough"
    | "upgrade-checkin"
    | "retain-control";
  upgradedIntents: Array<"walkthrough" | "checkin">;
  intentDecisions: Record<
    "walkthrough" | "checkin",
    {
      upgrade: boolean;
      controlPassRate: number;
      candidatePassRate: number;
      improvement: number;
      reasons: string[];
    }
  >;
  generatedAt: string;
  thresholds: {
    repeatsPerModel: number;
    minimumImprovement: number;
    minimumCandidatePassRate: number;
    maximumOneSidedPValue: number;
    maximumP95LatencyMs: number;
    maximumLatencyMultiplier: number;
    maximumCostPerPassUsd: number;
    maximumMixedCostPerActiveDayUsd: number;
  };
  reasons: string[];
  control: B3ModelStats;
  candidate: B3ModelStats;
  qualityImprovement: number;
  mixedCostPerActiveDayUsd: number;
  monthlyCostProjectionUsd: Record<string, number>;
  provenance: {
    datasetVersion: string;
    datasetFingerprint: string;
    evaluatorVersion: string;
    qualityContractFingerprint: string;
    decisionGateFingerprint: string;
    judgeModel: string;
    targetCaseIds: string[];
    controlRunTimestamps: string[];
    candidateRunTimestamps: string[];
  };
}

const TARGET_INTENTS = ["walkthrough", "checkin"] as const;

function passes(result: B3CaseResult): boolean {
  return (
    !result.errorMessage &&
    result.deterministicPass &&
    result.helpfulCorrectPass &&
    result.posturePass
  );
}

function mean(values: number[]): number {
  return values.length
    ? values.reduce((total, value) => total + value, 0) / values.length
    : 0;
}

function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
}

function rate(results: B3CaseResult[]): number {
  return results.length ? results.filter(passes).length / results.length : 0;
}

function combination(total: number, chosen: number): number {
  if (chosen < 0 || chosen > total) return 0;
  const reduced = Math.min(chosen, total - chosen);
  let value = 1;
  for (let index = 1; index <= reduced; index += 1) {
    value = (value * (total - reduced + index)) / index;
  }
  return value;
}

/** One-sided Fisher exact p-value for candidate success > control success. */
function improvementPValue(
  candidateSuccesses: number,
  candidateTotal: number,
  controlSuccesses: number,
  controlTotal: number,
): number {
  const totalSuccesses = candidateSuccesses + controlSuccesses;
  const totalFailures = candidateTotal + controlTotal - totalSuccesses;
  const maximumCandidateSuccesses = Math.min(candidateTotal, totalSuccesses);
  const denominator = combination(candidateTotal + controlTotal, candidateTotal);
  let probability = 0;
  for (
    let successes = candidateSuccesses;
    successes <= maximumCandidateSuccesses;
    successes += 1
  ) {
    probability +=
      (combination(totalSuccesses, successes) *
        combination(totalFailures, candidateTotal - successes)) /
      denominator;
  }
  return Math.min(1, probability);
}

function stats(runs: B3RunArtifact[], model: string): B3ModelStats {
  const results = runs.flatMap((run) => run.results);
  const passing = results.filter(passes).length;
  const observedCosts = results.flatMap((result) =>
    result.tutorCostUsd == null ? [] : [result.tutorCostUsd],
  );
  const meanCostUsd = mean(observedCosts);
  // A malformed model response can fail after the provider has already billed
  // it. Estimate a missing failed-call cost at the observed model mean rather
  // than pretending it cost zero and making the less reliable model cheaper.
  const estimatedTotalCost = meanCostUsd * results.length;
  return {
    model,
    samples: results.length,
    passRate: rate(results),
    passRateByIntent: Object.fromEntries(
      TARGET_INTENTS.map((intent) => [
        intent,
        rate(results.filter((result) => result.intent === intent)),
      ]),
    ) as Record<"walkthrough" | "checkin", number>,
    meanLatencyMs: mean(results.map((result) => result.responseLatencyMs)),
    p95LatencyMs: percentile(
      results.map((result) => result.responseLatencyMs),
      0.95,
    ),
    meanInputTokens: mean(
      results.flatMap((result) =>
        result.inputTokens == null ? [] : [result.inputTokens],
      ),
    ),
    meanOutputTokens: mean(
      results.flatMap((result) =>
        result.outputTokens == null ? [] : [result.outputTokens],
      ),
    ),
    meanCostUsd,
    costPerPassUsd:
      passing > 0 ? estimatedTotalCost / passing : Number.POSITIVE_INFINITY,
  };
}

function validateRuns(
  runs: B3RunArtifact[],
  expectedModel: string,
  reasons: string[],
): void {
  if (runs.length !== B3_REPEATS_PER_MODEL) {
    reasons.push(
      `${expectedModel}: requires ${B3_REPEATS_PER_MODEL} independent runs; found ${runs.length}`,
    );
  }
  if (new Set(runs.map((run) => run.timestamp)).size !== runs.length) {
    reasons.push(`${expectedModel}: run timestamps must be unique`);
  }
  const targetIds = new Set<string>(B3_TARGET_CASE_IDS);
  for (const [index, run] of runs.entries()) {
    const label = `${expectedModel} run ${index + 1}`;
    if (run.tutorModel !== expectedModel) {
      reasons.push(`${label}: unexpected tutor model ${run.tutorModel}`);
    }
    if (run.judgeModel !== B3_JUDGE_MODEL) {
      reasons.push(`${label}: judge must be ${B3_JUDGE_MODEL}`);
    }
    const actualIds = new Set(run.results.map((result) => result.id));
    if (
      run.results.length !== B3_TARGET_CASE_IDS.length ||
      actualIds.size !== B3_TARGET_CASE_IDS.length ||
      [...targetIds].some((id) => !actualIds.has(id))
    ) {
      reasons.push(`${label}: requires the exact 20-case B3 target set`);
    }
    for (const intent of TARGET_INTENTS) {
      if (run.results.filter((result) => result.intent === intent).length !== 10) {
        reasons.push(`${label}: requires exactly 10 ${intent} cases`);
      }
    }
    for (const result of run.results) {
      if (result.tutorModel !== expectedModel) {
        reasons.push(
          `${label}/${result.id}: result model ${result.tutorModel} does not match ${expectedModel}`,
        );
      }
      if (!TARGET_INTENTS.includes(result.intent as (typeof TARGET_INTENTS)[number])) {
        reasons.push(`${label}: unexpected intent ${result.intent}`);
      }
      if (
        !Number.isFinite(result.responseLatencyMs) ||
        result.responseLatencyMs <= 0
      ) {
        reasons.push(`${label}/${result.id}: missing response latency`);
      }
      const missingCostEvidence =
        !Number.isFinite(result.inputTokens) ||
        !Number.isFinite(result.outputTokens) ||
        !Number.isFinite(result.tutorCostUsd);
      if (missingCostEvidence) {
        reasons.push(`${label}/${result.id}: missing token or cost evidence`);
      }
    }
  }
}

function validateProvenance(
  runs: B3RunArtifact[],
  reasons: string[],
): void {
  const fields = [
    "datasetVersion",
    "datasetFingerprint",
    "evaluatorVersion",
    "qualityContractFingerprint",
  ] as const;
  for (const field of fields) {
    if (new Set(runs.map((run) => run[field])).size !== 1) {
      reasons.push(`all comparison runs must share ${field}`);
    }
  }
}

/**
 * B3 decision gate. Each routed intent must independently earn promotion: a
 * win on check-ins cannot average away a walkthrough regression (or vice
 * versa). A tie is intentionally a rejection because mini costs 4x/token.
 */
export function evaluateB3ModelGate(input: {
  controlRuns: B3RunArtifact[];
  candidateRuns: B3RunArtifact[];
  generatedAt?: string;
  expectedProvenance?: {
    datasetVersion: string;
    datasetFingerprint: string;
    evaluatorVersion: string;
    qualityContractFingerprint: string;
  };
  decisionGateFingerprint?: string;
}): B3GateReport {
  const reasons: string[] = [];
  validateRuns(input.controlRuns, B3_CONTROL_MODEL, reasons);
  validateRuns(input.candidateRuns, B3_CANDIDATE_MODEL, reasons);
  const allRuns = [...input.controlRuns, ...input.candidateRuns];
  validateProvenance(allRuns, reasons);
  const firstRun = allRuns[0];
  if (input.expectedProvenance && firstRun) {
    for (const field of [
      "datasetVersion",
      "datasetFingerprint",
      "evaluatorVersion",
      "qualityContractFingerprint",
    ] as const) {
      if (firstRun[field] !== input.expectedProvenance[field]) {
        reasons.push(`comparison artifacts do not match current ${field}`);
      }
    }
  }

  const control = stats(input.controlRuns, B3_CONTROL_MODEL);
  const candidate = stats(input.candidateRuns, B3_CANDIDATE_MODEL);
  const qualityImprovement = candidate.passRate - control.passRate;
  const intentDecisions = Object.fromEntries(
    TARGET_INTENTS.map((intent) => {
      const intentReasons: string[] = [];
      const candidatePassRate = candidate.passRateByIntent[intent];
      const controlPassRate = control.passRateByIntent[intent];
      const improvement = candidatePassRate - controlPassRate;
      const candidateResults = input.candidateRuns.flatMap((run) =>
        run.results.filter((result) => result.intent === intent),
      );
      const controlResults = input.controlRuns.flatMap((run) =>
        run.results.filter((result) => result.intent === intent),
      );
      const pValue = improvementPValue(
        candidateResults.filter(passes).length,
        candidateResults.length,
        controlResults.filter(passes).length,
        controlResults.length,
      );
      if (candidatePassRate < B3_MIN_CANDIDATE_PASS_RATE) {
        intentReasons.push("candidate pass rate is below 95%");
      }
      if (improvement + Number.EPSILON < B3_MIN_IMPROVEMENT) {
        intentReasons.push(
          "candidate did not improve pass rate by at least 5 percentage points",
        );
      }
      if (pValue > B3_MAX_ONE_SIDED_P_VALUE) {
        intentReasons.push(
          `candidate improvement is not significant by one-sided Fisher exact test (p=${pValue.toFixed(4)})`,
        );
      }
      if (
        input.candidateRuns.some((run) =>
          run.results.some(
            (result) => result.intent === intent && !result.deterministicPass,
          ),
        )
      ) {
        intentReasons.push("candidate has a deterministic policy or safety failure");
      }
      return [
        intent,
        {
          upgrade: intentReasons.length === 0,
          controlPassRate,
          candidatePassRate,
          improvement,
          reasons: intentReasons,
        },
      ];
    }),
  ) as B3GateReport["intentDecisions"];
  const qualifiedIntents = TARGET_INTENTS.filter(
    (intent) => intentDecisions[intent].upgrade,
  );
  if (candidate.p95LatencyMs > B3_MAX_P95_LATENCY_MS) {
    reasons.push("candidate p95 latency exceeds 15 seconds");
  }
  if (
    control.p95LatencyMs > 0 &&
    candidate.p95LatencyMs > control.p95LatencyMs * B3_MAX_LATENCY_MULTIPLIER
  ) {
    reasons.push("candidate p95 latency exceeds 2.5x control");
  }
  if (candidate.costPerPassUsd > B3_MAX_COST_PER_PASS_USD) {
    reasons.push("candidate cost per passing outcome exceeds $0.005");
  }

  const miniCalls =
    B3_HEAVY_CALLS_PER_ACTIVE_DAY *
    B3_PER_INTENT_TRAFFIC_SHARE *
    qualifiedIntents.length;
  const nanoCalls = B3_HEAVY_CALLS_PER_ACTIVE_DAY - miniCalls;
  const mixedCostPerActiveDayUsd =
    candidate.meanCostUsd * miniCalls + control.meanCostUsd * nanoCalls;
  if (mixedCostPerActiveDayUsd > B3_MAX_MIXED_COST_PER_ACTIVE_DAY_USD) {
    reasons.push("projected mixed routing exceeds $0.05 per AI-active learner/day");
  }
  const monthlyCostProjectionUsd = Object.fromEntries(
    B3_PROJECTION_DAU.map((dau) => [
      String(dau),
      mixedCostPerActiveDayUsd * dau * 30,
    ]),
  );
  const first = allRuns[0];
  if (qualifiedIntents.length === 0) {
    reasons.push("no target intent independently qualified for upgrade");
  }
  const upgradedIntents = reasons.length === 0 ? qualifiedIntents : [];
  const decision = upgradedIntents.length === 2
    ? "upgrade-both"
    : upgradedIntents[0] === "walkthrough"
      ? "upgrade-walkthrough"
      : upgradedIntents[0] === "checkin"
        ? "upgrade-checkin"
        : "retain-control";
  return {
    ok: reasons.length === 0,
    decision,
    upgradedIntents,
    intentDecisions,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    thresholds: {
      repeatsPerModel: B3_REPEATS_PER_MODEL,
      minimumImprovement: B3_MIN_IMPROVEMENT,
      minimumCandidatePassRate: B3_MIN_CANDIDATE_PASS_RATE,
      maximumOneSidedPValue: B3_MAX_ONE_SIDED_P_VALUE,
      maximumP95LatencyMs: B3_MAX_P95_LATENCY_MS,
      maximumLatencyMultiplier: B3_MAX_LATENCY_MULTIPLIER,
      maximumCostPerPassUsd: B3_MAX_COST_PER_PASS_USD,
      maximumMixedCostPerActiveDayUsd:
        B3_MAX_MIXED_COST_PER_ACTIVE_DAY_USD,
    },
    reasons,
    control,
    candidate,
    qualityImprovement,
    mixedCostPerActiveDayUsd,
    monthlyCostProjectionUsd,
    provenance: {
      datasetVersion: first?.datasetVersion ?? "",
      datasetFingerprint: first?.datasetFingerprint ?? "",
      evaluatorVersion: first?.evaluatorVersion ?? "",
      qualityContractFingerprint: first?.qualityContractFingerprint ?? "",
      decisionGateFingerprint: input.decisionGateFingerprint ?? "",
      judgeModel: B3_JUDGE_MODEL,
      targetCaseIds: [...B3_TARGET_CASE_IDS],
      controlRunTimestamps: input.controlRuns.map((run) => run.timestamp),
      candidateRunTimestamps: input.candidateRuns.map((run) => run.timestamp),
    },
  };
}
