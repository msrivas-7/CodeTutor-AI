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

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        passwd \
        adduser \
        python3 \
        python3-minimal \
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
    && npm install -g --no-audit --no-fund tsx@${TSX_VERSION} \
    && npm cache clean --force \
    && rm -rf /var/lib/apt/lists/*

# Non-root runtime user. UID/GID 1100 is unlikely to collide with host users.
RUN groupadd --system --gid 1100 runner \
    && useradd --system --uid 1100 --gid 1100 --home /home/runner --create-home --shell /bin/bash runner \
    && mkdir -p /workspace \
    && chown -R runner:runner /workspace

WORKDIR /workspace
USER runner

# Container stays alive for the session; backend drives execution via `docker exec`.
CMD ["sleep", "infinity"]
