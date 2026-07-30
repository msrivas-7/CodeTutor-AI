# Release 0P — tested-artifact production promotion

## Purpose

Production must never deploy merely because a commit reached `main`. The
production release is one serialized transaction:

1. build immutable backend and runner images;
2. build the production frontend and managed-API bundle once;
3. record the Git SHA and artifact digests in `release-manifest.json`;
4. run CI, full E2E, and the security suite;
5. promote only the recorded artifacts if every gate succeeds;
6. verify the deployed identity and deep readiness.

PR preview environments remain separate and can never promote production.

## Authoritative workflows

- `.github/workflows/release.yml` — the only automatic production promotion.
- `.github/workflows/rollback-release.yml` — manual promotion of a previously
  successful, retained release candidate.
- `.github/workflows/azure-static-web-apps.yml` — PR previews and preview
  teardown only.
- `.github/workflows/ci.yml`, `e2e.yml`, and `security.yml` — direct PR gates
  and reusable gates called by the production release.

The former independent backend/runner production workflow was removed. SWA
production deployment was removed from the preview workflow.

## Candidate manifest

Every main-branch release stores `production-release-candidate-<git-sha>` for
30 days. Its manifest contains:

- full Git SHA and workflow run ID;
- immutable GHCR digest references for backend and runner;
- SHA-256 of the exact SWA archive;
- changed-component scope;
- database and partial-promotion compatibility contract;
- the required confidence gates.

Both normal promotion and rollback re-run the manifest verifier before any
production mutation. A SHA mismatch, mutable image reference, or modified SWA
archive stops the workflow.

## Normal promotion

The `production-release` concurrency group serializes candidate creation,
testing, and promotion across main pushes.

For VM changes:

1. Require the production migration version to equal the repository version.
2. Fetch and reset the VM to the manifest SHA, not the moving `origin/main`.
3. Snapshot both current local image aliases as `:rollback`.
4. Pull the selected digest references before changing any alias.
5. Promote runner first, then backend.
6. Recreate only the backend and require `/api/health/deep` to pass.
7. Compare the running backend image ID with the manifest digest.

For SWA changes:

1. Verify and extract the retained archive.
2. Use `skip_app_build: true`; Azure receives the already-built frontend.
3. Use `skip_api_build: true`; Azure receives the managed API with the exact
   dependency tree installed during candidate creation.
4. Fetch `/release.json` and require its Git SHA to equal the manifest SHA.

Backend is promoted before frontend. Changes must therefore follow
expand/contract compatibility: a new backend accepts the current frontend,
and database migrations remain backward-compatible through the promotion
window.

## Automatic VM rollback

`infra/scripts/vm-promote-candidate.sh` restores the prior Git SHA and both
local image aliases when pull, environment refresh, retag, backend recreate,
deep health, or image-identity verification fails. The workflow requires a
`PROMOTION_OK` sentinel; Azure's outer command success is not sufficient.

The script has executable tests for successful digest promotion, failed-image
pull isolation, and failed-health-check rollback. These run in normal CI.

## Manual full rollback

Use only a successful `Production release` run still inside artifact
retention.

1. Open **Actions → Roll back production release → Run workflow**.
2. Enter the successful release run ID.
3. Enter that run's full candidate SHA.
4. Enter `ROLLBACK_PRODUCTION` exactly.
5. Review the resulting VM, SWA, manifest, and readiness evidence artifact.

The rollback workflow proves the selected run name, conclusion, and SHA before
downloading anything. It then promotes the prior backend/runner digests and
the prior SWA archive. It does not rebuild from source.

Do not roll application code behind a destructive/contracted database schema.
Release migrations must remain expand/contract compatible until the rollback
window closes.

## Failure handling

| Failure | Production effect | Operator action |
|---|---|---|
| Candidate build fails | None | Fix build; no artifacts promoted |
| CI/E2E/security fails | None | Fix or rerun the failing gate; do not bypass |
| Migration drift | None | Apply reviewed expand migration, rerun release |
| VM pull/health/identity fails | Automatic VM rollback attempted | Inspect `vm-promotion.txt` and VM state before retry |
| SWA upload fails | Backend may already be newer; old frontend remains | Fix SWA, rerun same release; backend must stay backward-compatible |
| Post-deploy identity/readiness fails | Candidate may be live | Disable affected surface if needed; run retained-candidate rollback |
| Dirty VM worktree | None | Preserve and inspect the on-call change; never reset it automatically |

## Required evidence

A production release is complete only when the workflow is green and its
promotion-evidence artifact contains:

- the original and independently verified manifest;
- VM promotion sentinel/output when VM components changed;
- backend deep-health response when backend changed;
- frontend `/release.json` when frontend changed.

After the first 0P merge, perform one controlled rollback drill to the
previous successful 0P candidate and then forward-promote the latest candidate
again. Record both run URLs in the release issue/audit. The automated failure
harness is required pre-merge; the live drill is required before declaring
the operational release gate fully exercised.
