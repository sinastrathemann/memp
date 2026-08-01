# syntax=docker/dockerfile:1.7

# ---- Base ----
FROM node:25-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# ---- Deps ----
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/
COPY packages/domain/package.json ./packages/domain/
COPY packages/application/package.json ./packages/application/
COPY packages/infrastructure/package.json ./packages/infrastructure/
COPY packages/auth/package.json ./packages/auth/
COPY packages/llm/package.json ./packages/llm/
COPY packages/mcp/package.json ./packages/mcp/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ---- Build ----
FROM base AS build
WORKDIR /app
COPY --from=deps /app ./
COPY tsconfig.base.json tsconfig.json biome.json ./
COPY packages ./packages
COPY apps ./apps
RUN pnpm --filter "./packages/*" build
RUN pnpm --filter @mexp/api build
RUN pnpm --filter @mexp/web build
RUN pnpm deploy --filter @mexp/api --prod /app/deploy

# ---- Runtime ----
FROM node:25-alpine AS runtime
ARG APP_VERSION=dev
WORKDIR /app

ENV NODE_ENV=production
ENV AUTH_MODE=hub
ENV MEXP_DATA_DIR=/app/data
ENV MEXP_WEB_DIST=/app/web-dist
ENV PORT=3000
ENV HOST=0.0.0.0
ENV APP_VERSION=${APP_VERSION}
ENV TZ=Europe/Berlin

COPY --from=build /app/deploy/package.json ./
COPY --from=build /app/deploy/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/apps/web/dist ./web-dist
COPY config ./config
COPY .env.example /app/.env.example

RUN mkdir -p /app/data && chown -R node:node /app/data
USER node

VOLUME /app/data
EXPOSE 3000

LABEL org.opencontainers.image.title="mEXP" \
      org.opencontainers.image.description="mindsquare Experience Platform" \
      org.opencontainers.image.vendor="mindsquare AG" \
      org.opencontainers.image.source="https://github.com/sinastrathemann/mexp" \
      org.opencontainers.image.documentation="https://github.com/sinastrathemann/mexp/blob/main/README.md" \
      org.opencontainers.image.licenses="proprietary" \
      org.opencontainers.image.version="${APP_VERSION}" \
      de.mindsquare.agenthub.category="hr" \
      de.mindsquare.agenthub.brand="mexp" \
      de.mindsquare.agenthub.capabilities="events,budget,tender,reporting"

CMD ["node", "dist/index.js"]
