FROM debian:bookworm-slim

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
    && npm install -g --no-audit --no-fund tsx \
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
