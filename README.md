# PicksLeagues

A sports prediction app where friends compete to see who is the best prognosticator. MVP is NFL Pick'em leagues.

## Local Development Setup

### Prerequisites

- [Node.js](https://nodejs.org/) (v20+)
- [pnpm](https://pnpm.io/)
- [Docker](https://www.docker.com/) (for local PostgreSQL)

### Getting Started

```bash
# Install dependencies
pnpm install

# Copy environment variables and fill in secrets
cp .env.example .env.local

# Start local PostgreSQL (port 5436)
docker compose up -d

# Run database migrations
pnpm db:migrate

# Start the dev server
pnpm dev
```

### Environment Variables

Copy `.env.example` to `.env.local` and fill in:

- **`BETTER_AUTH_SECRET`** — any random string for local session encryption
- **`GOOGLE_CLIENT_ID`** / **`GOOGLE_CLIENT_SECRET`** — from [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
- **`DISCORD_CLIENT_ID`** / **`DISCORD_CLIENT_SECRET`** — from [Discord Developer Portal](https://discord.com/developers/applications)

The database URL is pre-configured for the local Docker Postgres and works out of the box.

### Commands

| Command             | Description                             |
| ------------------- | --------------------------------------- |
| `pnpm dev`          | Start dev server (Turbopack)            |
| `pnpm build`        | Production build                        |
| `pnpm lint`         | Run ESLint                              |
| `pnpm format`       | Fix formatting (Prettier)               |
| `pnpm format:check` | Check formatting                        |
| `pnpm test`         | Run tests (Vitest)                      |
| `pnpm typecheck`    | Type check (`tsc --noEmit`)             |
| `pnpm db:generate`  | Generate migrations from schema changes |
| `pnpm db:migrate`   | Apply pending migrations                |
| `pnpm db:studio`    | Open Drizzle Studio GUI                 |

## Documentation

| Document                                        | Description                                                     |
| ----------------------------------------------- | --------------------------------------------------------------- |
| [BUSINESS_SPEC.md](./docs/BUSINESS_SPEC.md)     | What the product does — business rules, user flows, permissions |
| [ARCHITECTURE.md](./docs/ARCHITECTURE.md)       | How to structure code — patterns, conventions, testing          |
| [TECH_STACK.md](./docs/TECH_STACK.md)           | Technology choices and project structure                        |
| [BACKGROUND_JOBS.md](./docs/BACKGROUND_JOBS.md) | ESPN sync pipeline and cron jobs                                |
| [WAYS_OF_WORKING.md](./docs/WAYS_OF_WORKING.md) | Development workflow and process                                |

## Tech Stack

Next.js 16, TypeScript, Drizzle ORM, Neon PostgreSQL, Better Auth, shadcn/ui, Tailwind CSS v4
