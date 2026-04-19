import type { Language } from "../commands.js";

export const TEST_SENTINEL = "__CODETUTOR_TESTS_v1_da39a3ee5e6b4b0d__";

export interface FunctionTest {
  name: string;
  call: string;
  expected: string;
  setup?: string;
  hidden?: boolean;
  category?: string;
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
// runtimes — which files to drop into the workspace, what shell command to
// run, and how to parse stdout — while runHarness owns the write/exec/cleanup
// choreography.
export interface HarnessBackend {
  language: Language;
  prepareFiles(tests: FunctionTest[]): HarnessFile[];
  execCommand(): string;
  parseOutput(stdout: string, stderr: string): TestReport;
}

export interface RunTestsOptions {
  containerId: string;
  workspacePath: string;
  tests: FunctionTest[];
  timeoutMs?: number;
}

export interface RunTestsResult {
  report: TestReport;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  durationMs: number;
}
