#!/bin/bash
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
# === Why bash, not sh ==================================================
#
# Z-P1-1 (third-audit fix): Debian's /bin/sh is dash, whose heredoc
# implementation writes the body to a temp file under /tmp (visible at
# a real filesystem path) and only redirects fd 0 to it on exec. That
# created a brief race window where a same-UID racer could `cat` the
# heredoc-backing file before exec replaced the shell. Bash 5+ backs
# heredoc with an anonymous pipe (no filesystem path), so the temp-file
# disclosure surface goes away entirely.
#
# Even with bash, /proc/<sh_pid>/fd/<n> still shows the heredoc fd for
# the microsecond window between bash setting up the redirection and
# exec replacing the shell with node. That window is unreachable in our
# deployment because no concurrent same-UID process exists at this
# point in container startup — the entrypoint is PID 1, no learner code
# has run yet, no agent process is listening. If a future change adds a
# co-process that boots alongside the entrypoint (sidecar daemon,
# metrics exporter), this assumption needs revisiting and we'd need to
# move to a memfd-backed delivery mechanism.
#
# === Token handling ====================================================
#
# RUNNER_AGENT_TOKEN is the per-session bearer token. We capture it into
# a shell-local var, UNSET the env var, then exec node with the token
# piped through stdin via heredoc. The unset-then-exec ordering matters:
#   - The kernel snapshot of /proc/<pid>/environ is taken at execve()
#     time and is IMMUTABLE thereafter; `delete process.env.X` at JS
#     runtime doesn't update it.
#   - `exec node ...` replaces THIS shell with node. The execve() snapshot
#     is taken at that exec, with the post-unset env. /proc/<node_pid>/
#     environ shows clean env — no token.
#   - A pipe (`printf | exec node`) would only replace the SUBSHELL; the
#     parent shell stays alive with /proc/<sh_pid>/environ still leaking
#     the original RUNNER_AGENT_TOKEN. Worse than heredoc.
#
# So heredoc + top-level exec is the right shape. Bash5 ensures the
# heredoc body never touches /tmp.

set -eu

if [ "${ENABLE_AGENT:-0}" = "1" ]; then
  if [ -z "${RUNNER_AGENT_TOKEN:-}" ]; then
    echo '{"level":"error","evt":"agent_boot_failed","reason":"missing_token"}' >&2
    exit 1
  fi
  __TOKEN="$RUNNER_AGENT_TOKEN"
  unset RUNNER_AGENT_TOKEN
  exec node /usr/local/lib/runner-agent.mjs <<__AGENT_TOKEN_DELIM__
$__TOKEN
__AGENT_TOKEN_DELIM__
fi

exec sleep infinity
