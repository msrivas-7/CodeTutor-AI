#!/usr/bin/env bash

set -euo pipefail

if (( $# == 0 )); then
  echo "usage: pull-container-images.sh <immutable-ref> [...]" >&2
  exit 2
fi
pids=()
for image in "$@"; do
  docker pull "$image" &
  pids+=("$!")
done

failed=0
for pid in "${pids[@]}"; do
  if ! wait "$pid"; then
    failed=1
  fi
done

if (( failed != 0 )); then
  echo "one or more container image pulls failed" >&2
  exit 1
fi
