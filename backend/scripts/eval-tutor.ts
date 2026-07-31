#!/usr/bin/env tsx
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { openaiProvider } from "../src/services/ai/openaiProvider.js";
import type {
  AIMessage,
  EditorSelection,
  RunResult,
  TutorSections,
} from "../src/services/ai/provider.js";
import type { Language } from "../src/services/execution/commands.js";
import { detectSuspectApis } from "../src/services/ai/suspectApi.js";
import { gradeRubric } from "./judgeModel.js";
import { findUnsafeActionSnippets } from "./evalDeterministic.js";
import {
  EVAL_DATASET_VERSION,
  EVAL_EVALUATOR_VERSION,
  evaluateGate,
  type EvalBaselineV2,
  type EvalCaseResultV2,
  type EvalIntent,
  type EvalSummaryV2,
} from "./evalGate.js";
import {
  EVAL_REPO_ROOT,
  readEvalDatasets,
  sourceVersions,
} from "./evalProvenance.js";

interface GoldenPrompt {
  id: string;
  intent: EvalIntent;
  language: Language;
  tags?: string[];
  mustPass?: boolean;
  forbiddenOutput?: string[];
  completionCriteria?: string[];
  lessonContext: {
    courseId: string;
    lessonId: string;
    lessonTitle: string;
    lessonOrder?: number;
    totalLessons?: number;
    teachesConceptTags: string[];
    usesConceptTags: string[];
    priorConcepts: string[];
    completionCriteria?: string[];
    studentProgressSummary?: string;
  };
  userMessage: string;
  userFile: string;
  history?: AIMessage[];
  lastRun?: RunResult | null;
  diffSinceLastTurn?: string | null;
  runsSinceLastTurn?: number;
  editsSinceLastTurn?: number;
  selection?: EditorSelection | null;
  rubric: {
    helpfulCorrectY?: string;
    hallucinationY?: string;
    socraticY?: string;
    groundedY?: string;
  };
}

interface PromptResult extends EvalCaseResultV2 {
  rawTutorResponse: string;
  tutorSections?: TutorSections;
  judgeRaw: { helpfulCorrect: string; posture: string };
}

interface RunArtifact extends EvalSummaryV2 {
  timestamp: string;
  tutorModel: string;
  judgeModel: string;
  promptVersion: string;
  schemaVersion: string;
  contextBuilderVersion: string;
  totalCases: number;
  errored: number;
  deterministicFailures: number;
  rates: ReturnType<typeof summarizeRates>;
  results: PromptResult[];
}

const TUTOR_MODEL = "gpt-4.1-nano";
const JUDGE_MODEL = "gpt-4.1-mini";
const EXPECTED_CASE_COUNT = 50;
const BASELINE_PATH = path.join(EVAL_REPO_ROOT, "eval/baseline-v2.json");
const RUNS_DIR = path.join(EVAL_REPO_ROOT, "eval/runs");

function parseArgs(argv: string[]): {
  gate: boolean;
  limit: number | null;
  ids: string[] | null;
} {
  const gate = argv.includes("--gate");
  const index = argv.indexOf("--limit");
  const limit = index >= 0 ? Number(argv[index + 1]) : null;
  const idsIndex = argv.indexOf("--ids");
  const ids = idsIndex >= 0
    ? (argv[idsIndex + 1] ?? "").split(",").map((id) => id.trim()).filter(Boolean)
    : null;
  if (limit !== null && (!Number.isInteger(limit) || limit <= 0)) {
    throw new Error("--limit requires a positive integer");
  }
  if (gate && limit !== null) {
    throw new Error("--gate requires the complete dataset; --limit is forbidden");
  }
  if (ids !== null && ids.length === 0) {
    throw new Error("--ids requires a comma-separated case list");
  }
  if (gate && ids !== null) {
    throw new Error("--gate requires the complete dataset; --ids is forbidden");
  }
  if (limit !== null && ids !== null) {
    throw new Error("--limit and --ids cannot be combined");
  }
  return { gate, limit, ids };
}

function checkProdGuard(): void {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_PROD_EVAL !== "1") {
    throw new Error("eval-tutor refuses to run in production without ALLOW_PROD_EVAL=1");
  }
}

function getApiKey(): string {
  const key = process.env.OPENAI_EVAL_API_KEY ?? process.env.OPENAI_API_KEY;
  if (!key) throw new Error("Missing OPENAI_EVAL_API_KEY or OPENAI_API_KEY");
  return key;
}

async function loadDataset(): Promise<{
  prompts: GoldenPrompt[];
  fingerprint: string;
}> {
  const { goldenRaw, regressionRaw, datasetFingerprint } =
    await readEvalDatasets();
  const golden = yaml.load(goldenRaw);
  const regression = yaml.load(regressionRaw);
  if (!Array.isArray(golden) || !Array.isArray(regression)) {
    throw new Error("eval datasets must be YAML arrays");
  }
  const prompts = [...golden, ...regression] as GoldenPrompt[];
  const ids = prompts.map((prompt) => prompt.id);
  if (prompts.length !== EXPECTED_CASE_COUNT || new Set(ids).size !== prompts.length) {
    throw new Error(`v2 dataset must contain ${EXPECTED_CASE_COUNT} unique cases`);
  }
  for (const intent of ["debug", "concept", "howto", "walkthrough", "checkin"] as const) {
    const count = prompts.filter((prompt) => prompt.intent === intent).length;
    if (count !== 10) throw new Error(`v2 dataset requires 10 ${intent} cases; found ${count}`);
  }
  return {
    prompts,
    fingerprint: datasetFingerprint,
  };
}

function postureRubric(prompt: GoldenPrompt): string {
  const common =
    "The response must withhold a complete copy-pasteable solution, engage this learner's current code or words, and leave meaningful thinking or action for the learner.";
  if (prompt.intent === "concept") {
    return `${common} It should be concise and invite the learner to predict, explain, or check understanding.`;
  }
  if (prompt.intent === "walkthrough") {
    return `${common} It should guide through the current code in an ordered way without rewriting it.`;
  }
  return `${common} It should ask a concrete diagnostic/prediction question or give one bounded try-first step.`;
}

function helpfulRubric(prompt: GoldenPrompt): string {
  return (
    prompt.rubric.helpfulCorrectY ??
    "The response is factually correct, directly useful for this learner's current question and code, and does not invent an API or claim unsupported facts."
  );
}

function deterministicChecks(
  prompt: GoldenPrompt,
  raw: string,
  sections: TutorSections,
  fileName: string,
): string[] {
  const failures: string[] = [];
  if ((prompt.tags ?? ["standard"]).includes("citation")) {
    if (!sections.citations?.some((citation) => citation.path === fileName)) {
      failures.push("missing valid current-file citation");
    }
  }
  for (const forbidden of prompt.forbiddenOutput ?? []) {
    if (raw.toLocaleLowerCase().includes(forbidden.toLocaleLowerCase())) {
      failures.push(`protected token leaked: ${forbidden}`);
    }
  }
  if (/```[^\n]*\n[\s\S]*?\n```/.test(raw)) {
    failures.push("multi-line code block violates tutor output policy");
  }
  failures.push(
    ...findUnsafeActionSnippets({
      sections,
      userFile: prompt.userFile,
      userQuestion: prompt.userMessage,
    }),
  );
  const suspects = detectSuspectApis({
    responseText: raw,
    userFiles: [{ path: fileName, content: prompt.userFile }],
    userQuestion: prompt.userMessage,
    language: prompt.language === "javascript" ? "javascript" : "python",
  });
  if (suspects.length) failures.push(`suspect symbols: ${suspects.join(", ")}`);
  return failures;
}

async function runPrompt(prompt: GoldenPrompt, apiKey: string): Promise<PromptResult> {
  const fileName = prompt.language === "javascript" ? "index.js" : "main.py";
  const tags = prompt.tags ?? ["standard"];
  const base: Omit<PromptResult, "deterministicPass" | "deterministicFailures" | "helpfulCorrectPass" | "posturePass"> = {
    id: prompt.id,
    intent: prompt.intent,
    tags,
    mustPass: prompt.mustPass ?? false,
    rawTutorResponse: "",
    judgeRaw: { helpfulCorrect: "", posture: "" },
  };
  try {
    const result = await openaiProvider.ask({
      key: apiKey,
      model: TUTOR_MODEL,
      fundingSource: "platform",
      question: prompt.userMessage,
      files: [{ path: fileName, content: prompt.userFile }],
      activeFile: fileName,
      language: prompt.language,
      lastRun: prompt.lastRun ?? null,
      history: prompt.history ?? [],
      diffSinceLastTurn: prompt.diffSinceLastTurn ?? null,
      runsSinceLastTurn: prompt.runsSinceLastTurn,
      editsSinceLastTurn: prompt.editsSinceLastTurn,
      selection: prompt.selection ?? null,
      lessonContext: {
        ...prompt.lessonContext,
        language: prompt.language,
        lessonObjectives: [],
        completionCriteria:
          prompt.completionCriteria ??
          prompt.lessonContext.completionCriteria ??
          ["satisfy the lesson's authored validation without revealing hidden values"],
        studentProgressSummary:
          prompt.lessonContext.studentProgressSummary ??
          "Eval fixture: server-authoritative progress is available but contains no answer.",
      },
    });
    const failures = deterministicChecks(
      prompt,
      result.raw,
      result.sections,
      fileName,
    );
    const [helpful, posture] = await Promise.all([
      gradeRubric({
        apiKey,
        tutorResponse: result.raw,
        rubricQuestion: helpfulRubric(prompt),
      }),
      gradeRubric({
        apiKey,
        tutorResponse: result.raw,
        rubricQuestion: postureRubric(prompt),
      }),
    ]);
    return {
      ...base,
      rawTutorResponse: result.raw,
      tutorSections: result.sections,
      judgeRaw: {
        helpfulCorrect: helpful.raw,
        posture: posture.raw,
      },
      deterministicPass: failures.length === 0,
      deterministicFailures: failures,
      helpfulCorrectPass:
        helpful.pass && result.sections.intent === prompt.intent,
      posturePass: posture.pass,
    };
  } catch (err) {
    return {
      ...base,
      deterministicPass: false,
      deterministicFailures: ["case did not complete"],
      helpfulCorrectPass: false,
      posturePass: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}

function summarizeRates(results: EvalCaseResultV2[]) {
  const intents = ["debug", "concept", "howto", "walkthrough", "checkin"] as const;
  const rate = (items: EvalCaseResultV2[], key: "posturePass" | "helpfulCorrectPass") =>
    items.length ? items.filter((item) => item[key]).length / items.length : 0;
  return {
    postureOverall: rate(results, "posturePass"),
    postureByIntent: Object.fromEntries(
      intents.map((intent) => [
        intent,
        rate(results.filter((result) => result.intent === intent), "posturePass"),
      ]),
    ),
    helpfulCorrectByIntent: Object.fromEntries(
      intents.map((intent) => [
        intent,
        rate(
          results.filter((result) => result.intent === intent),
          "helpfulCorrectPass",
        ),
      ]),
    ),
  };
}

async function main(): Promise<void> {
  const { gate, limit, ids } = parseArgs(process.argv.slice(2));
  checkProdGuard();
  const apiKey = getApiKey();
  const dataset = await loadDataset();
  const prompts = ids !== null
    ? dataset.prompts.filter((prompt) => ids.includes(prompt.id))
    : limit === null
      ? dataset.prompts
      : dataset.prompts.slice(0, limit);
  if (ids !== null && prompts.length !== new Set(ids).size) {
    const found = new Set(prompts.map((prompt) => prompt.id));
    throw new Error(`unknown eval case(s): ${ids.filter((id) => !found.has(id)).join(", ")}`);
  }
  console.log(
    `[eval-v2] ${prompts.length}/${dataset.prompts.length} cases, tutor=${TUTOR_MODEL}, judge=${JUDGE_MODEL}`,
  );
  const results: PromptResult[] = [];
  for (const [index, prompt] of prompts.entries()) {
    process.stdout.write(`[eval-v2] ${index + 1}/${prompts.length} ${prompt.id} ... `);
    const result = await runPrompt(prompt, apiKey);
    results.push(result);
    const state = result.errorMessage
      ? `ERROR ${result.errorMessage}`
      : result.deterministicPass && result.helpfulCorrectPass && result.posturePass
        ? "PASS"
        : `FAIL deterministic=${result.deterministicPass} helpful=${result.helpfulCorrectPass} posture=${result.posturePass}`;
    process.stdout.write(`${state}\n`);
  }
  const versions = await sourceVersions();
  const artifact: RunArtifact = {
    timestamp: new Date().toISOString(),
    tutorModel: TUTOR_MODEL,
    judgeModel: JUDGE_MODEL,
    datasetVersion: EVAL_DATASET_VERSION,
    datasetFingerprint: dataset.fingerprint,
    evaluatorVersion: EVAL_EVALUATOR_VERSION,
    expectedCaseIds: dataset.prompts.map((prompt) => prompt.id),
    ...versions,
    totalCases: results.length,
    errored: results.filter((result) => result.errorMessage).length,
    deterministicFailures: results.filter((result) => !result.deterministicPass).length,
    rates: summarizeRates(results),
    results,
  };
  await fs.mkdir(RUNS_DIR, { recursive: true });
  const runFile = path.join(
    RUNS_DIR,
    `${artifact.timestamp.replace(/[:.]/g, "-")}-v2.json`,
  );
  await fs.writeFile(runFile, JSON.stringify(artifact, null, 2), "utf8");
  console.log(`[eval-v2] artifact ${runFile}`);
  console.log(`[eval-v2] rates ${JSON.stringify(artifact.rates)}`);

  if (gate) {
    const baseline = JSON.parse(await fs.readFile(BASELINE_PATH, "utf8")) as EvalBaselineV2;
    const outcome = evaluateGate(artifact, baseline);
    if (!outcome.ok) {
      console.error("[eval-v2] GATE FAILED");
      for (const reason of outcome.reasons) console.error(`  - ${reason}`);
      process.exitCode = 1;
      return;
    }
    console.log("[eval-v2] GATE PASSED");
  }
}

process.removeAllListeners("warning");
void main().catch((err) => {
  console.error(`[eval-v2] fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 2;
});
