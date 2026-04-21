// /api/metrics — Prometheus exposition for lightweight external scraping.
// Three signals matter for steady-state ops:
//   - session_count: active runner containers. Should oscillate around low
//     single digits; a monotonic climb means the sweeper isn't catching
//     stale sessions (leaked-container detector).
//   - ai_tokens_consumed_total: OpenAI tokens across all users. Useful for
//     spotting a runaway history or a looped client burning spend.
//   - exec_duration_seconds: histogram of run-code latency by language +
//     ok. First-boot Rust compiles will pile the top bucket; steady-state
//     Python should sit under 1s.
//
// No scraper is wired yet — the endpoint ships ahead of the Prom stack so
// the instrumentation is live when we turn one on. Endpoint is public (no
// bearer): the data is aggregate-only and consistency with the Prometheus
// convention outweighs hiding magnitudes at this size. A Caddy path guard
// or env-bearer can be added later without touching these definitions.

import { Counter, Gauge, Histogram, Registry } from "prom-client";
import { listSessions } from "./session/sessionManager.js";

export const registry = new Registry();

// Gauge with a collect hook so the value is fresh on every scrape. Avoids
// threading an inc/dec through every session create + end + sweep path —
// the session map is the source of truth, we just read its size.
export const sessionCount = new Gauge({
  name: "session_count",
  help: "Number of active runner sessions.",
  registers: [registry],
  collect() {
    this.set(listSessions().length);
  },
});

export const aiTokensConsumed = new Counter({
  name: "ai_tokens_consumed_total",
  help: "OpenAI tokens consumed across all completions.",
  // `model` enables per-model cost breakdown; `kind` splits input vs
  // output so totals are directly priceable against OpenAI's rate card.
  labelNames: ["model", "kind"] as const,
  registers: [registry],
});

export const execDuration = new Histogram({
  name: "exec_duration_seconds",
  help: "Wall-clock duration of a runProject call.",
  labelNames: ["language", "ok"] as const,
  // Buckets tuned for our exec profile: compiled languages on cold Rust
  // first-boot hit 5-10s; steady-state Python sits under 500ms. Pinned
  // here (rather than taking prom-client defaults) so a library update
  // doesn't silently re-baseline historical histograms.
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});
