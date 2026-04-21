# Multi-stage: `dev` runs the Vite dev server (hot reload for local compose);
# `prod` produces a static bundle served by nginx. Pick which with the
# compose `target:` field — see docker-compose.yml's FRONTEND_BUILD_TARGET.
#
# In the prod stage, VITE_* values are baked into the bundle at build time
# (Vite inlines import.meta.env.* at compile), so rebuilding is required
# after changing them. Declare every VITE_* we consume as an ARG and pass
# it through ENV so `vite build` picks it up.

# ─── Shared install layer ───────────────────────────────────────────────────
FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install --no-audit --no-fund

# ─── dev: Vite dev server (hot reload). Default target. ─────────────────────
FROM deps AS dev
WORKDIR /app
COPY frontend/ ./
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]

# ─── build: produces /app/dist with VITE_* baked in. ────────────────────────
FROM deps AS build
WORKDIR /app
COPY frontend/ ./

# Vite reads these at build time. Declared as ARGs so `docker compose build`
# can supply them via `args:` (and override via --build-arg). Leave any unset
# and Vite will fall back to whatever is in frontend/.env.production.
ARG VITE_BACKEND_URL
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
# Phase 20-P1: bake the deploying git sha into the bundle so feedback
# submissions (and, later, Sentry/LogRocket) can pin a report to the exact
# commit. Falls back to "dev" in the client when absent.
ARG VITE_APP_SHA
ENV VITE_BACKEND_URL=${VITE_BACKEND_URL}
ENV VITE_SUPABASE_URL=${VITE_SUPABASE_URL}
ENV VITE_SUPABASE_ANON_KEY=${VITE_SUPABASE_ANON_KEY}
ENV VITE_APP_SHA=${VITE_APP_SHA}

RUN npm run build

# ─── prod: static serve via nginx. ──────────────────────────────────────────
FROM nginx:alpine AS prod
# SPA fallback: any unknown path serves index.html so React Router picks up
# client-side routing (e.g. /login, /reset-password, /auth/callback).
RUN printf '%s\n' \
  'server {' \
  '  listen 5173;' \
  '  root /usr/share/nginx/html;' \
  '  index index.html;' \
  '  location / { try_files $uri $uri/ /index.html; }' \
  '}' > /etc/nginx/conf.d/default.conf \
  && rm -f /etc/nginx/conf.d/default.conf.bak
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 5173
CMD ["nginx", "-g", "daemon off;"]
