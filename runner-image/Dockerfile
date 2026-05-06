# M-5 (bucket 7): parameterized base image so CI can pin by digest. Default
# is the rolling tag so a local `docker compose build` still works offline;
# prod CI should resolve the digest once per refresh and pass it in:
#   docker pull debian:bookworm-slim
#   DIGEST=$(docker inspect --format '{{index .RepoDigests 0}}' debian:bookworm-slim)
#   docker build --build-arg DEBIAN_BASE="$DIGEST" ...
# Refreshing deliberately (vs every build pulling :slim) is the point —
# a Debian point-release that silently swaps gcc or nodejs majors should
# surface as a PR, not as mystery lesson failures after an overnight apt.
ARG DEBIAN_BASE=debian:bookworm-slim
FROM ${DEBIAN_BASE}

# M-5: pin tsx major.minor. tsx is a user-facing runtime for the backend's
# ts-exec lesson script (test harness + coach nudges), so a breaking 5.x
# would surface as mysterious lesson failures days after a rebuild. Lock
# to 4.19.x; bump deliberately alongside a lesson-harness smoke test.
ARG TSX_VERSION=4.19.2

# Phase 22F2A: pytest is needed for the upcoming `testing-basics` lesson.
# Same pin-deliberately stance as tsx — a major bump might quietly change
# fixture lookup or test-collection behavior. Bookworm's PEP 668 marker
# requires --break-system-packages, which is fine here: the runner is a
# single-purpose container with no system Python users to contaminate.
ARG PYTEST_VERSION=8.3.5

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        passwd \
        adduser \
        python3 \
        python3-minimal \
        python3-pip \
        nodejs \
        npm \
        gcc \
        g++ \
        default-jdk-headless \
        golang-go \
        rustc \
        ruby \
        make \
        coreutils \
        bash \
    && pip3 install --break-system-packages --no-cache-dir "pytest==${PYTEST_VERSION}" \
    && npm install -g --no-audit --no-fund tsx@${TSX_VERSION} \
    && npm cache clean --force \
    && rm -rf /var/lib/apt/lists/* /root/.cache \
 && find / -xdev -type f \( -perm -4000 -o -perm -2000 \) -exec chmod a-s {} +
# ↑ Phase 24B-resize: strip setuid + setgid bits from every system binary.
#
# WHY: ACI's container runtime does NOT support `no-new-privileges` in
# the spec (only the `privileged` flag is honored — see services/
# execution/backends/aci.ts). LocalDocker has full SecurityOpt
# `no-new-privileges:true`, so a setuid binary there cannot escalate.
# But on the ACI overflow path, no-new-privs is structurally absent.
#
# Removing the setuid/setgid bits at image build time gives the
# EQUIVALENT guarantee structurally: there is nothing in the image to
# escalate against, so a kernel CVE in setuid handling cannot help an
# attacker. The non-root user (UID 1100, set via `USER runner` below)
# can still invoke these binaries — they just won't run with elevated
# privileges. Affected binaries (debian:bookworm-slim defaults):
#   /usr/bin/{su,mount,umount,passwd,chsh,chfn,gpasswd,newgrp,chage,
#             expiry}
#   /usr/sbin/unix_chkpwd
#
# SAFETY: none of these are used by the runner's normal execution path:
#   - Language interpreters (python3, node, ruby) don't shell out to them
#   - Compilers (gcc, g++, rustc, javac, go) don't shell out to them
#   - The runner agent (Node.mjs) doesn't shell out to them
#   - Standard library functions don't depend on them
# So a learner running `import os; os.geteuid()` etc. is unaffected.
#
# This preserves the C5 (no-new-privs) guarantee on BOTH backends —
# LocalDocker via the SecurityOpt + ACI via the structural strip.
# Verified by security-suite/scenarios/S2_privileges.spec.ts S2d and
# the new S2f invariant check.

# Non-root runtime user. UID/GID 1100 is unlikely to collide with host users.
RUN groupadd --system --gid 1100 runner \
    && useradd --system --uid 1100 --gid 1100 --home /home/runner --create-home --shell /bin/bash runner \
    && mkdir -p /workspace \
    && chown -R runner:runner /workspace

# Phase 24B: in-runner HTTP agent. ACI overflow containers can't be
# reached via `docker exec` from outside Azure, so the backend talks
# to this agent over HTTP instead. LocalDocker keeps using docker
# exec/cp directly (NetworkMode=none + cheaper hot path), so the agent
# only starts when ENABLE_AGENT=1 is set on the container's env. With
# the var unset (the LocalDocker default), the entrypoint script
# falls back to `sleep infinity` — the agent file rides along in the
# image but never spawns a process. RAM cost in LocalDocker = $0.
#
# Both files land root-owned + world-readable + not writable by the
# runner user, so learner code can't tamper with them post-boot.
# Avoid COPY --chmod because the classic Docker builder (still default
# in some local toolchains) doesn't support it; the explicit chmod
# below works on every builder. The COPY itself is root:root by
# default since neither USER nor --chown is in effect at this point.
COPY agent/agent.mjs            /usr/local/lib/runner-agent.mjs
COPY agent/runner-entrypoint.sh /usr/local/bin/runner-entrypoint.sh
RUN chmod 0444 /usr/local/lib/runner-agent.mjs \
 && chmod 0555 /usr/local/bin/runner-entrypoint.sh

WORKDIR /workspace
USER runner

# Container stays alive for the session. LocalDocker drives execution via
# `docker exec` against the sleeping shell; ACI drives via HTTP against
# the running agent. Same image, two runtime modes.
CMD ["/usr/local/bin/runner-entrypoint.sh"]
