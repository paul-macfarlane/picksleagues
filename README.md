# PicksLeagues

An NFL Pick'Em app where users create or join private leagues, make weekly game picks (straight-up or against the spread), and compete on a season-long leaderboard.

## Tech Stack

| Layer           | Technology                          |
| --------------- | ----------------------------------- |
| Framework       | Next.js 16 (App Router)             |
| Language        | TypeScript (strict mode)            |
| Database        | PostgreSQL via Neon (serverless)    |
| ORM             | Drizzle ORM                         |
| Auth            | Better Auth (Google, Discord OAuth) |
| Background Jobs | Inngest                             |
| UI              | shadcn/ui + Tailwind CSS v4         |
| Forms           | react-hook-form + Zod               |
| Testing         | Vitest                              |
| Deployment      | Vercel                              |

## Prerequisites

- Node.js 20+
- npm
- A [Neon](https://neon.tech) PostgreSQL database
- Google and/or Discord OAuth credentials
- [Inngest CLI](https://www.inngest.com/docs/cli) for local background job development
- [Docker](https://docs.docker.com/get-docker/) for local PostgreSQL

## Setup

1. Clone the repo and install dependencies:

```bash
git clone <repo-url>
cd picksleagues
npm install
```

2. Start the local PostgreSQL database (port 5433 to avoid conflicts):

```bash
docker compose up -d
```

3. Copy the environment template and fill in your values:

```bash
cp .env.example .env.local
```

4. Generate the database schema and run migrations:

```bash
npx drizzle-kit generate
npx drizzle-kit migrate
```

5. Generate route-aware TypeScript types:

```bash
npx next typegen
```

## Development

Start the Next.js dev server:

```bash
npm run dev
```

Start the Inngest dev server (in a separate terminal):

```bash
npx inngest-cli@latest dev
```

## Commands

| Command                    | Description                             |
| -------------------------- | --------------------------------------- |
| `npm run dev`              | Start dev server (Turbopack)            |
| `npm run build`            | Production build                        |
| `npm run lint`             | Run ESLint                              |
| `npm run format:check`     | Check formatting                        |
| `npm run format`           | Fix formatting                          |
| `npm test`                 | Run tests                               |
| `npm run typecheck`        | Type check                              |
| `npx drizzle-kit generate` | Generate migrations from schema changes |
| `npx drizzle-kit migrate`  | Apply migrations                        |
| `npx next typegen`         | Generate route-aware page prop types    |

## Project Structure

```
src/
├── app/              # Next.js App Router (pages, layouts, API routes)
│   ├── (public)/     # Unauthenticated routes (login, invite preview)
│   ├── (app)/        # Authenticated routes (home, leagues, profile)
│   └── api/          # Auth handler, Inngest webhook, REST API
├── lib/              # Business logic, auth, validators, DB schema
│   ├── db/           # Drizzle schema and client
│   ├── inngest/      # Background job definitions
│   ├── espn/         # ESPN API client
│   ├── validators/   # Shared Zod schemas
│   ├── scoring.ts    # Pick result calculation
│   ├── scheduling.ts # Lock time and game window logic
│   └── permissions.ts # Authorization checks
├── actions/          # Server Actions (mutations)
├── data/             # Data access layer (all Drizzle ORM code)
└── components/       # React components
    ├── ui/           # shadcn/ui primitives
    └── ...           # Feature-specific components
```

## Documentation

| Document                                   | Purpose                                                            |
| ------------------------------------------ | ------------------------------------------------------------------ |
| [BUSINESS_SPEC.md](./BUSINESS_SPEC.md)     | What the product does — all business rules and user flows          |
| [ARCHITECTURE.md](./ARCHITECTURE.md)       | How to structure code — patterns, conventions, testing             |
| [TECH_STACK.md](./TECH_STACK.md)           | Technology choices, project structure, deployment                  |
| [BACKGROUND_JOBS.md](./BACKGROUND_JOBS.md) | Inngest jobs, ESPN sync pipeline, scheduling                       |
| [WAYS_OF_WORKING.md](./WAYS_OF_WORKING.md) | AI agent workflow — task breakdown, progress tracking, code review |
| [BACKLOG.md](./BACKLOG.md)                 | Current task progress and status                                   |
