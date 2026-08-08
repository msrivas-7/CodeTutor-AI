# CodeTutor AI agent harness strategy

Status: active operating contract
Owner: repository maintainers
Last reviewed: 2026-07-31
Review cadence: every 90 days or after a material harness failure

## Purpose

The harness makes agent work compound instead of repeatedly rediscovering the
same repository-specific failure modes. It connects five activities into one
closed loop:

1. orient from a short, stable map;
2. retrieve only knowledge relevant to the current scope;
3. implement one coherent slice and validate it;
4. turn verified failures and review feedback into reusable prevention;
5. promote durable rules into executable checks and retire stale guidance.

The harness is not a substitute for code, tests, architecture docs, Git history,
or human judgment. It is an evidence-indexed bridge between them.

## Research basis

The design follows these primary sources:

- OpenAI's [Harness engineering](https://openai.com/index/harness-engineering/)
  recommends a short `AGENTS.md` as a map rather than a monolithic manual,
  progressive disclosure, repository-legible knowledge, mechanical validation,
  and feeding review/user feedback back into documentation or tooling.
- OpenAI's [AGENTS.md guide](https://developers.openai.com/codex/guides/agents-md)
  documents root-to-working-directory discovery and scoped precedence. This is
  why the root file contains only cross-repository rules and links.
- Anthropic's [Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
  found that incremental feature work, explicit progress artifacts, clean
  handoffs, Git checkpoints, and true end-to-end verification reduce premature
  completion and context-loss failures.
- Anthropic's [long-running application harness research](https://www.anthropic.com/engineering/harness-design-long-running-apps)
  treats planning, implementation, and evaluation as a generator-evaluator loop
  with hard thresholds, while warning that harness components should be tested
  and simplified as model capability changes.
- Anthropic's [Claude project memory guidance](https://code.claude.com/docs/en/memory)
  separates concise instructions from agent-written learnings, recommends
  specific verifiable rules, and notes that deterministic lifecycle behavior
  should be enforced mechanically rather than entrusted to prompt adherence.

## Architecture

### Tracked control plane

| Artifact | Responsibility |
| --- | --- |
| `AGENTS.md` | Short cross-agent startup, learning, and finish contract plus source map. |
| `CLAUDE.md` | Imports `AGENTS.md` so Claude Code and Codex share one contract. |
| `docs/AGENT_HARNESS_STRATEGY.md` | Human-readable design, evidence rules, and maintenance policy. |
| `scripts/agent-harness.mjs` | Tool-independent Node CLI for init, retrieval, incident capture, browser evidence, commit gating, resolution, retirement, and validation. |
| `scripts/agent-harness-seed.json` | Versioned bootstrap knowledge for a new checkout. |
| `scripts/agent-harness.test.mjs` | Contract and lifecycle regression tests. |
| `.githooks/pre-commit` | Rejects a staged diff unless it exactly matches a completed harness session. |
| `docs/templates/BROWSER_UX_AUDIT_EVIDENCE.md` | Copyable finding/phase evidence contract and narrow bypass policy. |
| `.github/PULL_REQUEST_TEMPLATE.md` | Long-running phase ledger for browser evidence, CI, reviews, and deployment. |
| Production dependency audit | Fails CI on unreviewed high/critical runtime advisories; exceptions require exact versions, a reason, and an expiry. |
| CI harness job | Proves the tracked bootstrap remains valid and the local store cannot be committed accidentally. |

### Gitignored learning plane

`.agent-harness/` is machine-local and may contain environment-specific details,
so the whole directory is ignored. It contains:

| Artifact | Responsibility |
| --- | --- |
| `PROJECT_MEMORY.md` | Rendered, readable current knowledge; never the canonical writable store. |
| `knowledge.json` | Canonical structured entries with scope, status, confidence, evidence, and review date. |
| `events.jsonl` | Append-only audit trail of captures, promotions, resolutions, and retirements. |
| `sessions/*.json` | Bounded feature handoffs and validation evidence. |
| `failures/*.json` | Pending failed commands that must be resolved or classified before finish. |
| `browser-evidence/` | Local screenshots referenced by structured live-browser audit records. |

`PROJECT_MEMORY.md` is generated from `knowledge.json`; agents must use the CLI
instead of making ad hoc edits that would destroy provenance.

## The operating loop

### 1. Start

`start` initializes the local store if needed, activates the tracked Git hooks,
records branch and commit state, opens a feature session, and prints only active
knowledge matching the supplied scope. Browser impact defaults to `required`.
Sessions that own audit finding ids cannot bypass it. A genuinely non-browser
session must declare `--browser-impact none` and persist a concrete explanation
of why no application runtime, response, content, style, or browser behavior can
change. A new agent should then read the linked tracked docs and run a small
baseline appropriate to the touched surface.

Every session also classifies design impact as `none`, `minor`, or `major`.
Major means a material change to the established visual style, layout model,
motion language, interaction pattern, information architecture, or product
narrative—not a normal implementation detail within an already approved
direction. A bug report identifies an unacceptable outcome but does not grant
permission to replace the underlying design. Major work requires the user's
explicit approval before implementation and a concrete record of the approved
direction via `--design-impact major --design-approval "..."`. If the scope
becomes major after start, `approve-design` records the decision. Generic claims
such as “user approved” are rejected, and agents may not manufacture approval.

### 2. Execute and observe

Important checks should run through `run`. Passing commands become session
evidence. Failed commands create a small pending incident without copying raw
logs or credentials into memory. The agent diagnoses from the live output.
Compound shell validations are accepted only with fail-fast behavior so a
later cleanup or reporting command cannot mask an earlier failed check.

### 3. Resolve

Every pending incident is classified as one of:

- `reusable`: a verified repository/tooling rule future work can apply;
- `product-defect`: the test correctly found a defect fixed in the change;
- `flake`: nondeterminism confirmed with rerun evidence and a containment plan;
- `environment`: a verified local/CI prerequisite or tool constraint;
- `non-reusable`: a one-off failure with no durable guidance.

Reusable, flaky, and environment incidents require a root cause, prevention,
and evidence. Product defects do not automatically become global guidance.

### 4. Exercise the real browser

For browser-observable work, scripted checks never complete the UX contract.
After each named finding is fixed, the agent must use the real Browser or Chrome
control skill and record a finding-level audit. The record includes the actual
entry point, successful path, failure/recovery path, all adversarial actions
relevant to that feature's state and risk surface, viewport/theme coverage,
focus result, environment, safe URL, and at least one local screenshot. There is
no one-action ceiling: repeat, interruption, collision, boundary, stale-state,
and misuse paths are required wherever they can exist. A failed browser audit
creates a normal pending incident.

After the individual passes, the final staged phase is exercised as one
cohesive journey and recorded at `phase` level. This last audit carries a hash
of the complete workspace state. `finish` rejects it if any later change makes
that evidence stale or if any declared finding is missing from the phase pass.

### 5. Promote

New knowledge starts as `candidate` unless the agent supplies reproducible
evidence and marks it `verified`. An identical candidate seen twice is promoted
automatically, but remains visibly marked as repetition-promoted until a human
or agent adds direct evidence. The ideal promotion path is:

`incident -> verified cause -> narrow prevention -> executable guard -> memory points to guard`

The harness rejects likely secrets and caps field sizes. Knowledge must be
specific enough to change a future action and narrow enough not to overfit.

### 6. Finish

`finish` refuses to close a session with unresolved failed commands or without
at least one passing validation captured through `run`. Commit-bound sessions
must have every intended file staged, no unstaged/untracked drift, complete
browser coverage or a valid non-browser reason, and a final phase audit matching
the staged fingerprint. It records the slice summary and checks, then runs
`doctor`. The pre-commit hook independently compares the staged diff with that
finished fingerprint; changing the diff requires repeating finish and, for UI
work, the combined browser pass. `finish --no-commit` exists only for explicit
review/handoff sessions and cannot authorize a commit.

For a session classified as a major design change, `finish` and `pre-commit`
also require the persisted user-approved direction. This mechanical gate does
not attempt to infer design magnitude from a diff; the always-loaded agent rule
owns truthful classification, while the CLI makes the approval auditable and
prevents an acknowledged major change from silently bypassing the decision.

The pull-request phase is complete only after the same commit has green CI, all
actionable review comments are resolved, and the cumulative PR phase ledger is
updated. Git remains the source of truth for code; local browser screenshots
stay gitignored while the PR records a concise evidence summary.

### 7. Garden

Every entry has a review date. `doctor` warns on overdue entries; `doctor
--strict` fails. Entries that no longer describe reality are retired with a
reason, preserved in the event log, and omitted from normal retrieval. Repeated
knowledge that can be encoded mechanically should be removed after the guard is
established and linked from the replacement entry.

## Evidence and quality model

Acceptable evidence includes a deterministic regression test, a migration
integration test, a linked CI run/check name, a minimal reproduction plus the
passing fix, authoritative tool documentation tied to observed behavior, or a
structured live-browser record produced from direct Browser/Chrome interaction.

The following are not evidence: a model's assertion, a single unexplained
failure, a passing filtered suite used to claim full coverage, stale chat
history, a standalone Playwright run presented as a manual UX pass, a screenshot
without the exercised path, or a rerun that passes without investigating
repeated failures.

Each entry includes:

- stable fingerprint and identifier;
- one or more scopes;
- symptom, verified root cause, and prevention;
- evidence and confidence;
- occurrence count, creation/update/review dates;
- state (`active` or `retired`) and optional enforcement pointer.

## Security and privacy

- The harness stores no command output, environment values, prompts, user data,
  tokens, passwords, connection strings, or copied production records.
- Secret-like values are rejected before persistence.
- Remote writes are never authorized by a memory entry; current task authority
  and target verification still apply.
- The gitignore and CI contract make accidental tracking of `.agent-harness/`
  a failure.
- Local memory is advisory. Server authorization, migrations, tests, and CI
  remain authoritative.

## Success measures

The harness is improving the system when:

- repeated preventable failures decline;
- setup and test-selection time declines without reducing final coverage;
- review comments increasingly become regression tests or lints;
- handoffs resume without re-investigating settled facts;
- stale entries are retired rather than accumulating;
- the short `AGENTS.md` stays stable while detailed knowledge grows locally;
- full gates remain full, and focused checks are clearly labeled as diagnostic.
- every browser-observable commit has current finding and phase evidence before
  the commit exists, without relying on a user reminder;
- PR phase ledgers make CI, review resolution, and deployment proof cumulative.

It is failing when entries become diary notes, speculative, secret-bearing,
contradictory, too broad, or a reason to skip direct inspection and testing.
