#!/usr/bin/env bash
# Promote immutable release-candidate image digests on the production VM.
# The caller has already fetched and reset /opt/codetutor to NEW_SHA.
# A component ref of "-" means that component is unchanged.

set -uo pipefail

PREV_SHA="${1:?usage: $0 <prev-sha> <new-sha> <backend-ref|-> <runner-ref|->}"
NEW_SHA="${2:?usage: $0 <prev-sha> <new-sha> <backend-ref|-> <runner-ref|->}"
BACKEND_REF="${3:?usage: $0 <prev-sha> <new-sha> <backend-ref|-> <runner-ref|->}"
RUNNER_REF="${4:?usage: $0 <prev-sha> <new-sha> <backend-ref|-> <runner-ref|->}"

BACKEND_IMAGE=ghcr.io/msrivas-7/codetutor-backend
RUNNER_IMAGE=ghcr.io/msrivas-7/codetutor-runner
COMPOSE_ARGS=(-f docker-compose.yml -f docker-compose.prod.yml --env-file .env)
HEALTH_URL=http://127.0.0.1:4000/api/health/deep
HEALTH_ATTEMPTS=10
HEALTH_INTERVAL=3
CODETUTOR_ROOT="${CODETUTOR_ROOT:-/opt/codetutor}"
REFRESH_ENV_TARGET="${REFRESH_ENV_TARGET:-/usr/local/bin/refresh-env}"

as_codetutor() { sudo -u codetutor "$@"; }

is_sha() { [[ "$1" =~ ^[0-9a-f]{40}$ ]]; }
is_digest_ref() { [[ "$1" =~ ^ghcr\.io/msrivas-7/[a-z0-9_.-]+@sha256:[0-9a-f]{64}$ ]]; }

if ! is_sha "$PREV_SHA" || ! is_sha "$NEW_SHA"; then
  echo "PROMOTION_FAILED: previous and candidate SHAs must be full lowercase Git SHAs"
  exit 2
fi
if [[ "$BACKEND_REF" != "-" ]] && ! is_digest_ref "$BACKEND_REF"; then
  echo "PROMOTION_FAILED: backend ref is not an immutable GHCR digest"
  exit 2
fi
if [[ "$RUNNER_REF" != "-" ]] && ! is_digest_ref "$RUNNER_REF"; then
  echo "PROMOTION_FAILED: runner ref is not an immutable GHCR digest"
  exit 2
fi
if [[ "$BACKEND_REF" == "-" && "$RUNNER_REF" == "-" ]]; then
  echo "PROMOTION_FAILED: no VM component selected"
  exit 2
fi

cd "$CODETUTOR_ROOT" || { echo "PROMOTION_FAILED: $CODETUTOR_ROOT missing"; exit 1; }
if [[ "$(as_codetutor git rev-parse HEAD)" != "$NEW_SHA" ]]; then
  echo "PROMOTION_FAILED: VM worktree is not pinned to candidate $NEW_SHA"
  exit 1
fi

echo "previous_sha=$PREV_SHA"
echo "candidate_sha=$NEW_SHA"
echo "backend_ref=$BACKEND_REF"
echo "runner_ref=$RUNNER_REF"

# Snapshot both moving local aliases before changing either one. Rollback uses
# these image IDs even if GHCR or the network is unavailable during recovery.
if as_codetutor docker image inspect "${BACKEND_IMAGE}:latest" >/dev/null 2>&1; then
  as_codetutor docker tag "${BACKEND_IMAGE}:latest" "${BACKEND_IMAGE}:rollback" || true
fi
if as_codetutor docker image inspect "${RUNNER_IMAGE}:latest" >/dev/null 2>&1; then
  as_codetutor docker tag "${RUNNER_IMAGE}:latest" "${RUNNER_IMAGE}:rollback" || true
fi

rollback() {
  local reason="$1"
  echo "PROMOTION_FAILED: $reason — rolling back to $PREV_SHA"

  if ! as_codetutor git reset --hard "$PREV_SHA"; then
    echo "PROMOTION_FAILED_ROLLBACK_RESET: could not restore repository to $PREV_SHA"
    return 2
  fi

  if as_codetutor docker image inspect "${RUNNER_IMAGE}:rollback" >/dev/null 2>&1; then
    as_codetutor docker tag "${RUNNER_IMAGE}:rollback" "${RUNNER_IMAGE}:latest" || true
  fi
  if as_codetutor docker image inspect "${BACKEND_IMAGE}:rollback" >/dev/null 2>&1; then
    as_codetutor docker tag "${BACKEND_IMAGE}:rollback" "${BACKEND_IMAGE}:latest" || true
  fi

  if [[ -f infra/scripts/refresh-env.sh ]]; then
    install -m 0755 -o root -g root infra/scripts/refresh-env.sh "$REFRESH_ENV_TARGET" || true
    "$REFRESH_ENV_TARGET" || true
  fi
  as_codetutor docker compose "${COMPOSE_ARGS[@]}" up -d backend || true
  sleep 5
  echo "PROMOTION_ROLLBACK_ATTEMPTED"
  return 1
}

# Pull every selected digest before mutating local aliases. A registry failure
# therefore leaves the running stack untouched.
if [[ "$RUNNER_REF" != "-" ]] && ! as_codetutor docker pull "$RUNNER_REF"; then
  rollback "runner candidate pull failed"
  exit $?
fi
if [[ "$BACKEND_REF" != "-" ]] && ! as_codetutor docker pull "$BACKEND_REF"; then
  rollback "backend candidate pull failed"
  exit $?
fi

if [[ -f infra/scripts/refresh-env.sh ]]; then
  if ! install -m 0755 -o root -g root infra/scripts/refresh-env.sh "$REFRESH_ENV_TARGET" \
    || ! "$REFRESH_ENV_TARGET"; then
    rollback "environment refresh failed"
    exit $?
  fi
fi

if [[ "$RUNNER_REF" != "-" ]] \
  && ! as_codetutor docker tag "$RUNNER_REF" "${RUNNER_IMAGE}:latest"; then
  rollback "runner retag failed"
  exit $?
fi
if [[ "$BACKEND_REF" != "-" ]] \
  && ! as_codetutor docker tag "$BACKEND_REF" "${BACKEND_IMAGE}:latest"; then
  rollback "backend retag failed"
  exit $?
fi

if [[ "$BACKEND_REF" != "-" ]]; then
  if ! as_codetutor docker compose "${COMPOSE_ARGS[@]}" up -d backend; then
    rollback "backend recreate failed"
    exit $?
  fi

  healthy=false
  for _ in $(seq 1 "$HEALTH_ATTEMPTS"); do
    if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
      healthy=true
      break
    fi
    sleep "$HEALTH_INTERVAL"
  done
  if [[ "$healthy" != "true" ]]; then
    rollback "deep health check failed"
    exit $?
  fi

  expected_backend_id="$(as_codetutor docker image inspect --format '{{.Id}}' "$BACKEND_REF")"
  backend_container="$(as_codetutor docker compose "${COMPOSE_ARGS[@]}" ps -q backend)"
  running_backend_id="$(as_codetutor docker inspect --format '{{.Image}}' "$backend_container")"
  if [[ "$running_backend_id" != "$expected_backend_id" ]]; then
    rollback "running backend image does not match candidate digest"
    exit $?
  fi
fi

if [[ "$RUNNER_REF" != "-" ]]; then
  expected_runner_id="$(as_codetutor docker image inspect --format '{{.Id}}' "$RUNNER_REF")"
  latest_runner_id="$(as_codetutor docker image inspect --format '{{.Id}}' "${RUNNER_IMAGE}:latest")"
  if [[ "$latest_runner_id" != "$expected_runner_id" ]]; then
    rollback "runner latest alias does not match candidate digest"
    exit $?
  fi
fi

echo "PROMOTION_OK candidate_sha=$NEW_SHA backend_ref=$BACKEND_REF runner_ref=$RUNNER_REF"
