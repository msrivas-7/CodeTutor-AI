import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export const EVAL_REPO_ROOT = path.resolve(import.meta.dirname, "..");
export const GOLDEN_DATASET_PATH = path.join(
  EVAL_REPO_ROOT,
  "eval/tutor-golden-set.yaml",
);
export const REGRESSION_DATASET_PATH = path.join(
  EVAL_REPO_ROOT,
  "eval/tutor-regression-set-v2.yaml",
);

// Any change to code that can alter tutor output, output enforcement, grading,
// or the release decision invalidates the approved baseline until the full
// model gate is rerun. Keep this list explicit and reviewable.
export const QUALITY_CONTRACT_FILES = [
  "scripts/eval-tutor.ts",
  "scripts/evalDeterministic.ts",
  "scripts/evalGate.ts",
  "scripts/judgeModel.ts",
  "src/services/ai/openaiProvider.ts",
  "src/services/ai/editorPromptBuilder.ts",
  "src/services/ai/guidedPromptBuilder.ts",
  "src/services/ai/modelRegistry.ts",
  "src/services/ai/prompts/coreRules.ts",
  "src/services/ai/prompts/lessonContext.ts",
  "src/services/ai/prompts/schema.ts",
  "src/services/ai/canonicalTutorContext.ts",
  "src/services/ai/tutorIntent.ts",
  "src/services/ai/tutorOutput.ts",
  "src/services/ai/tutorPolicy.ts",
  "src/services/ai/suspectApi.ts",
] as const;

async function shortDigest(relativePath: string): Promise<string> {
  return createHash("sha256")
    .update(await fs.readFile(path.join(EVAL_REPO_ROOT, relativePath)))
    .digest("hex")
    .slice(0, 16);
}

export async function readEvalDatasets(): Promise<{
  goldenRaw: string;
  regressionRaw: string;
  datasetFingerprint: string;
}> {
  const [goldenRaw, regressionRaw] = await Promise.all([
    fs.readFile(GOLDEN_DATASET_PATH, "utf8"),
    fs.readFile(REGRESSION_DATASET_PATH, "utf8"),
  ]);
  return {
    goldenRaw,
    regressionRaw,
    datasetFingerprint: createHash("sha256")
      .update(goldenRaw)
      .update("\n---v2-regressions---\n")
      .update(regressionRaw)
      .digest("hex"),
  };
}

export async function computeQualityContractFingerprint(): Promise<string> {
  const hash = createHash("sha256");
  for (const relativePath of QUALITY_CONTRACT_FILES) {
    hash.update(`${relativePath}\0`);
    hash.update(await fs.readFile(path.join(EVAL_REPO_ROOT, relativePath)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

export async function sourceVersions(): Promise<{
  promptVersion: string;
  schemaVersion: string;
  contextBuilderVersion: string;
  qualityContractFingerprint: string;
}> {
  const [promptVersion, schemaVersion, contextBuilderVersion, qualityContractFingerprint] =
    await Promise.all([
      shortDigest("src/services/ai/prompts/coreRules.ts"),
      shortDigest("src/services/ai/prompts/schema.ts"),
      shortDigest("src/services/ai/canonicalTutorContext.ts"),
      computeQualityContractFingerprint(),
    ]);
  return {
    promptVersion,
    schemaVersion,
    contextBuilderVersion,
    qualityContractFingerprint,
  };
}
