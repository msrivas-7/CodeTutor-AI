FROM node:20-bookworm-slim

# gosu drops privileges in the entrypoint after the chown. Backend runs as
# `app` (system user, no shell, UID <1000); only the chown line in
# docker-entrypoint.sh executes as root.
RUN apt-get update \
  && apt-get install -y --no-install-recommends gosu \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd -r app \
  && useradd -r -g app -d /app -s /usr/sbin/nologin app

WORKDIR /app

COPY backend/package.json backend/package-lock.json* ./
RUN npm install --no-audit --no-fund

COPY backend/tsconfig.json ./
COPY backend/src ./src

RUN chown -R app:app /app

COPY backend/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 4000

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["npx", "tsx", "src/index.ts"]
