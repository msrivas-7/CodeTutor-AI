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
# Rollback strategy: before pulling the new :latest, we retag the currently-
# cached :latest as :rollback. If the new image fails its health check, we
# `git reset --hard $PREV_SHA`, retag :rollback back to :latest, and
# `compose up -d` again — Caddy never moved, the backend just flips back.
set -u

PREV_SHA="${1:?usage: $0 <prev-sha>}"

COMPOSE_ARGS=(-f docker-compose.yml -f docker-compose.prod.yml --env-file .env)
IMAGE=ghcr.io/msrivas-7/codetutor-backend
HEALTH_URL=http://127.0.0.1:4000/api/health
HEALTH_ATTEMPTS=10
HEALTH_INTERVAL=3

as_codetutor() { sudo -u codetutor "$@"; }

cd /opt/codetutor || { echo "DEPLOY_FAILED: /opt/codetutor missing"; exit 1; }
echo "prior HEAD: $PREV_SHA"

# Snapshot the currently-running image as :rollback before pulling new :latest.
# If the image doesn't exist locally (first-ever deploy), skip — nothing to
# roll back to, and the inline `|| true` keeps set -u from tripping.
if as_codetutor docker image inspect "${IMAGE}:latest" > /dev/null 2>&1; then
  as_codetutor docker tag "${IMAGE}:latest" "${IMAGE}:rollback" || true
fi

deploy_ok=false
if as_codetutor docker compose "${COMPOSE_ARGS[@]}" pull backend \
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
as_codetutor git reset --hard "$PREV_SHA" || true
if as_codetutor docker image inspect "${IMAGE}:rollback" > /dev/null 2>&1; then
  as_codetutor docker tag "${IMAGE}:rollback" "${IMAGE}:latest" || true
fi
as_codetutor docker compose "${COMPOSE_ARGS[@]}" up -d backend || true
sleep 5
echo DEPLOY_ROLLBACK_ATTEMPTED
exit 1
