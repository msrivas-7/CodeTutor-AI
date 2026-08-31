# Security suite

Claims-verification harness. Every documented security claim in the
sandbox + grading architecture has exactly one scenario here that tries
to violate it. If a claim has no scenario, it's a lie. If a scenario
has no claim, it's theater.

This suite is **not** a pen-test — it catches regressions (someone
accidentally drops `--network=none`, a runner-image rebuild loses a
capability), not novel kernel 0-days. Pair with base-image patching +
runtime monitoring (Falco/Tetragon) for a complete story.

## Run locally

```bash
# from repo root — the API-only suite needs the backend and its runner/proxy
# dependencies; Compose starts those dependencies automatically.
docker compose up -d backend

# tcpdump is optional locally. If absent, egress tests fall back to
# the backend-level assertion only (no packet-level observer).
cd e2e
npm ci
npx playwright test --config=security-suite/playwright.config.ts

# single scenario
npx playwright test --config=security-suite/playwright.config.ts S4_resources
```

## Scenario → claim matrix

| Scenario | Claim(s) enforced | File |
|----------|-------------------|------|
| S1a | C2 network=none (DNS) | `scenarios/S1_egress.spec.ts` |
| S1b | C2 network=none (TCP egress) | `scenarios/S1_egress.spec.ts` |
| S1c | C2 network=none (cloud IMDS) | `scenarios/S1_egress.spec.ts` |
| S1d | C2 network=none + sandbox:no-docker-socket | `scenarios/S1_egress.spec.ts` |
| S1e | C2 network=none (host gateway) | `scenarios/S1_egress.spec.ts` |
| S2a | C1 non-root UID 1100 | `scenarios/S2_privileges.spec.ts` |
| S2b | C3 capabilities dropped (CAP_SYS_ADMIN → mount) | `scenarios/S2_privileges.spec.ts` |
| S2d | C5 no-new-privileges (kernel-level) | `scenarios/S2_privileges.spec.ts` |
| S2e | C3 capabilities dropped (user namespace) | `scenarios/S2_privileges.spec.ts` |
| S2f | C5 no-new-privileges (structural — image-strip) | `scenarios/S2_privileges.spec.ts` |
| S3a | C4 read-only rootfs | `scenarios/S3_filesystem.spec.ts` |
| S3b | C10 tmpfs 64 MB | `scenarios/S3_filesystem.spec.ts` |
| S3c | C10 tmpfs nosuid | `scenarios/S3_filesystem.spec.ts` |
| S3d | C13 symlink traversal defense (route layer) | `scenarios/S3_filesystem.spec.ts` |
| S3e | cross-tenant workspace isolation | `scenarios/S3_filesystem.spec.ts` |
| S4a | C8 PidsLimit 256 + host sentinel | `scenarios/S4_resources.spec.ts` |
| S4b | C6 memory cap + host sentinel | `scenarios/S4_resources.spec.ts` |
| S4c | C7 CPU cap + C12 wall-clock | `scenarios/S4_resources.spec.ts` |
| S4d | C11 output per-line cap 8 KB (regression) | `scenarios/S4_resources.spec.ts` |
| S4e | C12 wall-clock timeout under output activity | `scenarios/S4_resources.spec.ts` |
| S4f | C9 ulimit nofile 256 | `scenarios/S4_resources.spec.ts` |
| S5a | C11 output cap (negative control — normal output not clipped) | `scenarios/S5_output.spec.ts` |
| S6a | C14 session ownership (cross-user exec) | `scenarios/S6_session.spec.ts` |
| S6b | C14 session ownership (handle forgery) | `scenarios/S6_session.spec.ts` |
| S7a | harness:golden-path (sanity) | `scenarios/S7_negative.spec.ts` |
| S7b | harness:error-path (sanity) | `scenarios/S7_negative.spec.ts` |
| S7c | harness:sentinel-baseline (sanity) | `scenarios/S7_negative.spec.ts` |
| S8a | grading:no-forge-verdict | `scenarios/S8_hmac_nonce.spec.ts` |
| S8c | grading:nonce-not-leaked | `scenarios/S8_hmac_nonce.spec.ts` |
| S8d | grading:hidden-tests-hidden | `scenarios/S8_hmac_nonce.spec.ts` |
| S8e | grading:malformed-envelope-rejected | `scenarios/S8_hmac_nonce.spec.ts` |
| S8f | grading:envelope-required | `scenarios/S8_hmac_nonce.spec.ts` |
| S8g | grading:backend-only-verification | `scenarios/S8_hmac_nonce.spec.ts` |

### Not covered here on purpose

- **S2c** (ptrace attach on a sibling) — same-UID ptrace is standard
  Unix behavior, gated by YAMA not by CAP_SYS_PTRACE. In a single-tenant
  per-session sandbox every "sibling" is the attacker's own process, so
  allowing ptrace-self is both expected and harmless. The meaningful
  boundary (no cross-tenant ptrace, no escape from the PID namespace)
  is enforced by the sandbox *topology* — one container per session —
  which is verified end-to-end by S3e (cross-tenant isolation).
- **S8b** (replay captured envelope across backend restarts) —
  deliberately omitted at this layer. The replay-cache behavior lives
  in `runHarness.ts` and is tested in `backend/…/trust.test.ts`. An
  end-to-end replay across a full backend restart needs orchestration
  we don't currently have; the unit test is the right place for that
  check until (if ever) the nonce cache is persisted.
- **Kernel CVE probes by CVE number.** These rot fast and give false
  confidence after a patch. The capability-class tests in S2 catch the
  equivalent behavior without depending on specific CVE details.
- **Timing side-channels across tenants.** Hard to assert reliably in
  CI — flaky tests erode trust faster than the threat warrants.

## How to add a new scenario

1. Add the claim to the architecture map (runner Dockerfile, localDocker.ts,
   or equivalent) with a comment naming the claim id (e.g. `// CLAIM C17`).
2. Pick the right category file (S1-S8) — or create S9+ if a new axis.
3. Inside the test, call `scenario({ id, claim, summary })` as the first
   line. The fixture fails the test if you skip this — every scenario
   must self-document what claim it's verifying.
4. Update this README's matrix.

## Anti-patterns we refuse

- ❌ CVE-by-number tests (false confidence after patch).
- ❌ Asserting only on stdout (attacker controls stdout).
- ❌ Relaxed sandbox config in the suite vs. prod.
- ❌ Retries on security failures.
- ❌ Tests without a `claim` field.
