import { describe, expect, it } from "vitest";
import {
  EXPECTED_SUSPECT_API_CASE_COUNT,
  evaluateSuspectApiCalibration,
  loadSuspectApiCalibration,
  validateSuspectApiCalibrationCorpus,
} from "./suspectApiCalibration.js";

describe("B7 suspect API calibration", () => {
  it("meets the versioned precision, recall, exact, and clean-case gates", async () => {
    const corpus = await loadSuspectApiCalibration();
    const result = evaluateSuspectApiCalibration(corpus);

    expect(corpus.cases).toHaveLength(EXPECTED_SUSPECT_API_CASE_COUNT);
    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("rejects a detector that silently misses every fabricated symbol", async () => {
    const corpus = await loadSuspectApiCalibration();
    const result = evaluateSuspectApiCalibration(corpus, () => []);

    expect(result.ok).toBe(false);
    expect(result.metrics.recall).toBe(0);
    expect(result.failures.some((failure) => failure.startsWith("recall "))).toBe(true);
  });

  it("rejects a detector that flags clean responses indiscriminately", async () => {
    const corpus = await loadSuspectApiCalibration();
    const result = evaluateSuspectApiCalibration(corpus, () => ["always_fake"]);

    expect(result.ok).toBe(false);
    expect(result.metrics.cleanCaseRate).toBe(0);
    expect(result.failures.some((failure) => failure.startsWith("cleanCaseRate "))).toBe(true);
  });

  it("rejects a corpus with a missing release threshold", async () => {
    const corpus = await loadSuspectApiCalibration();
    const { recall: _recall, ...thresholds } = corpus.thresholds;

    expect(() => validateSuspectApiCalibrationCorpus({
      ...corpus,
      thresholds,
    })).toThrow("recall threshold must be between zero and one");
  });
});
