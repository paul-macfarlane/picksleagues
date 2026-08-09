# Picks Leagues

Web app where friends create and compete in sports pick'em leagues. Solo project, <50 users year one. MVP: NFL Pick'em, NFL Survivor, March Madness Pool. Full spec lives in `docs/`.

## Read first

- **Product:** `docs/mvp-spec.md` — standalone, complete MVP rule set for every game mode. Source of truth for _what_.
- **Architecture:** `docs/architecture.md` — locked stack, environments, simulator, data model, and decision log (D1–D15). Source of truth for _how_.
- **Engineering rules:** `.claude/rules/engineering.md` — standards every change must follow (imported below).
- **Backlog:** `backlog/` — work split by epic. Pick tasks from here.
- **Simulator:** `docs/simulator-guide.md` — operator runbook for driving the season simulator (the repo's primary verification harness).
- **Runtime verification:** `docs/agents/verification-runbook.md` — how to launch, drive, and prove a change works locally (ports, session minting, sim endpoints, test layers).
- **Decisions:** `docs/adr/` — architecture decision records.

## Stack (see docs/architecture.md for rationale)

pnpm workspaces monorepo · Vite + React + TanStack Router/Query/Form SPA · Hono + `@hono/zod-openapi` on Vercel Functions · OpenAPI contract → generated `openapi-fetch` client · Neon Postgres (Docker locally) + Drizzle · Better Auth (Google + Discord) · Tailwind + shadcn/ui · cron-job.org → idempotent job endpoints · Vitest + Playwright.

## Layout (target — scaffolded in FND-1)

`apps/web` SPA (incl. static rules guide) · `apps/api` Hono app (routes, jobs, sim) · `packages/schemas` Zod DTOs + per-mode league settings · `packages/db` Drizzle schema/migrations · `packages/scoring` pure settlement functions · `packages/core` Clock service, `GameDataProvider`, ESPN/simulated providers, env config · `openapi/` committed generated spec + web client.

## Working here

- **Git flow:** feature branches branch off **`staging`** and PRs target `staging`; `staging` → `main` promotes to prod. Pushing feature branches needs no confirmation; anything touching `staging`/`main` prompts (guard hook in `.claude/hooks/`).
- **Backlog-driven.** Work comes from `backlog/`, in the sequence given by `backlog/README.md` §Build order — not the order the epic files sort in. `/ask` answers questions read-only; `/adr` records decisions.
- **Execution model.** Work runs through the repo's own pipeline: `/task` delivers a work package (clarify → plan → implement → verify → close out), `/backlog` shows status and the next runnable task, `/feedback` applies a review round, `/simplify` is the craft pass at epic close-out. `/adr` records decisions; `/ask` answers questions read-only. Agents: `scout` (read-only surveys), `implementer` (parallel mechanical slices), `evaluator` (mandatory fresh-context review on scoring/locking/settlement/override-precedence/migration diffs).
- **Parallel sessions.** Unrelated work packages may run in concurrent sessions: the second+ session works in a sibling worktree bootstrapped by `/worktree` (it copies the env files a worktree otherwise lacks). `/task`'s claim-time conflict check flags overlapping file surfaces — overlap means sequential. Heavy suites (`test:integration`, `test:e2e`) share databases and ports and are one-at-a-time across sessions; the dev DB on :5433 is shared state. Merge order: the later branch rebases on `staging` after an earlier PR merges.
- **Decisions get recorded.** Any non-obvious architectural choice → `/adr`. If a choice contradicts `docs/architecture.md`, update that doc too.
- Both docs are **locked at v0.3** and mutually reconciled — deviate only with a recorded reason (ADR), and keep them reconciled with each other.
- **Time discipline is the repo's most load-bearing convention:** no raw `Date.now()`, no `new Date()` for "now", no SQL `now()` in domain logic — everything reads the injected `Clock` (arch D13). A lint rule enforces it from FND-6 on.
- **The shell is zsh.** Quote a glob meant for the *tool* rather than the shell (`grep --include='*.ts'`) — unquoted, zsh tries to expand it first and the command dies with `no matches found`. In a compound command that `cd`s, use absolute paths afterwards: relative ones resolve against the new directory and fail quietly, which is how a capture ends up half-empty rather than obviously broken.

## Guardrails

- Protected branches: `staging` and `main` — changes land through PRs; never merge a PR (human-only).
- Never read or write live secret files; use `.example`/`.template` files and ask a human to populate live values out of band.
- Never force-push, bypass hooks, destroy uncommitted work, repoint remotes, or weaken guardrails.
- Terraform/CDK/kubectl mutations are denied in `.claude/settings.json`. **Vercel is not denied**: its protection is `.claude/hooks/guard-destructive.sh`, which *prompts* on `vercel --prod`/`promote`/`rollback` (and on `drizzle-kit push|migrate` against a non-localhost `DATABASE_URL`, and `curl` to `/jobs/*` or `/sim/*` off-localhost). Treat a prompt as a stop, not a formality.
- Permission precedence is `deny` over `ask` over `allow`, regardless of specificity. A permission mode that suppresses prompts can bypass an `ask`; it cannot override a `deny` or an enforcement hook.

## Tracker

Local markdown in `backlog/` — one file per epic, stable IDs, four checkbox states (`[ ]`/`[~]`/`[x]`/`[!]`), deps-based availability, build order from `backlog/README.md` §Build order. GitHub Issues is unused — never `gh issue create` here. Conventions, triage tags, and the plan-file pointer rule live in `backlog/README.md`.

@.claude/rules/engineering.md

