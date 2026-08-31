import type { FullResult, Reporter, TestCase, TestResult } from "@playwright/test/reporter";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

type TimingRecord = {
  durationMs: number;
  status: TestResult["status"];
};

export default class DurationReporter implements Reporter {
  private readonly outputFile: string;
  private readonly tests = new Map<string, TimingRecord>();

  constructor(options: { outputFile?: string } = {}) {
    const configured = options.outputFile ?? process.env.E2E_TIMING_OUTPUT;
    if (!configured) throw new Error("duration reporter requires outputFile or E2E_TIMING_OUTPUT");
    this.outputFile = resolve(configured);
  }

  onTestEnd(test: TestCase, result: TestResult) {
    this.tests.set(test.id, {
      durationMs: Math.max(0, Math.round(result.duration)),
      status: result.status,
    });
  }

  onEnd(result: FullResult) {
    mkdirSync(dirname(this.outputFile), { recursive: true });
    writeFileSync(this.outputFile, `${JSON.stringify({
      schemaVersion: 1,
      status: result.status,
      tests: Object.fromEntries([...this.tests.entries()].sort(([left], [right]) => left.localeCompare(right))),
    }, null, 2)}\n`);
  }
}
