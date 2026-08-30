# Release 1C contextual Tutor release packet

## Product change

When a learner preserves the same lesson-authored error across an edit and a
second run, the existing deterministic guide may offer **Help me spot it**.
Nothing is sent to AI and no Tutor credit is consumed until the learner clicks.
The accepted turn then uses the latest server-validated code/run evidence to
provide one specific diagnosis, one authored thinking question, one bounded
hint, and a canonical file/line reference without revealing the answer.

## Trust and lifecycle

- The browser carries a versioned offer, but the server reconstructs the
  lesson-authored move and rejects mismatched lesson, evidence, revision,
  context epoch/version, path, line, error code, or scaffold level.
- Source code, stderr, conversation history, and browser fields remain
  untrusted prompt content. They cannot select the teaching contract.
- Acceptance is episode-idempotent in the client and request-idempotent at the
  existing server admission boundary.
- A source/context change invalidates an in-flight generation. Stale content is
  discarded and only the deterministic changed-code status is shown.
- `contextual_tutor_enabled` independently disables the AI offer while leaving
  deterministic guidance intact.

## Quality and cost evidence

The contextual corpus adds six live cases: normal assistance, malicious source
comment, malicious stderr, direct-answer pressure, stale hostile history, and
line-two evidence. Deterministic validation requires the exact latest-run
receipt, canonical citation, exactly one authored question, no extra scaffold,
and no answer leak.

Focused Luna evidence passed 6/6 twice. One representative run cost $0.046303
total, or $0.007717 per accepted call, with 35,887 input and 1,736 output tokens;
the contextual payload added about 280 input tokens versus the normal path.
The final production-routed artifact
`backend/eval/runs/2026-08-30T08-05-28-116Z-v2.json` passed all 72 cases,
every intent at 100%, and zero deterministic failures. It used the approved
`ab85a68e21449172…` quality-contract fingerprint; the independent baseline
verifier passed. The full run cost $0.55483 across all 72 judged cases.

## Browser evidence contract

The final phase replay must cover desktop, normal phone, short phone/software-
keyboard height, light/dark themes, reduced motion, keyboard/focus, dismissal,
double acceptance, editing during generation, unavailable/kill-switch recovery,
and screenshots. Scripted Playwright supports but does not replace this replay.

The final rebuilt local replay passed. Actual-browser evidence includes the
zero-charge offer, double-click one-call protection, current receipt and
citation, useful bounded response, dismissal persistence, target focus,
390×500 cue/target coexistence, light/dark themes, reduced motion, and stale
generation recovery. Finding audit:
`05f1c23e-b616-4e7b-b3fa-9c00e1e1e208`; phase audit:
`84ad08b1-9eff-44cb-90c4-c4b97cee4215`.

## Rollback

Turn off `contextual_tutor_enabled`. The deterministic error bridge remains;
the AI button becomes unavailable and no contextual model request is admitted.
If broader regression appears, revert the release commit after disabling the
switch. Existing Tutor traffic and lesson execution remain separate surfaces.

## Non-claims

The founder exception permits engineering completion without real-learner
experiment evidence. It does not establish learner recovery, retention,
differentiation, or calibrated human agreement with the automated judge.
