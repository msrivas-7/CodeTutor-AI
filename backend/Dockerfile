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
# `app` (system user, no shell); only the chown line in
# docker-entrypoint.sh executes as root.
#
# Phase 20-P3 Bucket 3 (#4): UID/GID are pinned to 1100 — identical to the
# runner image's `runner` user — so the bind-mounted workspace can be
# chmod 0700 without blocking the runner container from reading/writing its
# own session files. Without matching UIDs the workspaces had to be 0777 so
# both anonymous UIDs could access them, which weakened the sandbox story
# (anything the host saw on the mount was world-writable).
RUN apt-get update \
  && apt-get install -y --no-install-recommends gosu \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd -r -g 1100 app \
  && useradd -r -u 1100 -g app -d /app -s /usr/sbin/nologin app

WORKDIR /app

ENV NODE_ENV=production

COPY backend/package.json backend/package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY --from=builder /build/dist ./dist

# Phase 21C (post-audit): bake the lesson catalog into the runtime
# image so share-creation no longer HTTP-fetches the frontend at
# runtime. Eliminates the cross-service hard dep AND the SSRF-via-env
# vector in lessonCatalog. The build context must be the repo root
# for this COPY to work (docker-compose passes `context: .`).
COPY frontend/public/courses ./courses

# Phase B1 retrieval answers are deliberately not part of the frontend public
# course tree. Bake the private authored banks into the backend image only.
COPY content/memory-warmups ./memory-warmups

RUN chown -R app:app /app

COPY backend/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 4000

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
