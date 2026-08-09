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
VM_PROMOTION_MIN_FREE_KB="${VM_PROMOTION_MIN_FREE_KB:-8388608}"

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
if ! [[ "$VM_PROMOTION_MIN_FREE_KB" =~ ^[1-9][0-9]*$ ]]; then
  echo "PROMOTION_FAILED: VM_PROMOTION_MIN_FREE_KB must be a positive integer"
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
echo "minimum_free_kb=$VM_PROMOTION_MIN_FREE_KB"

image_id_if_present() {
  as_codetutor docker image inspect --format '{{.Id}}' "$1" 2>/dev/null || true
}

available_disk_kb() {
  df -Pk "$CODETUTOR_ROOT" | awk 'NR == 2 { print $4 }'
}

protected_image_ids() {
  local protect_candidates="$1"
  local container container_ids current_container_ids ref image_id

  if ! container_ids="$(as_codetutor docker ps -aq 2>/dev/null)"; then
    echo "IMAGE_RETENTION_FAILED reason=container-inventory-unavailable" >&2
    return 1
  fi
  while IFS= read -r container; do
    [[ -n "$container" ]] || continue
    if image_id="$(as_codetutor docker inspect --format '{{.Image}}' "$container" 2>/dev/null)"; then
      printf '%s\n' "$image_id"
      continue
    fi

    # Learner runner containers can finish between the list and inspect calls.
    # Accept only a proven disappearance; an unreadable container that still
    # exists makes the protected set unknowable and must stop promotion.
    if ! current_container_ids="$(as_codetutor docker ps -aq 2>/dev/null)"; then
      echo "IMAGE_RETENTION_FAILED reason=container-recheck-unavailable container=$container" >&2
      return 1
    fi
    if grep -Fxq "$container" <<< "$current_container_ids"; then
      echo "IMAGE_RETENTION_FAILED reason=container-image-unavailable container=$container" >&2
      return 1
    fi
  done <<< "$container_ids"

  for ref in \
    "${BACKEND_IMAGE}:latest" "${BACKEND_IMAGE}:rollback" \
    "${RUNNER_IMAGE}:latest" "${RUNNER_IMAGE}:rollback"; do
    image_id="$(image_id_if_present "$ref")"
    [[ -n "$image_id" ]] && printf '%s\n' "$image_id"
  done

  if [[ "$protect_candidates" == "true" ]]; then
    for ref in "$BACKEND_REF" "$RUNNER_REF"; do
      [[ "$ref" != "-" ]] || continue
      image_id="$(image_id_if_present "$ref")"
      [[ -n "$image_id" ]] && printf '%s\n' "$image_id"
    done
  fi

  return 0
}

codetutor_image_ids() {
  as_codetutor docker image ls --all --no-trunc --quiet "$BACKEND_IMAGE" 2>/dev/null || return 1
  as_codetutor docker image ls --all --no-trunc --quiet "$RUNNER_IMAGE" 2>/dev/null || return 1
}

codetutor_refs_for_id() {
  as_codetutor docker image inspect \
    --format '{{range .RepoTags}}{{println .}}{{end}}{{range .RepoDigests}}{{println .}}{{end}}' \
    "$1" 2>/dev/null || true
}

cleanup_old_codetutor_images() {
  local phase="$1"
  local protect_candidates="$2"
  local protected_ids image_ids image_id ref removed_refs=0 blocked_refs=0

  if ! protected_ids="$(protected_image_ids "$protect_candidates" | awk 'NF' | sort -u)"; then
    echo "IMAGE_RETENTION_FAILED phase=$phase reason=protected-set-unavailable"
    return 1
  fi
  if ! image_ids="$(codetutor_image_ids | awk 'NF' | sort -u)"; then
    echo "IMAGE_RETENTION_FAILED phase=$phase reason=codetutor-inventory-unavailable"
    return 1
  fi

  while IFS= read -r image_id; do
    [[ -n "$image_id" ]] || continue
    if grep -Fxq "$image_id" <<< "$protected_ids"; then
      continue
    fi

    while IFS= read -r ref; do
      [[ -n "$ref" ]] || continue
      case "$ref" in
        "${BACKEND_IMAGE}:"*|"${BACKEND_IMAGE}@"*|"${RUNNER_IMAGE}:"*|"${RUNNER_IMAGE}@"*)
          if as_codetutor docker image rm "$ref" >/dev/null 2>&1; then
            removed_refs=$((removed_refs + 1))
          elif ! as_codetutor docker image inspect "$ref" >/dev/null 2>&1; then
            # Removing another reference for the same image can delete this
            # digest reference as part of the same untag operation.
            removed_refs=$((removed_refs + 1))
          else
            blocked_refs=$((blocked_refs + 1))
            echo "IMAGE_RETENTION_BLOCKED phase=$phase ref=$ref image_id=$image_id"
          fi
          ;;
      esac
    done <<< "$(codetutor_refs_for_id "$image_id")"
  done <<< "$image_ids"

  echo "IMAGE_RETENTION phase=$phase removed_refs=$removed_refs blocked_refs=$blocked_refs"
}

ensure_disk_headroom() {
  local phase="$1"
  local protect_candidates="$2"
  local before_kb after_kb

  before_kb="$(available_disk_kb)"
  if ! [[ "$before_kb" =~ ^[0-9]+$ ]]; then
    echo "DISK_HEADROOM_FAILED phase=$phase reason=unreadable-before value=$before_kb"
    return 1
  fi

  if ! cleanup_old_codetutor_images "$phase" "$protect_candidates"; then
    echo "DISK_HEADROOM_FAILED phase=$phase reason=retention-inventory-unavailable"
    return 1
  fi

  after_kb="$(available_disk_kb)"
  if ! [[ "$after_kb" =~ ^[0-9]+$ ]]; then
    echo "DISK_HEADROOM_FAILED phase=$phase reason=unreadable-after value=$after_kb"
    return 1
  fi

  echo "DISK_HEADROOM phase=$phase before_kb=$before_kb after_kb=$after_kb required_kb=$VM_PROMOTION_MIN_FREE_KB"
  if (( after_kb < VM_PROMOTION_MIN_FREE_KB )); then
    echo "DISK_HEADROOM_FAILED phase=$phase available_kb=$after_kb required_kb=$VM_PROMOTION_MIN_FREE_KB"
    return 1
  fi
}

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
  cleanup_old_codetutor_images "rollback" false || true
  echo "PROMOTION_ROLLBACK_ATTEMPTED"
  return 1
}

# Remove only old CodeTutor image references after protecting every image used
# by a container, the current aliases, one explicit rollback alias, and any
# already-present candidate. Refuse to pull when the protected set still leaves
# too little free space for a safe immutable-image promotion.
if ! ensure_disk_headroom "pre-pull" true; then
  rollback "insufficient disk headroom before candidate pull"
  exit $?
fi

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

# The candidate and its single rollback predecessor are now protected by the
# moving aliases. Remove superseded CodeTutor references again so successful
# releases cannot accumulate local images indefinitely, and keep the same
# headroom contract after promotion.
if ! ensure_disk_headroom "post-promotion" false; then
  rollback "insufficient disk headroom after candidate promotion"
  exit $?
fi

echo "PROMOTION_OK candidate_sha=$NEW_SHA backend_ref=$BACKEND_REF runner_ref=$RUNNER_REF"
