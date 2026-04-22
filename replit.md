# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

## WhatsApp bot — "Trailer Liers"

The api-server artifact also runs a WhatsApp bot (Baileys) alongside Express.

- Owner: `256752233886`
- Prefixes: `.`, `%`, `✨️`, `!`
- Web UI for QR scan / pairing code: `GET /api/wa`
- Bot status JSON: `GET /api/wa/status`
- Owner image (used in pairing page + commands): `GET /api/wa/owner.jpg` (file at `artifacts/api-server/assets/owner.jpg`)
- Auth + state are persisted in `artifacts/api-server/.wa-state/` (gitignored at runtime).
- AI commands (`.gpt`, `.llama`, `.mistral`, `.dalle`, `.flux`, `.autoreply`) use OpenAI via the Replit AI Integrations proxy — no API key needed.

Bot source: `artifacts/api-server/src/bot/` (`index.ts`, `commands.ts`, `state.ts`, `utils.ts`).

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
