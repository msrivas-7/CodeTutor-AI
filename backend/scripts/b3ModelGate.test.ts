import { describe, expect, it } from "vitest";
import {
  B3_CANDIDATE_MODEL,
  B3_CONTROL_MODEL,
  B3_JUDGE_MODEL,
  B3_TARGET_CASE_IDS,
  evaluateB3ModelGate,
  type B3CaseResult,
  type B3RunArtifact,
} from "./b3ModelGate.js";
import {
  EVAL_DATASET_VERSION,
  EVAL_EVALUATOR_VERSION,
} from "./evalGate.js";

const walkthroughIds = new Set([
  "g019",
  "g020",
  "g021",
  "g022",
  "g023",
  "g024",
  "r013",
  "r014",
  "r015",
  "r016",
]);

function passingResult(id: string, model: string): B3CaseResult {
  return {
    id,
    intent: walkthroughIds.has(id) ? "walkthrough" : "checkin",
    tags: ["standard"],
    mustPass: false,
    deterministicPass: true,
    deterministicFailures: [],
    helpfulCorrectPass: true,
    posturePass: true,
    tutorModel: model,
    responseLatencyMs: model === B3_CANDIDATE_MODEL ? 4_000 : 2_000,
    inputTokens: 3_000,
    outputTokens: 1_000,
    tutorCostUsd: model === B3_CANDIDATE_MODEL ? 0.0028 : 0.0007,
  };
}

function runs(model: string): B3RunArtifact[] {
  return Array.from({ length: 3 }, (_, runIndex) => ({
    timestamp: `2026-07-31T12:0${runIndex}:00.000Z`,
    tutorModel: model,
    routingPolicyVersion: null,
    tutorModels: [model],
    judgeModel: B3_JUDGE_MODEL,
    datasetVersion: EVAL_DATASET_VERSION,
    datasetFingerprint: "dataset-abc",
    evaluatorVersion: EVAL_EVALUATOR_VERSION,
    qualityContractFingerprint: "contract-abc",
    expectedCaseIds: [...B3_TARGET_CASE_IDS],
    results: B3_TARGET_CASE_IDS.map((id) => passingResult(id, model)),
  }));
}

function failingControl(
  intent: "walkthrough" | "checkin" = "walkthrough",
): B3RunArtifact[] {
  const result = runs(B3_CONTROL_MODEL);
  for (const run of result) {
    for (const item of run.results.filter((item) => item.intent === intent).slice(0, 3)) {
      item.helpfulCorrectPass = false;
    }
  }
  return result;
}

describe("evaluateB3ModelGate", () => {
  it("approves a repeated, practical quality win within cost and latency limits", () => {
    const report = evaluateB3ModelGate({
      controlRuns: failingControl(),
      candidateRuns: runs(B3_CANDIDATE_MODEL),
      generatedAt: "2026-07-31T13:00:00.000Z",
    });

    expect(report.ok).toBe(true);
    expect(report.decision).toBe("upgrade-walkthrough");
    expect(report.upgradedIntents).toEqual(["walkthrough"]);
    expect(report.qualityImprovement).toBeCloseTo(0.15);
    expect(report.mixedCostPerActiveDayUsd).toBeLessThan(0.05);
    expect(report.monthlyCostProjectionUsd["10000"]).toBeGreaterThan(0);
    expect(report.provenance.decisionGateFingerprint).toBe("");
  });

  it("rejects a tie because mini must earn its four-times token price", () => {
    const report = evaluateB3ModelGate({
      controlRuns: runs(B3_CONTROL_MODEL),
      candidateRuns: runs(B3_CANDIDATE_MODEL),
    });

    expect(report.ok).toBe(false);
    expect(report.decision).toBe("retain-control");
    expect(report.reasons).toContain("no target intent independently qualified for upgrade");
    expect(report.intentDecisions.walkthrough.reasons).toContainEqual(
      expect.stringContaining("5 percentage"),
    );
  });

  it("rejects a small aggregate win that is not statistically separated", () => {
    const control = runs(B3_CONTROL_MODEL);
    control[0].results.find((result) => result.intent === "walkthrough")!
      .helpfulCorrectPass = false;
    control[1].results.find((result) => result.intent === "walkthrough")!
      .helpfulCorrectPass = false;
    const report = evaluateB3ModelGate({
      controlRuns: control,
      candidateRuns: runs(B3_CANDIDATE_MODEL),
    });

    expect(report.intentDecisions.walkthrough.upgrade).toBe(false);
    expect(report.intentDecisions.walkthrough.improvement).toBeCloseTo(2 / 30);
    expect(report.intentDecisions.walkthrough.reasons).toContainEqual(
      expect.stringContaining("Fisher exact"),
    );
  });

  it("rejects incomplete repeated evidence", () => {
    const report = evaluateB3ModelGate({
      controlRuns: failingControl().slice(0, 2),
      candidateRuns: runs(B3_CANDIDATE_MODEL),
    });

    expect(report.reasons).toContainEqual(expect.stringContaining("3 independent runs"));
  });

  it("rejects a deterministic candidate failure even if aggregate quality clears", () => {
    const candidate = runs(B3_CANDIDATE_MODEL);
    candidate[0].results[0].deterministicPass = false;
    candidate[0].results[0].deterministicFailures = ["generic fallback"];
    const report = evaluateB3ModelGate({
      controlRuns: failingControl(),
      candidateRuns: candidate,
    });

    expect(report.intentDecisions.walkthrough.reasons).toContain(
      "candidate has a deterministic policy or safety failure",
    );
  });

  it("rejects provenance drift and missing cost evidence", () => {
    const candidate = runs(B3_CANDIDATE_MODEL);
    const control = failingControl();
    candidate[1].qualityContractFingerprint = "different";
    control[2].results[0].tutorCostUsd = undefined;
    const report = evaluateB3ModelGate({
      controlRuns: control,
      candidateRuns: candidate,
    });

    expect(report.reasons).toContain("all comparison runs must share qualityContractFingerprint");
    expect(report.reasons).toContainEqual(expect.stringContaining("missing token or cost"));
  });

  it("rejects a per-result model that contradicts the run model", () => {
    const candidate = runs(B3_CANDIDATE_MODEL);
    candidate[0].results[0].tutorModel = B3_CONTROL_MODEL;
    const report = evaluateB3ModelGate({
      controlRuns: failingControl(),
      candidateRuns: candidate,
    });

    expect(report.reasons).toContainEqual(
      expect.stringContaining(
        `result model ${B3_CONTROL_MODEL} does not match ${B3_CANDIDATE_MODEL}`,
      ),
    );
  });

  it("rejects a candidate that breaches the mixed daily budget", () => {
    const candidate = runs(B3_CANDIDATE_MODEL);
    for (const run of candidate) {
      for (const result of run.results) result.tutorCostUsd = 0.01;
    }
    const report = evaluateB3ModelGate({
      controlRuns: failingControl(),
      candidateRuns: candidate,
    });

    expect(report.reasons).toContainEqual(expect.stringContaining("$0.005"));
    expect(report.reasons).toContainEqual(expect.stringContaining("$0.05"));
  });

  it("upgrades check-in without averaging away a walkthrough tie", () => {
    const report = evaluateB3ModelGate({
      controlRuns: failingControl("checkin"),
      candidateRuns: runs(B3_CANDIDATE_MODEL),
    });

    expect(report.ok).toBe(true);
    expect(report.decision).toBe("upgrade-checkin");
    expect(report.upgradedIntents).toEqual(["checkin"]);
    expect(report.intentDecisions.walkthrough.upgrade).toBe(false);
    expect(report.intentDecisions.checkin.improvement).toBeCloseTo(0.3);
  });
});
