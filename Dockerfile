FROM node:20-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.26.1 --activate

WORKDIR /app

FROM base AS build
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig*.json ./
COPY artifacts ./artifacts
COPY scripts ./scripts
RUN pnpm install --frozen-lockfile=false
RUN pnpm --filter @workspace/api-server run build

FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app /app
EXPOSE 8080
CMD ["pnpm", "--filter", "@workspace/api-server", "run", "start"]
