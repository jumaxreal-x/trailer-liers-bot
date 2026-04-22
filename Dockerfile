FROM node:20-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN apt-get update && apt-get install -y --no-install-recommends \
      git ca-certificates python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.26.1 --activate

WORKDIR /app

FROM base AS build
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig*.json .npmrc* ./
COPY artifacts ./artifacts
COPY lib ./lib
COPY scripts ./scripts
ENV npm_config_user_agent=pnpm/10.26.1
RUN pnpm install --frozen-lockfile=false
RUN pnpm --filter @workspace/api-server run build

FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app /app
EXPOSE 8080
CMD ["pnpm", "--filter", "@workspace/api-server", "run", "start"]
