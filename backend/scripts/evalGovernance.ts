import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import {
  EVAL_REPO_ROOT,
  GOLDEN_DATASET_PATH,
  REGRESSION_DATASET_PATH,
} from "./evalProvenance.js";

export const GOLDEN_PROVENANCE_PATH = path.join(
  EVAL_REPO_ROOT,
  "eval/golden-provenance-v1.json",
);

interface EvalCase {
  id: string;
  userMessage?: string;
  userFile?: string;
}

interface ProvenanceDeclaration {
  caseIds: string[];
  origin: "expert-authored" | "synthetic";
  authoredContext: string;
  sourcePatternFingerprint?: string;
  reviewedBy?: string[];
  authoredAt?: string;
  independentAuthoringAttested?: boolean;
}

interface ProvenanceManifest {
  version: number;
  policy: {
    trafficLane: string;
    trustedLane: string;
    directTrafficPromotionAllowed: boolean;
    minimumSyntheticReviewers: number;
  };
  declarations: ProvenanceDeclaration[];
}

const SHA256_RE = /^[0-9a-f]{64}$/;
const FORBIDDEN_KEYS = [
  "sampleId",
  "requestId",
  "subjectToken",
  "subjectTokenHash",
  "userId",
  "questionRedacted",
  "responseRedacted",
];

function stableCaseFingerprint(value: EvalCase): string {
  return createHash("sha256")
    .update(JSON.stringify({
      userMessage: value.userMessage ?? "",
      userFile: value.userFile ?? "",
    }))
    .digest("hex");
}

export function verifyEvalDatasetGovernance(input: {
  cases: EvalCase[];
  manifest: ProvenanceManifest;
  manifestRaw: string;
}): void {
  const failures: string[] = [];
  const ids = input.cases.map((item) => item.id);
  const caseIds = new Set(ids);
  if (ids.some((id) => !/^[grs][0-9]{3}$/.test(id))) {
    failures.push("every eval case must have a stable g/r/s numeric id");
  }
  if (caseIds.size !== ids.length) failures.push("eval case ids must be unique");

  if (
    input.manifest.version !== 1 ||
    input.manifest.policy.trafficLane !== "traffic_candidate" ||
    input.manifest.policy.trustedLane !== "repository_golden_holdout" ||
    input.manifest.policy.directTrafficPromotionAllowed !== false ||
    input.manifest.policy.minimumSyntheticReviewers < 2
  ) {
    failures.push("provenance manifest policy does not enforce B8 holdout separation");
  }

  const declared = new Map<string, ProvenanceDeclaration>();
  const syntheticSourcePatterns = new Map<string, string>();
  for (const declaration of input.manifest.declarations) {
    if (!declaration.authoredContext?.trim()) {
      failures.push("every provenance declaration needs authoredContext");
    }
    if (!Array.isArray(declaration.caseIds) || declaration.caseIds.length === 0) {
      failures.push("every provenance declaration needs at least one case id");
      continue;
    }
    if (declaration.origin === "synthetic") {
      if (declaration.caseIds.length !== 1) {
        failures.push("each synthetic declaration must describe exactly one case");
      }
      if (!SHA256_RE.test(declaration.sourcePatternFingerprint ?? "")) {
        failures.push(`${declaration.caseIds[0]} synthetic origin needs a source pattern fingerprint`);
      }
      const reviewers = new Set(
        (declaration.reviewedBy ?? []).filter((reviewer) =>
          /^[a-z0-9][a-z0-9_-]{2,63}$/.test(reviewer),
        ),
      );
      if (reviewers.size < input.manifest.policy.minimumSyntheticReviewers) {
        failures.push(`${declaration.caseIds[0]} synthetic origin needs two distinct reviewers`);
      }
      if (declaration.independentAuthoringAttested !== true) {
        failures.push(`${declaration.caseIds[0]} synthetic origin needs independent-authoring attestation`);
      }
      if (!declaration.authoredAt || Number.isNaN(Date.parse(declaration.authoredAt))) {
        failures.push(`${declaration.caseIds[0]} synthetic origin needs an authoredAt date`);
      }
      if (SHA256_RE.test(declaration.sourcePatternFingerprint ?? "")) {
        const fingerprint = declaration.sourcePatternFingerprint!;
        const duplicate = syntheticSourcePatterns.get(fingerprint);
        if (duplicate) {
          failures.push(`${declaration.caseIds[0]} reuses source pattern from ${duplicate}`);
        }
        syntheticSourcePatterns.set(fingerprint, declaration.caseIds[0]);
      }
    } else if (declaration.origin === "expert-authored") {
      if (
        declaration.sourcePatternFingerprint !== undefined ||
        declaration.reviewedBy !== undefined ||
        declaration.independentAuthoringAttested !== undefined
      ) {
        failures.push("expert-authored declarations cannot claim traffic-pattern provenance");
      }
    } else {
      failures.push("every provenance declaration origin must be expert-authored or synthetic");
    }
    for (const id of declaration.caseIds) {
      if (declared.has(id)) failures.push(`${id} has duplicate provenance declarations`);
      declared.set(id, declaration);
    }
  }

  for (const id of caseIds) {
    if (!declared.has(id)) failures.push(`${id} is missing provenance`);
  }
  for (const id of declared.keys()) {
    if (!caseIds.has(id)) failures.push(`${id} provenance points to a missing eval case`);
  }

  const rawLower = input.manifestRaw.toLowerCase();
  for (const forbidden of FORBIDDEN_KEYS) {
    if (rawLower.includes(forbidden.toLowerCase())) {
      failures.push(`provenance manifest contains forbidden traffic field: ${forbidden}`);
    }
  }

  const contentFingerprints = new Map<string, string>();
  for (const evalCase of input.cases) {
    const fingerprint = stableCaseFingerprint(evalCase);
    const duplicate = contentFingerprints.get(fingerprint);
    if (duplicate) failures.push(`${evalCase.id} duplicates learner content from ${duplicate}`);
    contentFingerprints.set(fingerprint, evalCase.id);
  }

  if (failures.length > 0) {
    throw new Error(`eval governance failed: ${failures.join("; ")}`);
  }
}

export async function loadAndVerifyEvalDatasetGovernance(): Promise<number> {
  const [goldenRaw, regressionRaw, manifestRaw] = await Promise.all([
    fs.readFile(GOLDEN_DATASET_PATH, "utf8"),
    fs.readFile(REGRESSION_DATASET_PATH, "utf8"),
    fs.readFile(GOLDEN_PROVENANCE_PATH, "utf8"),
  ]);
  const golden = yaml.load(goldenRaw);
  const regression = yaml.load(regressionRaw);
  if (!Array.isArray(golden) || !Array.isArray(regression)) {
    throw new Error("eval governance requires YAML array datasets");
  }
  const manifest = JSON.parse(manifestRaw) as ProvenanceManifest;
  const cases = [...golden, ...regression] as EvalCase[];
  verifyEvalDatasetGovernance({ cases, manifest, manifestRaw });
  return cases.length;
}
