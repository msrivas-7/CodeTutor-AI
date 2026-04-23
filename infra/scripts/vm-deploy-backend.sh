#!/usr/bin/env bash
# VM-side backend deploy with inline rollback on health-check failure.
# Called by .github/workflows/deploy.yml via az vm run-command after the
# caller has already done `git fetch` + `git reset --hard origin/main`.
#
# Why not systemctl restart? Because restarting the whole service takes Caddy
# down too (~10s of TLS interruption). `docker compose up -d backend` only
# recreates the backend container; Caddy keeps serving, and in-flight TLS
# connections survive the backend bounce.
#
# Image pinning: docker-compose still references ${IMAGE}:latest (the .env
# written by refresh-env is left alone so reboots don't diverge), but every
# deploy pulls the specific ${IMAGE}:${NEW_SHA} tag from GHCR and retags it
# to :latest locally. This replaces a floating GHCR :latest pull with an
# immutable SHA pull — what ran in CI is what runs in prod.
#
# Health gate: we poll /api/health/deep (not the shallow /api/health), so the
# rollback fires when Postgres or the docker socket-proxy dep is broken — not
# just when the process is alive. The shallow endpoint is kept for external
# uptime probes that only want "is the HTTP listener up?".
#
# Rollback: if health fails, pull ${IMAGE}:${PREV_SHA} (already in GHCR from
# the last deploy) and retag it to :latest, then compose up. Falls back to
# the local :rollback tag if the PREV_SHA pull fails (e.g. network blip).
set -u

PREV_SHA="${1:?usage: $0 <prev-sha> <new-sha>}"
NEW_SHA="${2:?usage: $0 <prev-sha> <new-sha>}"

COMPOSE_ARGS=(-f docker-compose.yml -f docker-compose.prod.yml --env-file .env)
IMAGE=ghcr.io/msrivas-7/codetutor-backend
HEALTH_URL=http://127.0.0.1:4000/api/health/deep
HEALTH_ATTEMPTS=10
HEALTH_INTERVAL=3

as_codetutor() { sudo -u codetutor "$@"; }

cd /opt/codetutor || { echo "DEPLOY_FAILED: /opt/codetutor missing"; exit 1; }
echo "prior HEAD: $PREV_SHA"
echo "deploying : $NEW_SHA"

# Snapshot the currently-running image as :rollback before pulling new :latest.
# If the image doesn't exist locally (first-ever deploy), skip — nothing to
# roll back to, and the inline `|| true` keeps set -u from tripping.
if as_codetutor docker image inspect "${IMAGE}:latest" > /dev/null 2>&1; then
  as_codetutor docker tag "${IMAGE}:latest" "${IMAGE}:rollback" || true
fi

deploy_ok=false
if as_codetutor docker pull "${IMAGE}:${NEW_SHA}" \
  && as_codetutor docker tag "${IMAGE}:${NEW_SHA}" "${IMAGE}:latest" \
  && as_codetutor docker compose "${COMPOSE_ARGS[@]}" up -d backend; then
  for _ in $(seq 1 "$HEALTH_ATTEMPTS"); do
    if curl -fsS "$HEALTH_URL" > /dev/null 2>&1; then
      deploy_ok=true
      break
    fi
    sleep "$HEALTH_INTERVAL"
  done
fi

if $deploy_ok; then
  echo DEPLOY_OK
  exit 0
fi

echo "DEPLOY_FAILED: backend did not come healthy - rolling back to $PREV_SHA"
# S-5 (bucket 7): do NOT swallow a failed reset. If reset fails (dirty tree,
# missing SHA after shallow clone), the on-disk compose+cloud-init files are
# still from $NEW_SHA while we retag the image to $PREV_SHA — the stack comes
# back up with mismatched env shape. Emit a distinct sentinel so the
# workflow pages instead of silently half-rolling-back.
if ! as_codetutor git reset --hard "$PREV_SHA"; then
  echo "DEPLOY_FAILED_ROLLBACK_RESET: git reset --hard $PREV_SHA failed — compose files may be forward of image"
  exit 2
fi
# Prefer an explicit pull of the prior SHA — survives local cache eviction
# and VM rebuilds. Fall through to the local :rollback tag if GHCR is
# unreachable.
if as_codetutor docker pull "${IMAGE}:${PREV_SHA}" > /dev/null 2>&1; then
  as_codetutor docker tag "${IMAGE}:${PREV_SHA}" "${IMAGE}:latest" || true
elif as_codetutor docker image inspect "${IMAGE}:rollback" > /dev/null 2>&1; then
  as_codetutor docker tag "${IMAGE}:rollback" "${IMAGE}:latest" || true
fi
as_codetutor docker compose "${COMPOSE_ARGS[@]}" up -d backend || true
sleep 5
echo DEPLOY_ROLLBACK_ATTEMPTED
exit 1
