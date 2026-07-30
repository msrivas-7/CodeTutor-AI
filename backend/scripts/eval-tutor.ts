#!/usr/bin/env tsx
// Phase A — A4 eval substrate: tutor-quality regression runner.
//
// Reads `eval/tutor-golden-set.yaml`, calls openaiProvider.ask() once per
// prompt against the production tutor model (gpt-4.1-nano), grades each
// response with the judge model (gpt-4.1-mini, see ./judgeModel.ts) on a
// 3-dimension Y/N rubric (hallucination / socratic / grounded), aggregates
// pass-rates, writes `eval/runs/<ts>.json` where `<ts>` is an ISO
// timestamp with colons + dots replaced by dashes for filesystem safety.
//
// Flags:
//   --gate     Compare aggregate pass-rate against eval/baseline.json;
//              exit non-zero if drop > 5pp on any dimension.
//   --limit N  Only run the first N prompts. For smoke tests in CI/dev.
//
// Cost note: 30 prompts × 1 tutor call (nano) ≈ $0.005 + 90 judge calls
// (mini) ≈ $0.045 = ~$0.05 per full run. Bounded.
//
// Production guard: refuses to run when NODE_ENV=production unless
// ALLOW_PROD_EVAL=1 — prevents an accidental judge-model spend if this
// script is somehow invoked from a deployed container.

import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { openaiProvider } from "../src/services/ai/openaiProvider.js";
import { gradeRubric } from "./judgeModel.js";
import type { Language } from "../src/services/execution/commands.js";
import type { CompletionRule } from "../src/services/ai/prompts/lessonContext.js";

interface GoldenPrompt {
  id: string;
  intent: "debug" | "concept" | "howto" | "walkthrough" | "checkin";
  language: Language;
  lessonContext: {
    courseId: string;
    lessonId: string;
    lessonTitle: string;
    lessonOrder?: number;
    totalLessons?: number;
    teachesConceptTags: string[];
    usesConceptTags: string[];
    priorConcepts: string[];
  };
  userMessage: string;
  userFile: string;
  rubric: {
    hallucinationY: string;
    socraticY: string;
    groundedY: string;
  };
}

interface PromptResult {
  id: string;
  intent: GoldenPrompt["intent"];
  hallucinationPass: boolean;
  socraticPass: boolean;
  groundedPass: boolean;
  allPass: boolean;
  // Phase A — A4: Socratic-POSTURE rubric, graded separately from the
  // per-prompt socraticY line. Three fixed dimensions applied uniformly
  // to every prompt (see SOCRATIC_POSTURE_RUBRIC).
  posture: {
    tryFirstPass: boolean;
    noFullAnswerPass: boolean;
    engagesLearnerPass: boolean;
    allPass: boolean;
  };
  judgeRaw: { hallucination: string; socratic: string; grounded: string };
  rawTutorResponse: string;
  errorMessage?: string;
}

// Phase A — A4: the Socratic-posture rubric. Deliberately SEPARATE from
// the hallucination/grounded quality rubric — a response can be factually
// perfect and still violate the product's teaching posture (paste the
// answer, skip the diagnostic question). These three questions are fixed
// across all prompts so posture is comparable release-to-release; the
// per-prompt socraticY line stays as the coarse legacy signal.
const SOCRATIC_POSTURE_RUBRIC = {
  tryFirst:
    "Does the response invite the learner to TRY something themselves before more help is given — e.g., attempt a change, predict an output, or answer a diagnostic question? Answer Y only if there is a concrete try-first ask.",
  noFullAnswer:
    "Does the response WITHHOLD the complete final solution on this first turn? Answer Y if the learner still has meaningful work to do; answer N if the response contains a complete, copy-pasteable fix for the learner's task.",
  engagesLearner:
    "Does the response engage with THIS learner's specific code or words (referencing their variables, their error, or their phrasing) rather than answering generically?",
} as const;

interface RunSummary {
  timestamp: string;
  tutorModel: string;
  judgeModel: string;
  totalPrompts: number;
  succeeded: number;
  errored: number;
  passRate: { hallucination: number; socratic: number; grounded: number; all: number };
  // Phase A — A4: Socratic-posture pass rates (separate gate dimension).
  posturePassRate: {
    tryFirst: number;
    noFullAnswer: number;
    engagesLearner: number;
    all: number;
  };
  byIntent: Record<
    string,
    { count: number; passAll: number; passRate: number }
  >;
  perPrompt: PromptResult[];
}

const TUTOR_MODEL = "gpt-4.1-nano";
const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const GOLDEN_SET_PATH = path.join(REPO_ROOT, "eval/tutor-golden-set.yaml");
const RUNS_DIR = path.join(REPO_ROOT, "eval/runs");
const BASELINE_PATH = path.join(REPO_ROOT, "eval/baseline.json");
const PASS_RATE_DROP_THRESHOLD = 0.05; // 5pp

function parseArgs(argv: string[]): { gate: boolean; limit: number | null } {
  const gate = argv.includes("--gate");
  const limitIdx = argv.indexOf("--limit");
  const limit =
    limitIdx >= 0 && argv[limitIdx + 1] !== undefined
      ? Number(argv[limitIdx + 1])
      : null;
  if (limit !== null && (!Number.isFinite(limit) || limit <= 0)) {
    throw new Error(`--limit requires a positive integer, got: ${argv[limitIdx + 1]}`);
  }
  return { gate, limit };
}

function checkProdGuard(): void {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_PROD_EVAL !== "1") {
    throw new Error(
      "eval-tutor refusing to run in production. Set ALLOW_PROD_EVAL=1 to override.",
    );
  }
}

function getEvalApiKey(): string {
  const key = process.env.OPENAI_EVAL_API_KEY ?? process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error(
      "Missing OPENAI_EVAL_API_KEY (or OPENAI_API_KEY fallback). Set one to run the eval.",
    );
  }
  return key;
}

async function loadGoldenSet(): Promise<GoldenPrompt[]> {
  const raw = await fs.readFile(GOLDEN_SET_PATH, "utf8");
  const parsed = yaml.load(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`Golden set must be a YAML array; got ${typeof parsed}`);
  }
  return parsed as GoldenPrompt[];
}

async function runPrompt(
  prompt: GoldenPrompt,
  apiKey: string,
): Promise<PromptResult> {
  // Build the same shape the production /ask route would send. The eval
  // intentionally goes through `openaiProvider.ask()` (NOT through the
  // resolver) so we test the prompt-builder + model end-to-end without
  // needing platform-AI plumbing (caps, ledger writes, etc.).
  const fileName = prompt.language === "python" ? "main.py" : "index.js";
  let raw = "";
  try {
    const result = await openaiProvider.ask({
      key: apiKey,
      model: TUTOR_MODEL,
      fundingSource: "platform",
      question: prompt.userMessage,
      files: [{ path: fileName, content: prompt.userFile }],
      activeFile: fileName,
      language: prompt.language,
      lastRun: null,
      history: [],
      lessonContext: {
        courseId: prompt.lessonContext.courseId,
        lessonId: prompt.lessonContext.lessonId,
        lessonTitle: prompt.lessonContext.lessonTitle,
        language: prompt.language,
        lessonObjectives: [],
        teachesConceptTags: prompt.lessonContext.teachesConceptTags,
        usesConceptTags: prompt.lessonContext.usesConceptTags,
        priorConcepts: prompt.lessonContext.priorConcepts,
        completionRules: [] as CompletionRule[],
        studentProgressSummary: "",
        lessonOrder: prompt.lessonContext.lessonOrder,
        totalLessons: prompt.lessonContext.totalLessons,
      },
    });
    raw = result.raw;
  } catch (err) {
    return {
      id: prompt.id,
      intent: prompt.intent,
      hallucinationPass: false,
      socraticPass: false,
      groundedPass: false,
      allPass: false,
      posture: {
        tryFirstPass: false,
        noFullAnswerPass: false,
        engagesLearnerPass: false,
        allPass: false,
      },
      judgeRaw: { hallucination: "", socratic: "", grounded: "" },
      rawTutorResponse: "",
      errorMessage: (err as Error).message,
    };
  }

  // Grade the response on each rubric dimension. Six judge calls per
  // prompt (3 quality + 3 posture); aggregate `allPass` is strict AND
  // within each rubric family. Cost note: doubles judge spend to
  // ~$0.09/full run — still bounded.
  const [hall, soc, ground, tryFirst, noFull, engages] = await Promise.all([
    gradeRubric({
      apiKey,
      tutorResponse: raw,
      rubricQuestion: prompt.rubric.hallucinationY,
    }),
    gradeRubric({
      apiKey,
      tutorResponse: raw,
      rubricQuestion: prompt.rubric.socraticY,
    }),
    gradeRubric({
      apiKey,
      tutorResponse: raw,
      rubricQuestion: prompt.rubric.groundedY,
    }),
    gradeRubric({
      apiKey,
      tutorResponse: raw,
      rubricQuestion: SOCRATIC_POSTURE_RUBRIC.tryFirst,
    }),
    gradeRubric({
      apiKey,
      tutorResponse: raw,
      rubricQuestion: SOCRATIC_POSTURE_RUBRIC.noFullAnswer,
    }),
    gradeRubric({
      apiKey,
      tutorResponse: raw,
      rubricQuestion: SOCRATIC_POSTURE_RUBRIC.engagesLearner,
    }),
  ]);

  return {
    id: prompt.id,
    intent: prompt.intent,
    hallucinationPass: hall.pass,
    socraticPass: soc.pass,
    groundedPass: ground.pass,
    allPass: hall.pass && soc.pass && ground.pass,
    posture: {
      tryFirstPass: tryFirst.pass,
      noFullAnswerPass: noFull.pass,
      engagesLearnerPass: engages.pass,
      allPass: tryFirst.pass && noFull.pass && engages.pass,
    },
    judgeRaw: { hallucination: hall.raw, socratic: soc.raw, grounded: ground.raw },
    rawTutorResponse: raw,
  };
}

function aggregate(results: PromptResult[]): RunSummary {
  const succeeded = results.filter((r) => !r.errorMessage);
  const errored = results.filter((r) => r.errorMessage);

  const sum = (key: keyof Pick<PromptResult, "hallucinationPass" | "socraticPass" | "groundedPass" | "allPass">) =>
    succeeded.filter((r) => r[key]).length;

  const pass = (n: number) => (succeeded.length === 0 ? 0 : n / succeeded.length);

  // Group by intent for diagnostic.
  const byIntent: Record<string, { count: number; passAll: number; passRate: number }> = {};
  for (const r of succeeded) {
    const cell = byIntent[r.intent] ?? { count: 0, passAll: 0, passRate: 0 };
    cell.count += 1;
    if (r.allPass) cell.passAll += 1;
    byIntent[r.intent] = cell;
  }
  for (const k of Object.keys(byIntent)) {
    const cell = byIntent[k];
    cell.passRate = cell.count === 0 ? 0 : cell.passAll / cell.count;
  }

  const postureSum = (
    key: keyof PromptResult["posture"],
  ): number => succeeded.filter((r) => r.posture[key]).length;

  return {
    timestamp: new Date().toISOString(),
    tutorModel: TUTOR_MODEL,
    judgeModel: "gpt-4.1-mini",
    totalPrompts: results.length,
    succeeded: succeeded.length,
    errored: errored.length,
    passRate: {
      hallucination: pass(sum("hallucinationPass")),
      socratic: pass(sum("socraticPass")),
      grounded: pass(sum("groundedPass")),
      all: pass(sum("allPass")),
    },
    posturePassRate: {
      tryFirst: pass(postureSum("tryFirstPass")),
      noFullAnswer: pass(postureSum("noFullAnswerPass")),
      engagesLearner: pass(postureSum("engagesLearnerPass")),
      all: pass(postureSum("allPass")),
    },
    byIntent,
    perPrompt: results,
  };
}

async function compareAgainstBaseline(summary: RunSummary): Promise<{ ok: boolean; reasons: string[] }> {
  let baseline: RunSummary | null = null;
  try {
    const raw = await fs.readFile(BASELINE_PATH, "utf8");
    baseline = JSON.parse(raw) as RunSummary;
  } catch {
    return {
      ok: false,
      reasons: [
        `No baseline at ${BASELINE_PATH}. Run without --gate first; once you trust the result, copy the latest run JSON to baseline.json.`,
      ],
    };
  }

  const reasons: string[] = [];
  const dims: Array<keyof RunSummary["passRate"]> = ["hallucination", "socratic", "grounded", "all"];
  for (const dim of dims) {
    const drop = baseline.passRate[dim] - summary.passRate[dim];
    if (drop > PASS_RATE_DROP_THRESHOLD) {
      reasons.push(
        `Pass-rate on '${dim}' dropped ${(drop * 100).toFixed(1)}pp (baseline ${(baseline.passRate[dim] * 100).toFixed(1)}% → now ${(summary.passRate[dim] * 100).toFixed(1)}%); threshold is ${(PASS_RATE_DROP_THRESHOLD * 100).toFixed(0)}pp.`,
      );
    }
  }
  // Phase A — A4: gate the posture dimensions too. Pre-A4 baselines
  // don't carry posturePassRate — skip with a warning until the
  // baseline is refreshed (the gate must not fail on a schema gap).
  if (baseline.posturePassRate) {
    const pDims: Array<keyof RunSummary["posturePassRate"]> = [
      "tryFirst",
      "noFullAnswer",
      "engagesLearner",
      "all",
    ];
    for (const dim of pDims) {
      const drop = baseline.posturePassRate[dim] - summary.posturePassRate[dim];
      if (drop > PASS_RATE_DROP_THRESHOLD) {
        reasons.push(
          `Posture pass-rate on '${dim}' dropped ${(drop * 100).toFixed(1)}pp (baseline ${(baseline.posturePassRate[dim] * 100).toFixed(1)}% → now ${(summary.posturePassRate[dim] * 100).toFixed(1)}%); threshold is ${(PASS_RATE_DROP_THRESHOLD * 100).toFixed(0)}pp.`,
        );
      }
    }
  } else {
    console.warn(
      "[eval] baseline has no posturePassRate (pre-A4 baseline) — posture gate skipped; refresh baseline.json from the latest run to arm it.",
    );
  }
  return { ok: reasons.length === 0, reasons };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const { gate, limit } = parseArgs(argv);
  checkProdGuard();
  const apiKey = getEvalApiKey();

  console.log(`[eval] loading ${GOLDEN_SET_PATH}`);
  let prompts = await loadGoldenSet();
  if (limit !== null) {
    prompts = prompts.slice(0, limit);
    console.log(`[eval] --limit ${limit} → running first ${prompts.length} prompts`);
  }
  console.log(`[eval] running ${prompts.length} prompts against ${TUTOR_MODEL}, judge=gpt-4.1-mini`);

  const results: PromptResult[] = [];
  let i = 0;
  for (const p of prompts) {
    i += 1;
    process.stdout.write(`[eval] ${i}/${prompts.length} ${p.id} (${p.intent}) ... `);
    const r = await runPrompt(p, apiKey);
    if (r.errorMessage) {
      process.stdout.write(`ERROR: ${r.errorMessage}\n`);
    } else {
      const tag = r.allPass ? "PASS" : "FAIL";
      process.stdout.write(`${tag} (h=${r.hallucinationPass ? "Y" : "N"} s=${r.socraticPass ? "Y" : "N"} g=${r.groundedPass ? "Y" : "N"} | posture=${r.posture.allPass ? "Y" : "N"})\n`);
    }
    results.push(r);
  }

  const summary = aggregate(results);

  await fs.mkdir(RUNS_DIR, { recursive: true });
  const runFile = path.join(RUNS_DIR, `${summary.timestamp.replace(/[:.]/g, "-")}.json`);
  await fs.writeFile(runFile, JSON.stringify(summary, null, 2), "utf8");
  console.log(`\n[eval] run written: ${runFile}`);

  console.log(
    `[eval] succeeded ${summary.succeeded}/${summary.totalPrompts}, errored ${summary.errored}`,
  );
  console.log(
    `[eval] pass rates: hallucination=${(summary.passRate.hallucination * 100).toFixed(1)}% socratic=${(summary.passRate.socratic * 100).toFixed(1)}% grounded=${(summary.passRate.grounded * 100).toFixed(1)}% all=${(summary.passRate.all * 100).toFixed(1)}%`,
  );
  console.log(
    `[eval] posture:    tryFirst=${(summary.posturePassRate.tryFirst * 100).toFixed(1)}% noFullAnswer=${(summary.posturePassRate.noFullAnswer * 100).toFixed(1)}% engagesLearner=${(summary.posturePassRate.engagesLearner * 100).toFixed(1)}% all=${(summary.posturePassRate.all * 100).toFixed(1)}%`,
  );
  for (const [intent, cell] of Object.entries(summary.byIntent)) {
    console.log(
      `[eval]   ${intent}: ${cell.passAll}/${cell.count} (${(cell.passRate * 100).toFixed(1)}%)`,
    );
  }

  if (gate) {
    const cmp = await compareAgainstBaseline(summary);
    if (!cmp.ok) {
      console.error("\n[eval] GATE FAILED:");
      for (const r of cmp.reasons) console.error(`  - ${r}`);
      process.exit(1);
    }
    console.log("\n[eval] gate OK — pass rates within threshold.");
  }
}

// Suppress harmless ExperimentalWarning about ES modules + require under tsx.
process.removeAllListeners("warning");

main().catch((err) => {
  console.error(`[eval] fatal: ${(err as Error).message}`);
  process.exit(2);
});
