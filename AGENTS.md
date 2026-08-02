# CodeTutor AI agent guide

This file is the small, always-loaded map for coding agents. Keep it concise.
Detailed product and architecture truth belongs in the linked tracked docs;
machine-local discoveries belong in `.agent-harness/PROJECT_MEMORY.md`.

## Required start loop

Before every feature, fix, refactor, migration, or review-driven change:

1. Confirm the Git root and inspect the worktree. Preserve unrelated changes.
2. Classify browser impact before editing. Browser-observable work is the default:
   `node scripts/agent-harness.mjs start --feature "<short name>" --scope <scope> --findings <UX-ids>`.
   Use `--browser-impact none --browser-bypass "<concrete reason>"` only when
   no user-visible browser flow can be affected. UX findings may never bypass.
3. Read the scoped harness output and the relevant source-of-truth docs below.
4. Establish the smallest useful baseline check before editing.
5. Work on one coherent slice at a time; do not declare a larger phase complete
   from a partial or filtered test run.

Scopes are `frontend`, `backend`, `database`, `e2e`, `infra`, `content`,
`ai-evals`, `release`, or `all`. Use a comma-separated list when needed.

## Required learning loop

Use the harness command instead of relying on chat memory:

- Run important validation with
  `node scripts/agent-harness.mjs run --session <id> --scope <scope> -- <command>`.
- Compound shell validations must start with `set -euo pipefail`; the harness
  rejects composites that could hide an earlier failure behind a later success.
- If that command fails, the harness creates a pending incident. Diagnose it,
  then resolve it before finishing. Never record a guess as a root cause.
- Record a reusable lesson when a failure repeats, a review exposes a hidden
  rule, an environment issue costs meaningful time, or a non-obvious coupling
  is discovered:
  `node scripts/agent-harness.mjs record --scope <scope> --symptom "..." --cause "..." --prevention "..." --evidence "..." --confidence verified`.
- Prefer converting verified lessons into tests, linters, types, scripts, or CI
  checks. Memory is a navigation aid; executable enforcement is the end state.
- Do not store secrets, credentials, personal data, speculative conclusions,
  transient task status, or facts that are obvious from the code.
- Retire stale knowledge with `node scripts/agent-harness.mjs retire --id <id>
  --reason "..."`; never silently rewrite history.

The living memory is gitignored by design. Read it through `context`/`start` so
only relevant entries consume context. See
[agent harness strategy](docs/AGENT_HARNESS_STRATEGY.md) for the evidence model,
promotion rules, lifecycle, and research behind this loop.

## Required finish loop

Before a phase commit, push, pull request update, or handoff:

1. After fixing each named finding, use the actual Browser/Chrome control skill,
   or Computer Use when the finding specifically requires a native browser,
   and record a passing finding-level audit with
   `node scripts/agent-harness.mjs browser-audit ... --level finding`. Scripted
   Playwright is supporting evidence and cannot replace this interaction.
2. Test the complete phase together in the live browser against the final code,
   including its entry point, happy path, failure/recovery, every adversarial
   interaction relevant to its state and risk surface, viewport/theme coverage,
   focus result, and screenshots. This is not a one-case quota: test repeats,
   interruption, collision, boundary, stale-state, and misuse paths wherever
   they can exist. Record
   it with `node scripts/agent-harness.mjs browser-audit ... --level phase`.
3. Run the relevant deterministic checks. Resolve or explicitly classify every
   failed command or failed browser audit.
4. Inspect the final diff, stage exactly the intended phase files, and confirm
   no unrelated work, generated cache, or secret entered the staged change.
5. Record only verified, reusable discoveries; avoid diary-style notes.
6. Run `node scripts/agent-harness.mjs doctor`.
7. Finish the session with
   `node scripts/agent-harness.mjs finish --session <id> --summary "..." --tests "..."`.
   Finish refuses stale/missing browser evidence and fingerprints the staged
   phase. The tracked pre-commit hook reruns `agent-harness.mjs pre-commit` and
   rejects any different or unfinished staged change.
8. Update the long-running PR description with the phase, findings, live-browser
   evidence, checks, deployment state, and review resolution. A phase is not
   complete until CI is green and every actionable PR comment is resolved.
9. Leave the worktree in a state another engineer can understand from Git,
   tracked docs, and the harness handoff without conversation history.

The copyable evidence contract is in
[browser UX audit evidence](docs/templates/BROWSER_UX_AUDIT_EVIDENCE.md).

## Source-of-truth map

- Product overview and commands: [README.md](README.md)
- Local development: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)
- Architecture and trust boundaries: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Content authoring: [docs/CONTENT_AUTHORING.md](docs/CONTENT_AUTHORING.md)
- Current contextual-learning roadmap:
  [docs/CONTEXTUAL_LEARNING_AND_DELIVERY_VELOCITY_PLAN.md](docs/CONTEXTUAL_LEARNING_AND_DELIVERY_VELOCITY_PLAN.md)
- UI/UX quality source of truth: [docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md)
  when present, plus the current roadmap and audited personas under local
  `.claude/` material.
- Database truth: ordered files under `supabase/migrations/`; use the
  authenticated Supabase CLI through the pinned `npx` version documented by the
  harness, and verify the intended project before remote changes.
- CI truth: `.github/workflows/`; do not infer CI coverage from local tests.

## Non-negotiable quality rules

- Server boundaries own authorization, quota, lesson/mastery context, and
  protected data. Client-provided context is untrusted.
- Database changes are forward migrations with RLS and real integration
  evidence; never edit already-applied history to simulate a migration.
- AI teaching changes need deterministic safety checks plus the complete model
  gate. Focused evals aid development but cannot establish eligibility. After
  final formatting or any other change to a fingerprinted quality-contract
  file, rerun the baseline verifier before committing.
- UI changes require keyboard, focus, responsive, reduced-motion, loading,
  empty, error, and recovery-state review—not only a happy-path screenshot.
- Local Playwright setup verifies reachability but does not rebuild containers;
  rebuild every changed app service before using browser results as evidence.
- Rerun a clearly flaky CI shard once with evidence; repeated failure is a bug
  or harness incident, not permission to weaken the assertion.
- Stage and commit only intended files. Never discard user changes to obtain a
  clean worktree.
