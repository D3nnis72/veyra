# syntax=docker/dockerfile:1

FROM node:22-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
RUN npm install -g pnpm@12
WORKDIR /app

# ---------------------------------------------------------------------------
# Stage 0: Sanitized workspace source (strip host node_modules / dist)
# ---------------------------------------------------------------------------
FROM base AS source
WORKDIR /src
COPY packages/core ./packages/core
COPY packages/server ./packages/server
COPY packages/web ./packages/web
RUN rm -rf \
  /src/packages/core/node_modules /src/packages/core/dist \
  /src/packages/server/node_modules /src/packages/server/dist \
  /src/packages/web/node_modules /src/packages/web/dist

# ---------------------------------------------------------------------------
# Stage 1: Install & build @veyra/core, @veyra/server, and @veyra/web
# ---------------------------------------------------------------------------
FROM base AS builder
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/core/package.json packages/core/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/web/package.json packages/web/package.json
COPY packages/cli/package.json packages/cli/package.json
COPY packages/desktop/package.json packages/desktop/package.json

RUN pnpm install --frozen-lockfile --filter @veyra/core... --filter @veyra/server... --filter @veyra/web...

COPY --from=source /src/packages/core ./packages/core
COPY --from=source /src/packages/server ./packages/server
COPY --from=source /src/packages/web ./packages/web

RUN pnpm --filter @veyra/core build \
  && pnpm --filter @veyra/server build \
  && pnpm --filter @veyra/web build

# ---------------------------------------------------------------------------
# Stage 2: Production-only node_modules for @veyra/core + @veyra/server
# ---------------------------------------------------------------------------
FROM base AS prod-deps
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/core/package.json packages/core/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/web/package.json packages/web/package.json
COPY packages/cli/package.json packages/cli/package.json
COPY packages/desktop/package.json packages/desktop/package.json

RUN pnpm install --prod --frozen-lockfile --filter @veyra/server...

# ---------------------------------------------------------------------------
# Stage 3: Minimal Node 22 runtime image
# ---------------------------------------------------------------------------
FROM node:22-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV VEYRA_HOST=0.0.0.0
ENV VEYRA_PORT=4173
ENV VEYRA_DB_PATH=/data/veyra.db
ENV VEYRA_WEB_DIST_DIR=/app/packages/web/dist

COPY package.json pnpm-workspace.yaml ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/packages/core/node_modules ./packages/core/node_modules
COPY --from=prod-deps /app/packages/server/node_modules ./packages/server/node_modules

COPY --from=builder /app/packages/core/package.json ./packages/core/package.json
COPY --from=builder /app/packages/core/dist ./packages/core/dist
COPY --from=builder /app/packages/server/package.json ./packages/server/package.json
COPY --from=builder /app/packages/server/dist ./packages/server/dist
COPY --from=builder /app/packages/web/dist ./packages/web/dist

RUN mkdir -p /data && chown -R node:node /data /app
USER node

EXPOSE 4173
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.VEYRA_PORT || 4173) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "packages/server/dist/index.js"]
