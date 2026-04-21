# Multi-stage so the runtime image ships only compiled JS + prod deps.
# Builder installs dev + prod deps to run `tsc`, then the runtime stage
# re-installs with --omit=dev and copies dist/ across.

# ---------- builder ----------
FROM node:20-bookworm-slim AS builder

WORKDIR /build

COPY backend/package.json backend/package-lock.json* ./
RUN npm ci --no-audit --no-fund

COPY backend/tsconfig.json ./
COPY backend/src ./src
RUN npm run build

# ---------- runtime ----------
FROM node:20-bookworm-slim AS runtime

# gosu drops privileges in the entrypoint after the chown. Backend runs as
# `app` (system user, no shell, UID <1000); only the chown line in
# docker-entrypoint.sh executes as root.
RUN apt-get update \
  && apt-get install -y --no-install-recommends gosu \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd -r app \
  && useradd -r -g app -d /app -s /usr/sbin/nologin app

WORKDIR /app

ENV NODE_ENV=production

COPY backend/package.json backend/package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY --from=builder /build/dist ./dist

RUN chown -R app:app /app

COPY backend/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 4000

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
