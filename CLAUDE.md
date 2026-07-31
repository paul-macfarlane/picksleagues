# Picks Leagues

Web app where friends create and compete in sports pick'em leagues. Solo project, <50 users year one. MVP: NFL Pick'em, NFL Elimination, March Madness Pool. Full spec lives in `docs/`.

## Read first

- **Product:** `docs/mvp-spec.md` — standalone, complete MVP rule set for every game mode. Source of truth for _what_.
- **Architecture:** `docs/architecture.md` — locked stack, environments, simulator, data model, and decision log (D1–D15). Source of truth for _how_.
- **Engineering rules:** `.claude/rules/engineering.md` — standards every change must follow (imported below).
- **Backlog:** `backlog/` — work split by epic. Pick tasks from here.
- **Simulator:** `docs/simulator-guide.md` — operator runbook for driving the season simulator (the repo's primary verification harness).
- **Decisions:** `docs/adr/` — architecture decision records.

## Stack (see docs/architecture.md for rationale)

pnpm workspaces monorepo · Vite + React + TanStack Router/Query/Form SPA · Hono + `@hono/zod-openapi` on Vercel Functions · OpenAPI contract → generated `openapi-fetch` client · Neon Postgres (Docker locally) + Drizzle · Better Auth (Google + Discord) · Tailwind + shadcn/ui · cron-job.org → idempotent job endpoints · Vitest + Playwright.

## Layout (target — scaffolded in FND-1)

`apps/web` SPA (incl. static rules guide) · `apps/api` Hono app (routes, jobs, sim) · `packages/schemas` Zod DTOs + per-mode league settings · `packages/db` Drizzle schema/migrations · `packages/scoring` pure settlement functions · `packages/core` Clock service, `GameDataProvider`, ESPN/simulated providers, env config · `openapi/` committed generated spec + web client.

## Working here

- **Git flow:** feature branches branch off **`staging`** and PRs target `staging`; `staging` → `main` promotes to prod. Pushing feature branches needs no confirmation; anything touching `staging`/`main` prompts (guard hook in `.claude/hooks/`).
- **Backlog-driven.** Use `/task` to run a task through the implementation pipeline (plan → implement → verify → done). `/backlog` shows status. `/feedback` applies a round of human review feedback through the same machinery. `/ask` answers questions read-only.
- **Execution model.** The session model plans, implements, and verifies directly. Subagents are tools, not tiers: `scout` for parallel fact-gathering on broad surveys, `implementer` (Sonnet) for parallel mechanical fan-out or keeping large mechanical waves off the premium-usage budget, `evaluator` (Opus, fresh context) for adversarial review — mandatory on diffs touching `packages/scoring`, locking, settlement, or override precedence, on-demand elsewhere. See `/task` for the rules.
- **Decisions get recorded.** Any non-obvious architectural choice → `/adr`. If a choice contradicts `docs/architecture.md`, update that doc too.
- Both docs are **locked at v0.3** and mutually reconciled — deviate only with a recorded reason (ADR), and keep them reconciled with each other.
- **Time discipline is the repo's most load-bearing convention:** no raw `Date.now()`, no `new Date()` for "now", no SQL `now()` in domain logic — everything reads the injected `Clock` (arch D13). A lint rule enforces it from FND-6 on.

@.claude/rules/engineering.md
