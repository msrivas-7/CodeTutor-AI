import { describe, expect, it } from "vitest";
import {
  EVAL_DATASET_VERSION,
  EVAL_EVALUATOR_VERSION,
  evaluateGate,
  type EvalBaselineV2,
  type EvalCaseResultV2,
  type EvalIntent,
  type EvalSummaryV2,
} from "./evalGate.js";

const intents: EvalIntent[] = ["socratic", "debug", "concept", "howto", "walkthrough", "checkin"];
const tags = [
  "multi-turn",
  "stale-context",
  "prompt-authority",
  "citation",
  "refusal",
  "answer-leak",
  "suspect-symbol",
];

function passingResult(id: string, intent: EvalIntent): EvalCaseResultV2 {
  return {
    id,
    intent,
    tags,
    mustPass: false,
    deterministicPass: true,
    deterministicFailures: [],
    helpfulCorrectPass: true,
    posturePass: true,
    tutorModel: "gpt-4.1-nano",
  };
}

function fixture(): { summary: EvalSummaryV2; baseline: EvalBaselineV2 } {
  const results = intents.flatMap((intent) =>
    Array.from({ length: 10 }, (_, index) => passingResult(`${intent}-${index}`, intent)),
  );
  const rates = Object.fromEntries(intents.map((intent) => [intent, 1])) as Record<EvalIntent, number>;
  return {
    summary: {
      tutorModel: "gpt-4.1-nano",
      judgeModel: "gpt-4.1",
      routingPolicyVersion: null,
      tutorModels: ["gpt-4.1-nano"],
      datasetVersion: EVAL_DATASET_VERSION,
      datasetFingerprint: "abc",
      evaluatorVersion: EVAL_EVALUATOR_VERSION,
      qualityContractFingerprint: "contract-abc",
      expectedCaseIds: results.map((result) => result.id),
      results,
    },
    baseline: {
      datasetVersion: EVAL_DATASET_VERSION,
      datasetFingerprint: "abc",
      evaluatorVersion: EVAL_EVALUATOR_VERSION,
      approvedModel: "gpt-4.1-nano",
      approvedJudgeModel: "gpt-4.1",
      approvedRoutingPolicyVersion: null,
      approvedModels: ["gpt-4.1-nano"],
      approvedModelByIntent: Object.fromEntries(
        intents.map((intent) => [intent, "gpt-4.1-nano"]),
      ) as Record<EvalIntent, string>,
      approvedAt: "2026-07-30",
      qualityContractFingerprint: "contract-abc",
      postureOverall: 1,
      postureByIntent: rates,
      helpfulCorrectByIntent: rates,
    },
  };
}

describe("evaluateGate", () => {
  it("accepts a complete passing run", () => {
    const { summary, baseline } = fixture();
    expect(evaluateGate(summary, baseline).ok).toBe(true);
  });

  it("fails a deliberately removed case", () => {
    const { summary, baseline } = fixture();
    summary.results.pop();
    expect(evaluateGate(summary, baseline).reasons).toContainEqual(
      expect.stringContaining("complete versioned dataset"),
    );
  });

  it("fails a duplicated case even when every expected id remains present", () => {
    const { summary, baseline } = fixture();
    summary.results.push({ ...summary.results[0] });
    expect(evaluateGate(summary, baseline).reasons).toContainEqual(
      expect.stringContaining("missing or duplicated"),
    );
  });

  it("fails a model that was not the reviewed baseline model", () => {
    const { summary, baseline } = fixture();
    summary.tutorModel = "gpt-4.1-mini";
    expect(evaluateGate(summary, baseline).reasons).toContainEqual(
      expect.stringContaining("tutor configuration"),
    );
  });

  it("fails a judge that was not the reviewed baseline judge", () => {
    const { summary, baseline } = fixture();
    summary.judgeModel = "weaker-judge";
    expect(evaluateGate(summary, baseline).reasons).toContainEqual(
      expect.stringContaining("judge model"),
    );
  });

  it("fails when any case bypasses the approved per-intent route", () => {
    const { summary, baseline } = fixture();
    summary.results.find((result) => result.intent === "checkin")!.tutorModel =
      "gpt-4.1-mini";
    expect(evaluateGate(summary, baseline).reasons).toContainEqual(
      expect.stringContaining("does not match the approved checkin model"),
    );
  });

  it("fails when tutor policy code does not match the approved run", () => {
    const { summary, baseline } = fixture();
    summary.qualityContractFingerprint = "changed";
    expect(evaluateGate(summary, baseline).reasons).toContainEqual(
      expect.stringContaining("quality contract"),
    );
  });

  it("fails hidden errors instead of shrinking the denominator", () => {
    const { summary, baseline } = fixture();
    summary.results[0].errorMessage = "judge timeout";
    expect(evaluateGate(summary, baseline).reasons).toContainEqual(
      expect.stringContaining("errored"),
    );
  });

  it("fails a seeded deterministic answer leak even with perfect judge scores", () => {
    const { summary, baseline } = fixture();
    summary.results[0].deterministicPass = false;
    summary.results[0].deterministicFailures = ["answer leak"];
    expect(evaluateGate(summary, baseline).reasons).toContainEqual(
      expect.stringContaining("deterministic failure"),
    );
  });

  it("fails an absolute must-pass regression", () => {
    const { summary, baseline } = fixture();
    summary.results[0].mustPass = true;
    summary.results[0].posturePass = false;
    expect(evaluateGate(summary, baseline).reasons).toContainEqual(
      expect.stringContaining("absolute must-pass"),
    );
  });

  it("fails a per-intent quality floor that an aggregate could hide", () => {
    const { summary, baseline } = fixture();
    for (const result of summary.results.filter((item) => item.intent === "checkin").slice(0, 2)) {
      result.helpfulCorrectPass = false;
    }
    expect(evaluateGate(summary, baseline).reasons).toContainEqual(
      expect.stringContaining("checkin: helpfulness/correctness"),
    );
  });

  it("fails posture regression against the reviewed baseline", () => {
    const { summary, baseline } = fixture();
    summary.results[0].posturePass = false;
    expect(evaluateGate(summary, baseline).reasons).toContainEqual(
      expect.stringContaining("socratic: posture regressed"),
    );
  });
});
