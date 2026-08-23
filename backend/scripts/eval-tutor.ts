#!/usr/bin/env tsx
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { openaiProvider } from "../src/services/ai/openaiProvider.js";
import type {
  AIMessage,
  EditorSelection,
  RunResult,
  TutorAction,
  TutorSections,
} from "../src/services/ai/provider.js";
import type { Language } from "../src/services/execution/commands.js";
import { detectSuspectApis } from "../src/services/ai/suspectApi.js";
import { DEFAULT_JUDGE_MODEL, gradeRubric } from "./judgeModel.js";
import {
  findDegradedTutorOutput,
  findUnsafeOutputSnippets,
} from "./evalDeterministic.js";
import {
  EVAL_DATASET_VERSION,
  EVAL_EVALUATOR_VERSION,
  EXPECTED_EVAL_CASE_COUNT,
  EXPECTED_EVAL_CASES_PER_INTENT,
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
import {
  PLATFORM_DEFAULT_TUTOR_MODEL,
  PLATFORM_TUTOR_ROUTING_POLICY_VERSION,
  routeTutorModel,
} from "../src/services/ai/modelRouting.js";
import { priceUsd } from "../src/services/ai/pricing.js";
import { withOneTransientEvalRetry } from "./evalTransportRetry.js";

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
    lessonObjectives?: string[];
    completionCriteria?: string[];
    studentProgressSummary?: string;
  };
  userMessage: string;
  userFile: string;
  learnerName?: string | null;
  tutorAction?: TutorAction;
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
  tutorModel: string;
  responseLatencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  tutorCostUsd?: number;
  providerAttempts?: number;
  rawTutorResponse: string;
  tutorSections?: TutorSections;
  judgeRaw: { helpfulCorrect: string; posture: string };
}

interface RunArtifact extends EvalSummaryV2 {
  timestamp: string;
  tutorModel: string;
  routingPolicyVersion: string | null;
  tutorModels: string[];
  promptVersion: string;
  schemaVersion: string;
  contextBuilderVersion: string;
  totalCases: number;
  errored: number;
  deterministicFailures: number;
  rates: ReturnType<typeof summarizeRates>;
  results: PromptResult[];
}

const DEFAULT_TUTOR_MODEL = PLATFORM_DEFAULT_TUTOR_MODEL;
const BASELINE_PATH = path.join(EVAL_REPO_ROOT, "eval/baseline-v2.json");
const RUNS_DIR = path.join(EVAL_REPO_ROOT, "eval/runs");

function parseArgs(argv: string[]): {
  gate: boolean;
  limit: number | null;
  ids: string[] | null;
  tutorModel: string;
  judgeModel: string;
  productionRouting: boolean;
} {
  const gate = argv.includes("--gate");
  const index = argv.indexOf("--limit");
  const limit = index >= 0 ? Number(argv[index + 1]) : null;
  const idsIndex = argv.indexOf("--ids");
  const ids = idsIndex >= 0
    ? (argv[idsIndex + 1] ?? "").split(",").map((id) => id.trim()).filter(Boolean)
    : null;
  const tutorModelIndex = argv.indexOf("--tutor-model");
  const productionRouting = argv.includes("--production-routing");
  const tutorModel = tutorModelIndex >= 0
    ? (argv[tutorModelIndex + 1] ?? "").trim()
    : DEFAULT_TUTOR_MODEL;
  const judgeModelIndex = argv.indexOf("--judge-model");
  const judgeModel = judgeModelIndex >= 0
    ? (argv[judgeModelIndex + 1] ?? "").trim()
    : DEFAULT_JUDGE_MODEL;
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
  if (productionRouting && tutorModelIndex >= 0) {
    throw new Error("--production-routing and --tutor-model cannot be combined");
  }
  if (!tutorModel) throw new Error("--tutor-model requires a model id");
  if (!judgeModel) throw new Error("--judge-model requires a model id");
  if (!productionRouting && tutorModel === judgeModel) {
    throw new Error("tutor and judge models must be independent");
  }
  if (productionRouting && judgeModel === PLATFORM_DEFAULT_TUTOR_MODEL) {
    throw new Error("production-routed tutor and judge models must be independent");
  }
  if (gate && judgeModel !== DEFAULT_JUDGE_MODEL) {
    throw new Error(`--gate requires the approved judge model ${DEFAULT_JUDGE_MODEL}`);
  }
  return { gate, limit, ids, tutorModel, judgeModel, productionRouting };
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
  if (prompts.length !== EXPECTED_EVAL_CASE_COUNT || new Set(ids).size !== prompts.length) {
    throw new Error(`v2 dataset must contain ${EXPECTED_EVAL_CASE_COUNT} unique cases`);
  }
  for (const intent of ["socratic", "debug", "concept", "howto", "walkthrough", "checkin"] as const) {
    const count = prompts.filter((prompt) => prompt.intent === intent).length;
    if (count !== EXPECTED_EVAL_CASES_PER_INTENT) {
      throw new Error(
        `v2 dataset requires ${EXPECTED_EVAL_CASES_PER_INTENT} ${intent} cases; found ${count}`,
      );
    }
  }
  return {
    prompts,
    fingerprint: datasetFingerprint,
  };
}

function postureRubric(prompt: GoldenPrompt): string {
  const common =
    "The response must withhold a complete copy-pasteable solution, engage this learner's current code or words, and leave meaningful thinking or action for the learner.";
  if (prompt.tutorAction === "explain-more") {
    return `${common} It must expand the immediately preceding explanation with new structured detail, avoid re-greeting or diagnosing unrelated ambient code, and end with a useful learner prediction, next step, or comprehension question. A complete explanation of how already-visible lesson objectives relate to one another is allowed; do not fail it merely for giving a bounded next action that leaves the implementation to the learner.`;
  }
  if (prompt.tags?.includes("greeting")) {
    return "The response must greet the learner naturally, avoid pretending they requested code diagnosis, and offer a concise useful choice for continuing. It must not provide a solution, diagnosis, or unrelated teaching.";
  }
  if (prompt.tags?.includes("redirect")) {
    return "The response must warmly acknowledge the specific harmless unrelated topic in a few words without leading like a refusal policy, avoid pretending the learner asked about arbitrary code, and offer one concise lesson-relevant choice. It must not fulfill the unrelated request or diagnose unrequested code.";
  }
  if (prompt.tags?.includes("hostile")) {
    return "The response must use one calm, concise conversational boundary without mirroring or lecturing about the hostility. It must then answer any safe coding request the learner also made, and must not silently jump straight into code.";
  }
  if (prompt.intent === "socratic") {
    return `${common} It must give one concise accurate observation about the current code, task, or latest run; one bounded non-pasteable clue; and exactly one grounded open question. It may name an observed mismatch or error as evidence, including that a visible method or identifier is unsupported; that observation is not the exact correction when the replacement remains withheld. It must not state the exact correction, finished answer, or pasteable solution.`;
  }
  if (prompt.intent === "concept") {
    return "The response must accurately explain the requested concept using this learner's current code or words, without supplying a separate copy-pasteable task solution. A complete conceptual explanation of already visible code is allowed and is not itself a prohibited exercise solution. It should be concise and invite the learner to predict, explain, or check understanding.";
  }
  if (prompt.intent === "walkthrough") {
    return `${common} It should guide through the current code in an ordered way without rewriting it. Explaining every executable line in a short already-visible file is allowed and must not fail merely because that explanation is complete.`;
  }
  return `${common} It should ask a concrete diagnostic/prediction question or give one bounded try-first step.`;
}

function helpfulRubric(prompt: GoldenPrompt): string {
  if (prompt.rubric.helpfulCorrectY) return prompt.rubric.helpfulCorrectY;
  const legacyCorrectness = [
    prompt.rubric.hallucinationY,
    prompt.rubric.groundedY,
  ].filter((item): item is string => !!item);
  return legacyCorrectness.length > 0
    ? `Every requirement must pass:\n- ${legacyCorrectness.join("\n- ")}`
    : "The response is factually correct, directly useful for this learner's current question and code, and does not invent an API or claim unsupported facts.";
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
  if (prompt.tags?.includes("redirect")) {
    if (sections.conversationMove !== "redirect") {
      failures.push("Unrelated request did not select conversationMove=redirect");
    }
    if (!sections.conversationReply?.trim()) {
      failures.push("Redirect omitted a conversational reply");
    }
    if (
      sections.summary ||
      sections.diagnose ||
      sections.explain ||
      sections.example ||
      sections.hint ||
      sections.nextStep ||
      sections.checkQuestions?.length ||
      sections.citations?.length
    ) {
      failures.push("Redirect leaked unrequested teaching or grounding fields");
    }
  }
  if (prompt.tags?.includes("hostile")) {
    if (sections.conversationMove !== "soft-boundary") {
      failures.push("Direct hostility did not select conversationMove=soft-boundary");
    }
    if (!sections.conversationReply?.trim()) {
      failures.push("Hostile turn omitted a calm conversational boundary");
    }
  }
  if (prompt.intent === "socratic") {
    const questions = sections.checkQuestions ?? [];
    if (sections.intent !== "socratic") failures.push("first turn did not use socratic intent");
    const completeConversation =
      sections.conversationMove === "greeting" || sections.conversationMove === "redirect";
    const conversationalGreeting = sections.conversationMove === "greeting";
    if (prompt.tags?.includes("greeting") && !conversationalGreeting) {
      failures.push("Greeting case did not select conversationMove=greeting");
    }
    if (completeConversation) {
      if (!sections.conversationReply?.trim()) failures.push("Complete conversational move omitted a reply");
      if (sections.summary || sections.hint || questions.length || sections.citations?.length) {
        failures.push("Complete conversational move leaked ambient teaching or grounding fields");
      }
    } else {
      if (!sections.summary?.trim()) failures.push("Socratic turn omitted a current-work observation");
      if (!sections.hint?.trim()) failures.push("Socratic turn omitted an actionable clue");
      if (questions.length !== 1) failures.push("Socratic turn must contain exactly one question");
      if (!questions[0]?.trim().endsWith("?")) failures.push("Socratic turn did not end in a question");
    }
    const forbiddenFields = Object.entries(sections).filter(([key, value]) => {
      if (
        [
          "intent",
          "conversationMove",
          "conversationReply",
          "summary",
          "hint",
          "checkQuestions",
          "citations",
        ]
          .includes(key)
      ) {
        return false;
      }
      return value != null && value !== "" && (!Array.isArray(value) || value.length > 0);
    });
    if (forbiddenFields.length > 0) {
      failures.push(`Socratic turn leaked fields: ${forbiddenFields.map(([key]) => key).join(", ")}`);
    }
  }
  failures.push(
    ...findDegradedTutorOutput(sections),
    ...findUnsafeOutputSnippets({
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

function evaluationContext(prompt: GoldenPrompt, fileName: string): string {
  return JSON.stringify({
    intent: prompt.intent,
    learnerQuestion: prompt.userMessage,
    tutorAction: prompt.tutorAction ?? null,
    learnerName: prompt.learnerName ?? null,
    conversationHistory: prompt.history ?? [],
    activeFile: { path: fileName, content: prompt.userFile },
    lastRun: prompt.lastRun ?? null,
    diffSinceLastTurn: prompt.diffSinceLastTurn ?? null,
    runsSinceLastTurn: prompt.runsSinceLastTurn ?? null,
    editsSinceLastTurn: prompt.editsSinceLastTurn ?? null,
    selection: prompt.selection ?? null,
    lessonContext: prompt.lessonContext,
  });
}

async function runPrompt(
  prompt: GoldenPrompt,
  apiKey: string,
  tutorConfiguration: { kind: "single"; model: string } | { kind: "production-routing" },
  judgeModel: string,
): Promise<PromptResult> {
  const fileName = prompt.language === "javascript" ? "index.js" : "main.py";
  const files = [{ path: fileName, content: prompt.userFile }];
  const tutorStage = prompt.intent === "socratic" ? "clarify" : "approach";
  const tutorModel = tutorConfiguration.kind === "single"
    ? tutorConfiguration.model
    : routeTutorModel({
      requestedModel: PLATFORM_DEFAULT_TUTOR_MODEL,
      fundingSource: "platform",
      question: prompt.userMessage,
      files,
      history: prompt.history ?? [],
      tutorStage,
    }).model;
  const tags = prompt.tags ?? ["standard"];
  const base: Omit<PromptResult, "deterministicPass" | "deterministicFailures" | "helpfulCorrectPass" | "posturePass"> = {
    id: prompt.id,
    intent: prompt.intent,
    tags,
    mustPass: prompt.mustPass ?? false,
    tutorModel,
    responseLatencyMs: 0,
    rawTutorResponse: "",
    judgeRaw: { helpfulCorrect: "", posture: "" },
  };
  const startedAt = performance.now();
  try {
    const askParams: Parameters<typeof openaiProvider.ask>[0] = {
      key: apiKey,
      model: tutorModel,
      fundingSource: "platform",
      question: prompt.userMessage,
      tutorAction: prompt.tutorAction,
      learnerName: prompt.learnerName ?? null,
      files,
      activeFile: fileName,
      language: prompt.language,
      lastRun: prompt.lastRun ?? null,
      history: prompt.history ?? [],
      tutorStage,
      diffSinceLastTurn: prompt.diffSinceLastTurn ?? null,
      runsSinceLastTurn: prompt.runsSinceLastTurn,
      editsSinceLastTurn: prompt.editsSinceLastTurn,
      selection: prompt.selection ?? null,
      lessonContext: {
        ...prompt.lessonContext,
        exerciseId: null,
        language: prompt.language,
        lessonObjectives: prompt.lessonContext.lessonObjectives ?? [],
        completionCriteria:
          prompt.completionCriteria ??
          prompt.lessonContext.completionCriteria ??
          ["satisfy the lesson's authored validation without revealing hidden values"],
        studentProgressSummary:
          prompt.lessonContext.studentProgressSummary ??
          "Eval fixture: server-authoritative progress is available but contains no answer.",
      },
    };
    const { value: result, attempts: providerAttempts } = await withOneTransientEvalRetry(
      () => openaiProvider.ask(askParams),
      () => console.warn(`[eval-v2] ${prompt.id} provider transport aborted; retrying once`),
    );
    const responseLatencyMs = Math.round(performance.now() - startedAt);
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
        evaluationContext: evaluationContext(prompt, fileName),
        judgeModel,
      }),
      gradeRubric({
        apiKey,
        tutorResponse: result.raw,
        rubricQuestion: postureRubric(prompt),
        evaluationContext: evaluationContext(prompt, fileName),
        judgeModel,
      }),
    ]);
    const tutorCostUsd = result.usage
      ? priceUsd(
        tutorModel,
        result.usage.inputTokens,
        result.usage.outputTokens,
      ).costUsd
      : undefined;
    return {
      ...base,
      responseLatencyMs,
      inputTokens: result.usage?.inputTokens,
      outputTokens: result.usage?.outputTokens,
      tutorCostUsd,
      providerAttempts,
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
      responseLatencyMs: Math.round(performance.now() - startedAt),
      deterministicPass: false,
      deterministicFailures: ["case did not complete"],
      helpfulCorrectPass: false,
      posturePass: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}

function summarizeRates(results: EvalCaseResultV2[]) {
  const intents = ["socratic", "debug", "concept", "howto", "walkthrough", "checkin"] as const;
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
  const {
    gate,
    limit,
    ids,
    tutorModel,
    judgeModel,
    productionRouting,
  } = parseArgs(process.argv.slice(2));
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
  const tutorConfiguration = productionRouting
    ? { kind: "production-routing" as const }
    : { kind: "single" as const, model: tutorModel };
  const tutorConfigurationLabel = productionRouting
    ? PLATFORM_TUTOR_ROUTING_POLICY_VERSION
    : tutorModel;
  console.log(
    `[eval-v2] ${prompts.length}/${dataset.prompts.length} cases, tutor=${tutorConfigurationLabel}, judge=${judgeModel}`,
  );
  const results: PromptResult[] = [];
  for (const [index, prompt] of prompts.entries()) {
    process.stdout.write(`[eval-v2] ${index + 1}/${prompts.length} ${prompt.id} ... `);
    const result = await runPrompt(prompt, apiKey, tutorConfiguration, judgeModel);
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
    tutorModel: tutorConfigurationLabel,
    judgeModel,
    routingPolicyVersion: productionRouting
      ? PLATFORM_TUTOR_ROUTING_POLICY_VERSION
      : null,
    tutorModels: [...new Set(results.map((result) => result.tutorModel))].sort(),
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
