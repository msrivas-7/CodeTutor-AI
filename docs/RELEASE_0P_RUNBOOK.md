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
4. Remove only superseded local CodeTutor image references, then require at
   least 8 GiB of free space before pulling anything.
5. Pull the selected digest references before changing any alias.
6. Promote runner first, then backend.
7. Recreate only the backend and require `/api/health/deep` to pass.
8. Compare the running backend image ID with the manifest digest.
9. Repeat the safe CodeTutor-only cleanup and headroom check after identity and
   health pass.

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

## Recovering after a failed release

Path-based promotion scope normally describes the commit that triggered the
run. If an application release fails and the next main-branch commit changes
only tests, that follow-up run does not automatically infer the unpromoted
application changes from the earlier commit.

After the corrective commit is merged and its automatic release is green:

1. Confirm production still reports the older SHA.
2. Open **Actions → Production release → Run workflow** on `main`.
3. Enable **Promote every tested artifact**.
4. Require the forced run's complete CI, E2E, and security gates to pass.
5. Verify `/release.json` and deep health report the forced run's SHA before
   beginning browser acceptance.

This builds and tests a fresh immutable candidate from the complete current
`main` branch. Do not rerun the older failed SHA and do not manufacture a
browser-facing source change merely to trigger deployment.

## Automatic VM rollback

`infra/scripts/vm-promote-candidate.sh` restores the prior Git SHA and both
local image aliases when pull, environment refresh, retag, backend recreate,
deep health, or image-identity verification fails. The workflow requires a
`PROMOTION_OK` sentinel; Azure's outer command success is not sufficient.

The script has executable tests for successful digest promotion, failed-image
pull isolation, and failed-health-check rollback. These run in normal CI.

## Disk headroom and local image retention

Every normal promotion and manual rollback uses the same retention boundary in
`infra/scripts/vm-promote-candidate.sh`. It is deliberately narrower than
`docker system prune`:

- protect the image ID used by every existing container, whether running or
  stopped;
- protect the current backend and runner `:latest` aliases;
- protect one backend and runner `:rollback` alias, which is refreshed from the
  current deployment before each promotion;
- protect an already-present incoming digest during the pre-pull pass;
- fail closed when Docker cannot enumerate containers or CodeTutor images;
  tolerate only a container proven to have disappeared between list and
  inspection (normal for short-lived learner runners);
- remove references only from the two CodeTutor GHCR repositories, never from
  unrelated images, containers, volumes, networks, or build cache;
- never use force deletion; an unexpected Docker ownership conflict remains in
  place and is reported rather than bypassed.

Cleanup runs before candidate pulls, after a verified promotion, and after an
automatic rollback. The pre-pull and post-promotion gates both require at least
8 GiB free on the filesystem containing `/opt/codetutor`. If protected images
still leave less space, promotion fails closed; before-pull failure restores the
previous Git SHA without downloading a candidate, and post-promotion failure
uses the normal automatic rollback before removing the unreferenced candidate.

The VM keeps only the current deployment plus one immediately usable local
rollback generation. Older successful candidates remain recoverable through
their 30-day release artifact and immutable GHCR digest, and the manual rollback
workflow pulls the selected retained digest when needed.

Promotion evidence includes `IMAGE_RETENTION`, `IMAGE_RETENTION_BLOCKED`,
`DISK_HEADROOM`, and `DISK_HEADROOM_FAILED` records with the phase, before/after
free kilobytes, required floor, and removal counts. Treat a blocked reference or
failed headroom gate as an operational signal to inspect containers and disk
usage; do not replace the policy with a broad prune.

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
| Protected images leave less than 8 GiB free | None, or automatic rollback if discovered after retag | Inspect retention/headroom evidence and unexpected containers; expand disk if the current + rollback pair legitimately needs more space |
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

## Live drill record

The required first controlled production drill passed on 2026-08-31:

- rollback run
  [`33409584774`](https://github.com/msrivas-7/CodeTutor-AI/actions/runs/33409584774)
  promoted successful retained candidate
  `297a09b4d4873d10e1b1e688f151f8a3a325fcb3` in 2m39s;
- cache-busted frontend identity and backend deep health independently passed on
  the rolled-back candidate;
- forced forward release
  [`33409904066`](https://github.com/msrivas-7/CodeTutor-AI/actions/runs/33409904066)
  restored exact current candidate
  `4edcd73fa3a8669ac09495fbb7d5234d8ccfc742` after the complete CI, E2E, and
  security gate;
- production synthetic
  [`33411478984`](https://github.com/msrivas-7/CodeTutor-AI/actions/runs/33411478984)
  passed on the restored SHA;
- in-app Browser phase audit `fcaf8da5-d989-46be-8f94-3f634c469050`
  passed the anonymous Contextual Tutor journey at desktop and 390×844,
  duplicate-click admission, focus restoration, and zero-console-error checks;
- no database migration existed between the rollback and forward candidates.
