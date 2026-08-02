## Product outcome

Briefly describe what changes for the learner or operator.

## Phase ledger

Keep every completed phase in this table for the life of the long-running PR.

| Phase | Commit | Findings | Live-browser evidence | Scripted checks / CI | Review status | Deployment |
| --- | --- | --- | --- | --- | --- | --- |
| Q0 | pending | harness only | justified non-browser bypass | pending | pending | n/a |

## Current phase evidence

- Harness session:
- Real entry point:
- Happy path:
- Failure/recovery path:
- Adversarial interaction:
- Viewports/themes/focus:
- Screenshots (local harness paths; never attach sensitive UI):
- Residual limitations:

## Completion checklist

- [ ] Every finding assigned to this phase has an individual live-browser pass.
- [ ] The full phase has a combined live-browser pass covering every adversarial interaction relevant to its state and risk surface on the final staged change.
- [ ] Relevant deterministic checks pass locally.
- [ ] CI is green; a flaky shard was rerun only once and only when evidence justified it.
- [ ] Every actionable review comment is fixed and resolved.
- [ ] The PR description and phase ledger reflect the current commit and evidence.
- [ ] Deployment/preview behavior was verified where the phase requires it.
