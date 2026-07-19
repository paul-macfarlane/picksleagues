# Picks Leagues

A web app where friends create and compete in sports pick'em leagues. MVP: NFL Pick'em, NFL Elimination, and March Madness Pools — private invite-link leagues, public discovery, standings fresh within ~5 minutes on game days.

- **What we're building:** [`docs/mvp-spec.md`](docs/mvp-spec.md)
- **How it's built:** [`docs/architecture.md`](docs/architecture.md)
- **Decisions:** [`docs/adr/`](docs/adr/)
- **Work queue:** [`backlog/`](backlog/)

Stack: pnpm monorepo · Vite/React/TanStack SPA · Hono + zod-openapi API on Vercel · OpenAPI-generated client · Neon Postgres + Drizzle · Better Auth (Google/Discord) · Vitest + Playwright, simulator-backed e2e.

Code scaffold lands with `FND-1` (see `backlog/00-foundation.md`).
