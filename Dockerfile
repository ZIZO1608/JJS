# JJ's ERP — online server image (Coolify). One container: API + built web app, SQLite in /data.

FROM node:22-bookworm-slim AS build
WORKDIR /app
# better-sqlite3 falls back to compiling if no prebuilt binary matches.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app
# Coolify's health check needs curl.
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4310 \
    JJS_DATA_DIR=/data \
    JJS_TRUST_PROXY=1 \
    TZ=Asia/Damascus
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/scripts/reset-password.mjs ./scripts/reset-password.mjs
VOLUME /data
EXPOSE 4310
# Coolify may set its own PORT (e.g. 3000), so check whichever port the server really uses.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/api/health" || exit 1
CMD ["node", "dist/server/server/index.js"]
