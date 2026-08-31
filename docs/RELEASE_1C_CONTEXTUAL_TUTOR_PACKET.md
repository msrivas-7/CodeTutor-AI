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
  untrusted prompt content. Python is parsed before learner code executes, and
  only that server-owned compile diagnostic can qualify the authored offer;
  runtime stderr cannot select or fund the teaching contract.
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
`backend/eval/runs/2026-08-31T04-51-10-727Z-v2.json` passed all 72 cases,
every intent at 100%, and zero deterministic failures. It used the approved
`c0866e3b97a0a7e8…` quality-contract fingerprint; the independent baseline
verifier passed. The full run cost $0.550599 across all 72 judged cases.

## Browser evidence contract

The final phase replay must cover desktop, normal phone, short phone/software-
keyboard height, light/dark themes, reduced motion, keyboard/focus, dismissal,
double acceptance, editing during generation, unavailable/kill-switch recovery,
and screenshots. Scripted Playwright supports but does not replace this replay.

The final rebuilt local replay passed. Actual-browser evidence includes the
zero-charge offer, double-click one-call protection, current receipt and
citation, useful bounded response, dismissal persistence, target focus,
390×500 cue/target coexistence, light/dark themes, reduced motion, and stale
generation recovery. The release-boundary replay also proved that forged
Python-looking runtime stderr cannot show or fund contextual help, while two
genuine parser failures still produce the authored guide. Finding audit:
`8a292b5d-dcb6-4678-9e24-11c330d0d987`; phase audit:
`41617175-7bc9-4905-982c-df5cf735438e`.

## Rollback

Turn off `contextual_tutor_enabled`. The deterministic error bridge remains;
the AI button becomes unavailable and no contextual model request is admitted.
If broader regression appears, revert the release commit after disabling the
switch. Existing Tutor traffic and lesson execution remain separate surfaces.

## Non-claims

The founder exception permits engineering completion without real-learner
experiment evidence. It does not establish learner recovery, retention,
differentiation, or calibrated human agreement with the automated judge.
