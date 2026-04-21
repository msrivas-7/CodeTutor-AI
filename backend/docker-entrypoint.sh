#!/bin/sh
set -e

# Bind-mounted session workspace arrives owned by whoever on the host; chown
# so the non-root `app` user can mkdir per-session dirs under it. Idempotent —
# no-op on subsequent restarts.
if [ -d /workspace-root ]; then
  chown -R app:app /workspace-root 2>/dev/null || true
fi

exec gosu app "$@"
