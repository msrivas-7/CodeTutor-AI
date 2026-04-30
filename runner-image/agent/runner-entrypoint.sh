#!/bin/sh
# Phase 24B runner entrypoint. ENABLE_AGENT=1 → start the in-runner HTTP
# agent (used by AciExecutionBackend). Default → sleep infinity, the
# stable LocalDocker behavior where the backend drives the container via
# docker exec/cp from outside.
#
# Two-mode design (vs. always-on agent) keeps LocalDocker's RAM profile
# unchanged: no stray Node process per session on the 14 in-process
# slots. ACI sets ENABLE_AGENT=1 on container-create; LocalDocker does
# not. Same image, two runtime profiles.
#
# === Token handling ====================================================
#
# RUNNER_AGENT_TOKEN is the per-session bearer token. We capture it into
# a shell-local var, UNSET the env var, then exec node with the token
# piped through stdin. This sidesteps /proc/<node_pid>/environ — the
# kernel snapshot of a process's environment is taken at execve() time
# and is IMMUTABLE thereafter, so calling `delete process.env.X` at
# runtime in JS doesn't update /proc. By keeping the token out of env
# at exec time, a same-uid learner-code process can't read it via
# /proc/<agent_pid>/environ. The token instead lives only in node's JS
# heap.

set -eu

if [ "${ENABLE_AGENT:-0}" = "1" ]; then
  if [ -z "${RUNNER_AGENT_TOKEN:-}" ]; then
    echo '{"level":"error","evt":"agent_boot_failed","reason":"missing_token"}' >&2
    exit 1
  fi
  # Snapshot the token, then unset the env var. CRITICAL: `exec` must be
  # the top-level command (no pipe) so the shell is replaced in-place by
  # node and PID 1's /proc/<pid>/environ reflects the post-unset env.
  # Using a pipe (`printf | exec node`) only replaces the SUBSHELL — the
  # parent shell stays alive with the original environ snapshot, and
  # /proc/1/environ continues to leak the token.
  #
  # Heredoc redirect (`exec node ... <<TOK ... TOK`) hands node a pipe
  # already filled with the token without forking; exec replaces this
  # shell with node, and node reads its stdin to get the token.
  __TOKEN="$RUNNER_AGENT_TOKEN"
  unset RUNNER_AGENT_TOKEN
  exec node /usr/local/lib/runner-agent.mjs <<__AGENT_TOKEN_DELIM__
$__TOKEN
__AGENT_TOKEN_DELIM__
fi

exec sleep infinity
