# PicksLeagues — Claude Code Context

PicksLeagues is an NFL Pick'Em app. Users create/join private leagues, make weekly picks (straight-up or against the spread), and compete on a season-long leaderboard. Built with Next.js 16 (App Router), TypeScript, Drizzle ORM, Neon PostgreSQL, Better Auth, Inngest, shadcn/ui, and Tailwind CSS v4.

## Spec Documents

Read these before starting any work. They are the source of truth.

| Document                                        | What it covers                                                                                  |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| [BUSINESS_SPEC.md](./docs/BUSINESS_SPEC.md)     | **What** to build — all business rules, user flows, permissions, constants. Highest precedence. |
| [ARCHITECTURE.md](./docs/ARCHITECTURE.md)       | **How** to structure code — layer boundaries, patterns, testing, naming conventions.            |
| [TECH_STACK.md](./docs/TECH_STACK.md)           | **What technologies** to use — stack choices, project structure, deployment.                    |
| [BACKGROUND_JOBS.md](./docs/BACKGROUND_JOBS.md) | **Background work** — Inngest jobs, ESPN sync pipeline, game window detection.                  |

When specs conflict, BUSINESS_SPEC.md wins.

## Workflow

Follow [WAYS_OF_WORKING.md](./docs/WAYS_OF_WORKING.md) for the full process. The essentials:

1. **Start every session** by reading [BACKLOG.md](./docs/BACKLOG.md) to see what's done, in progress, and next
2. **Trace every task** to a BUSINESS_SPEC.md section before implementing
3. **Break work into vertical slices** — each slice delivers one testable behavior across layers
4. **Implement in layer order**: schema → data layer (`data/`) → business logic (`lib/`) → Server Action (`actions/`) → UI (`components/` + `app/`)
5. **Update BACKLOG.md** as you go — mark tasks `[~]` when starting, `[x]` when done
6. **Update spec docs** when business logic changes (especially BUSINESS_SPEC.md)

## Key Conventions

These are the rules that matter most. Violations of these are bugs.

- **Business logic lives in `lib/` only** — never in components, pages, or actions
- **Data access (Drizzle) lives in `data/` only** — nothing else imports Drizzle
- **Server Actions validate → authenticate → authorize → check business rules → execute → revalidate → return `ActionResult`**
- **Auth/permission errors throw** (caught by error boundaries); **business errors return** `{ success: false, error: "..." }`
- **Server Components are the default** — only add `"use client"` for interactivity
- **All dynamic APIs are async** — always `await` params, searchParams, headers(), cookies()
- **Shared Zod schemas** in `lib/validators/` — used by both forms and Server Actions
- **No `any` types** — use `unknown` and narrow
- **Types inferred** from Drizzle schemas and Zod, not manually declared
- **Tests mock at import boundaries** — `vi.mock("@/data/...")`, no database needed
- **Time-dependent logic** accepts an optional `now` parameter

## Commands

```bash
npm run dev              # Dev server (Turbopack)
npm run lint             # Lint (ESLint)
npm run format:check     # Check formatting (Prettier)
npm run format           # Fix formatting
npm test                 # Run tests (Vitest)
npm run typecheck        # Type check (tsc --noEmit)
npx drizzle-kit generate # Generate migrations
npx drizzle-kit migrate  # Apply migrations
```
