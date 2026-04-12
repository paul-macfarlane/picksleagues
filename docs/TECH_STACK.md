# PicksLeagues — Tech Stack

> This document describes the technologies, libraries, and tooling used to build PicksLeagues. It is the authoritative reference for which tools are in use and how the project is structured.

---

## Stack Summary

| Layer           | Technology                                      |
| --------------- | ----------------------------------------------- |
| Framework       | Next.js 16 (App Router)                         |
| Language        | TypeScript (strict mode)                        |
| Database        | PostgreSQL via Neon (serverless)                |
| ORM             | Drizzle ORM                                     |
| Auth            | Better Auth (Google, Discord OAuth)             |
| Background Jobs | Cron-triggered API routes (cron-job.org)        |
| UI Components   | shadcn/ui (Radix primitives)                    |
| Styling         | Tailwind CSS v4                                 |
| Forms           | react-hook-form + @hookform/resolvers (Zod)     |
| Validation      | Zod                                             |
| Date/Time       | date-fns + date-fns-tz                          |
| Testing         | Vitest                                          |
| Linting         | ESLint (next/core-web-vitals + next/typescript) |
| Formatting      | Prettier                                        |
| Deployment      | Vercel                                          |
| Monitoring      | Sentry                                          |
| Package Manager | pnpm                                            |

---

## Framework

**Next.js 16** with the App Router. All routing, server components, server actions, and API routes follow App Router conventions. This is not the Pages Router. Read the relevant guide in `node_modules/next/dist/docs/` before writing any Next.js-specific code — APIs and conventions may differ from earlier versions.

---

## Language

**TypeScript** in strict mode. All files are `.ts` or `.tsx`. No `any` unless absolutely unavoidable and explicitly commented.

---

## Database

**PostgreSQL** hosted on [Neon](https://neon.tech) (serverless). Connections are managed via Neon's serverless driver, compatible with edge and serverless runtimes.

**Drizzle ORM** is used for schema definition, migrations, and queries. Schema lives in `lib/db/schema/`. Migrations are managed with `drizzle-kit`.

Key domain vocabulary used in the database schema:

- **phases** — what the NFL calls "weeks" (e.g., Week 1, Wild Card, Super Bowl). The term "week" is avoided in DB column names and code.
- **events** — what are colloquially called "games". The term "game" is avoided in DB column names and code.

---

## Auth

**Better Auth** with Google and Discord OAuth providers. No email/password login. Session management and OAuth callbacks are handled by Better Auth. Auth configuration lives in `lib/auth.ts`.

---

## Background Jobs

**Cron-triggered API routes** in `app/api/cron/`. External scheduling is handled by [cron-job.org](https://cron-job.org), which calls these routes on a schedule.

Routes are authenticated via a `CRON_SECRET` environment variable checked in `lib/cron-auth.ts`. See `docs/BACKGROUND_JOBS.md` for full details on job structure and schedules.

Sport-specific cron routes live under sport namespaces:

- `app/api/cron/nfl/` — NFL sync jobs
- `app/api/cron/march-madness/` — (future) March Madness sync jobs

---

## UI Components

**shadcn/ui** built on Radix UI primitives. Components are copied into `components/ui/` and owned by the project — they are not imported from a package. New components are added via `pnpm dlx shadcn@latest add <component>`.

---

## Styling

**Tailwind CSS v4**. Configuration and theme tokens live in `app/globals.css` (v4 uses CSS-first config, not `tailwind.config.js`).

**next-themes** is used for dark mode support. **lucide-react** is the icon library.

---

## Forms

**react-hook-form** with **@hookform/resolvers** for schema-based validation. All form schemas are defined with **Zod** and passed to the resolver. Zod schemas are also reused for server-side validation in server actions.

---

## Date and Time

**date-fns** for general date manipulation. **date-fns-tz** for timezone-aware operations (e.g., game start times, pick lock deadlines in US timezones).

---

## Testing

**Vitest** for unit and integration tests. Tests live alongside the code they test (e.g., `lib/nfl/scoring.test.ts`). Run with `pnpm test`.

---

## Linting and Formatting

- **ESLint** configured with `next/core-web-vitals` and `next/typescript` rule sets.
- **Prettier** for code formatting.
- Run: `pnpm lint`, `pnpm format`

---

## Deployment

**Vercel**. The project deploys automatically on push to `main`. Environment variables are configured in the Vercel dashboard. Edge and serverless function runtimes are used as appropriate.

---

## Monitoring

**Sentry** for error tracking and performance monitoring in production.

---

## Package Manager

**pnpm**. Always use `pnpm` — never `npm` or `yarn`.

Common commands:

- `pnpm dev` — start local dev server
- `pnpm build` — production build
- `pnpm test` — run Vitest
- `pnpm lint` — run ESLint
- `pnpm format` — run Prettier
- `pnpm db:push` — push Drizzle schema changes
- `pnpm db:studio` — open Drizzle Studio

---

## Project Structure

```
app/                  # Next.js App Router (pages, layouts, API routes)
  api/
    cron/
      nfl/            # NFL cron job routes
components/           # Shared React components
  ui/                 # shadcn/ui components
lib/                  # Server-side business logic and utilities
  db/                 # Drizzle schema, client, migrations
  auth.ts             # Better Auth config
  cron-auth.ts        # CRON_SECRET bearer token auth
  nfl/                # NFL-specific business logic
  espn/
    nfl/              # ESPN API client for NFL data
  sync/
    nfl/              # NFL data sync pipeline
data/                 # Data access layer (DB queries)
actions/              # Next.js Server Actions
docs/                 # Project documentation
work/                 # AI working directory (Backlog.md, tasks)
```

Structure follows root-level conventions — there is no `src/` prefix.
