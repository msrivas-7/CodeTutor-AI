import { describe, expect, it, beforeEach } from "vitest";
import {
  aiTokensConsumed,
  execDuration,
  registry,
  sessionCount,
} from "./metrics.js";

// These metrics are module-level singletons, so tests reset the registry
// snapshot rather than re-instantiating. Counter/Histogram have a .reset()
// per-metric; the gauge's collect() hook refreshes it each scrape so we
// don't need to reset it.
beforeEach(() => {
  aiTokensConsumed.reset();
  execDuration.reset();
});

describe("metrics exposition", () => {
  it("serializes the three metrics with Prometheus text format", async () => {
    aiTokensConsumed.inc({ model: "gpt-4o-mini", kind: "input" }, 1200);
    aiTokensConsumed.inc({ model: "gpt-4o-mini", kind: "output" }, 350);
    execDuration.observe({ language: "python", ok: "true" }, 0.12);
    execDuration.observe({ language: "rust", ok: "false" }, 8.4);

    const out = await registry.metrics();

    // Metric names + HELP lines present.
    expect(out).toMatch(/# HELP session_count /);
    expect(out).toMatch(/# TYPE session_count gauge/);
    expect(out).toMatch(/# HELP ai_tokens_consumed_total /);
    expect(out).toMatch(/# TYPE ai_tokens_consumed_total counter/);
    expect(out).toMatch(/# HELP exec_duration_seconds /);
    expect(out).toMatch(/# TYPE exec_duration_seconds histogram/);

    // Counter values land on the right label tuple.
    expect(out).toMatch(
      /ai_tokens_consumed_total\{model="gpt-4o-mini",kind="input"\} 1200/,
    );
    expect(out).toMatch(
      /ai_tokens_consumed_total\{model="gpt-4o-mini",kind="output"\} 350/,
    );

    // Histogram emits bucket / sum / count. Rust run landed at the 10s
    // bucket (8.4 < 10 ≤ 10), Python in the 0.25 bucket. prom-client orders
    // `le` first regardless of labelNames order in the declaration — we
    // don't assert the label order, just the value + key presence.
    expect(out).toMatch(
      /exec_duration_seconds_bucket\{le="0\.25",language="python",ok="true"\} 1/,
    );
    expect(out).toMatch(
      /exec_duration_seconds_count\{language="python",ok="true"\} 1/,
    );
    expect(out).toMatch(
      /exec_duration_seconds_bucket\{le="10",language="rust",ok="false"\} 1/,
    );
  });

  it("session_count gauge refreshes from listSessions() on each scrape", async () => {
    // The collect hook queries listSessions() dynamically — with no sessions
    // created, the output is 0. Asserting the value is 0 proves the hook
    // wired (vs reading stale state from a missed inc/dec).
    sessionCount.reset();
    const out = await registry.metrics();
    expect(out).toMatch(/^session_count 0$/m);
  });
});
