FROM node:20-bookworm-slim

WORKDIR /app

COPY backend/package.json backend/package-lock.json* ./
RUN npm install --no-audit --no-fund

COPY backend/tsconfig.json ./
COPY backend/src ./src

EXPOSE 4000

CMD ["npx", "tsx", "src/index.ts"]
