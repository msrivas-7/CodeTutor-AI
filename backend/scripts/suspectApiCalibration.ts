import fs from "node:fs/promises";
import path from "node:path";
import {
  detectSuspectApis,
  type SuspectApiInput,
} from "../src/services/ai/suspectApi.js";

export const SUSPECT_API_CALIBRATION_VERSION = "1.2.0";
export const EXPECTED_SUSPECT_API_CASE_COUNT = 48;
export const SUSPECT_API_CALIBRATION_PATH = path.resolve(
  import.meta.dirname,
  "../eval/suspect-api-calibration-v1.json",
);

export interface SuspectApiCalibrationCase extends SuspectApiInput {
  id: string;
  expectedSuspects: string[];
}

export interface SuspectApiCalibrationCorpus {
  version: string;
  description: string;
  thresholds: {
    precision: number;
    recall: number;
    exactCaseAccuracy: number;
    cleanCaseRate: number;
  };
  cases: SuspectApiCalibrationCase[];
}

export interface SuspectApiCalibrationResult {
  ok: boolean;
  failures: string[];
  metrics: {
    precision: number;
    recall: number;
    exactCaseAccuracy: number;
    cleanCaseRate: number;
    truePositives: number;
    falsePositives: number;
    falseNegatives: number;
    exactCases: number;
    cleanCases: number;
    cleanCasesPassed: number;
  };
  cases: Array<{
    id: string;
    expected: string[];
    actual: string[];
    falsePositives: string[];
    falseNegatives: string[];
    exact: boolean;
  }>;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function validateSuspectApiCalibrationCorpus(
  value: unknown,
): asserts value is SuspectApiCalibrationCorpus {
  if (!value || typeof value !== "object") throw new Error("calibration corpus must be an object");
  const corpus = value as Partial<SuspectApiCalibrationCorpus>;
  if (corpus.version !== SUSPECT_API_CALIBRATION_VERSION) {
    throw new Error(`expected calibration version ${SUSPECT_API_CALIBRATION_VERSION}`);
  }
  if (
    typeof corpus.description !== "string" ||
    corpus.description.trim().length === 0 ||
    !corpus.thresholds ||
    !Array.isArray(corpus.cases)
  ) {
    throw new Error("calibration corpus requires description, thresholds, and cases");
  }
  for (const name of [
    "precision",
    "recall",
    "exactCaseAccuracy",
    "cleanCaseRate",
  ] as const) {
    const threshold = corpus.thresholds[name];
    if (typeof threshold !== "number" || threshold < 0 || threshold > 1) {
      throw new Error(`${name} threshold must be between zero and one`);
    }
  }
  for (const entry of corpus.cases) {
    if (
      typeof entry.id !== "string" ||
      entry.id.trim().length === 0 ||
      (entry.language !== "python" && entry.language !== "javascript") ||
      typeof entry.responseText !== "string" ||
      typeof entry.userQuestion !== "string" ||
      !Array.isArray(entry.userFiles) ||
      !isStringArray(entry.expectedSuspects)
    ) {
      throw new Error("calibration case has an invalid shape");
    }
    if (
      entry.userFiles.some(
        (file) =>
          !file ||
          typeof file !== "object" ||
          typeof file.path !== "string" ||
          typeof file.content !== "string",
      )
    ) {
      throw new Error(`${entry.id}: userFiles must contain path/content strings`);
    }
    if (new Set(entry.expectedSuspects).size !== entry.expectedSuspects.length) {
      throw new Error(`${entry.id}: expectedSuspects contains duplicates`);
    }
  }
}

export async function loadSuspectApiCalibration(): Promise<SuspectApiCalibrationCorpus> {
  const parsed: unknown = JSON.parse(
    await fs.readFile(SUSPECT_API_CALIBRATION_PATH, "utf8"),
  );
  validateSuspectApiCalibrationCorpus(parsed);
  return parsed;
}

function rate(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : numerator / denominator;
}

export function evaluateSuspectApiCalibration(
  corpus: SuspectApiCalibrationCorpus,
  detector: (input: SuspectApiInput) => string[] = detectSuspectApis,
): SuspectApiCalibrationResult {
  const failures: string[] = [];
  const ids = new Set(corpus.cases.map((entry) => entry.id));
  const pythonCases = corpus.cases.filter((entry) => entry.language === "python");
  const javascriptCases = corpus.cases.filter((entry) => entry.language === "javascript");
  const positiveCases = corpus.cases.filter((entry) => entry.expectedSuspects.length > 0);
  const cleanCases = corpus.cases.filter((entry) => entry.expectedSuspects.length === 0);

  if (
    corpus.cases.length !== EXPECTED_SUSPECT_API_CASE_COUNT ||
    ids.size !== EXPECTED_SUSPECT_API_CASE_COUNT
  ) {
    failures.push(`calibration requires ${EXPECTED_SUSPECT_API_CASE_COUNT} unique cases`);
  }
  if (pythonCases.length !== 24 || javascriptCases.length !== 24) {
    failures.push("calibration requires 24 Python and 24 JavaScript cases");
  }
  if (positiveCases.length !== 24 || cleanCases.length !== 24) {
    failures.push("calibration requires 24 positive and 24 clean cases");
  }

  let truePositives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;
  let exactCases = 0;
  let cleanCasesPassed = 0;
  const caseResults: SuspectApiCalibrationResult["cases"] = [];

  for (const entry of corpus.cases) {
    const expected = [...new Set(entry.expectedSuspects)].sort();
    const actual = [...new Set(detector(entry))].sort();
    const expectedSet = new Set(expected);
    const actualSet = new Set(actual);
    const caseFalsePositives = actual.filter((symbol) => !expectedSet.has(symbol));
    const caseFalseNegatives = expected.filter((symbol) => !actualSet.has(symbol));
    const caseTruePositives = actual.filter((symbol) => expectedSet.has(symbol));
    const exact = caseFalsePositives.length === 0 && caseFalseNegatives.length === 0;

    truePositives += caseTruePositives.length;
    falsePositives += caseFalsePositives.length;
    falseNegatives += caseFalseNegatives.length;
    if (exact) exactCases += 1;
    if (expected.length === 0 && actual.length === 0) cleanCasesPassed += 1;
    caseResults.push({
      id: entry.id,
      expected,
      actual,
      falsePositives: caseFalsePositives,
      falseNegatives: caseFalseNegatives,
      exact,
    });
  }

  const precision = rate(truePositives, truePositives + falsePositives);
  const recall = rate(truePositives, truePositives + falseNegatives);
  const exactCaseAccuracy = rate(exactCases, corpus.cases.length);
  const cleanCaseRate = rate(cleanCasesPassed, cleanCases.length);
  const metrics = {
    precision,
    recall,
    exactCaseAccuracy,
    cleanCaseRate,
    truePositives,
    falsePositives,
    falseNegatives,
    exactCases,
    cleanCases: cleanCases.length,
    cleanCasesPassed,
  };

  for (const metric of ["precision", "recall", "exactCaseAccuracy", "cleanCaseRate"] as const) {
    if (metrics[metric] < corpus.thresholds[metric]) {
      failures.push(
        `${metric} ${(metrics[metric] * 100).toFixed(1)}% is below ${(corpus.thresholds[metric] * 100).toFixed(1)}%`,
      );
    }
  }

  return {
    ok: failures.length === 0,
    failures,
    metrics,
    cases: caseResults,
  };
}
