import type { Language } from "../commands.js";

// v2 envelope: HMAC-signed payload, subprocess-isolated harness (Phase 16).
// v1 envelope (which user code could forge at container stdout level) is
// incompatible with v2 on purpose — a parser that sees a v1 sentinel will not
// find a matching v2 sentinel and reject the run.
export const TEST_SENTINEL = "__CODETUTOR_TESTS_v2_a8f3b1c7d2e4f5a6__";

// Marker pair emitted by the per-test driver around `repr(actual)` /
// `JSON.stringify(actual)`. Not secret — it just frames the result inside a
// subprocess's stdout so the parent harness can separate the actual return
// value from anything the learner's code printed. User code *can* emit a
// fake marker block with a made-up value for a visible test; the gain is
// zero because the learner already knows what the visible test expects.
// Hidden tests can't be forged because the parent never hands the expected
// value to the subprocess — it's only ever in the parent's memory.
export const RESULT_MARKER = "__CODETUTOR_RESULT_v2__";
export const RESULT_ERR_MARKER = "__CODETUTOR_RESULT_v2_ERR__";

export interface FunctionTest {
  name: string;
  call: string;
  expected?: string;
  expectedError?: {
    type: string;
    message?: string;
  };
  beforeLoad?: string;
  setup?: string;
  hidden?: boolean;
  category?: string;
}

export interface SourceCheck {
  name: string;
  file?: string;
  kind:
    | "python_list_comprehension"
    | "python_dict_comprehension"
    | "python_set_comprehension"
    | "python_generator_expression"
    | "python_while_loop"
    | "python_with_statement"
    | "python_specific_except"
    | "python_raise"
    | "python_call"
    | "python_lambda"
    | "python_yield";
  target?: string;
  scope?: string;
  minCount?: number;
  hidden?: boolean;
  category?: string;
  feedback: string;
}

export interface HarnessSuite {
  tests: FunctionTest[];
  sourceChecks: SourceCheck[];
}

export interface TestCaseResult {
  name: string;
  hidden: boolean;
  category: string | null;
  passed: boolean;
  actualRepr: string | null;
  expectedRepr: string | null;
  stdoutDuring: string;
  error: string | null;
  feedback?: string | null;
  evidence?: "behavior" | "source";
}

export interface TestReport {
  results: TestCaseResult[];
  harnessError: string | null;
  cleanStdout: string;
}

export interface HarnessFile {
  name: string;
  content: string;
}

// Per-language plug-in. Each implementation owns the bits that differ between
// runtimes — which files to drop into the workspace and what shell command to
// run. Envelope parsing (sentinel extraction + HMAC verify + JSON decode) is
// language-agnostic and lives in runHarness.
export interface HarnessBackend {
  language: Language;
  prepareFiles(suite: HarnessSuite): HarnessFile[];
  execCommand(): string;
}

export interface RunTestsResult {
  report: TestReport;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  durationMs: number;
}
