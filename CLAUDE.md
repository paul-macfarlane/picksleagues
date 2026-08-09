# Picks Leagues

Web app where friends create and compete in sports pick'em leagues. Solo project, <50 users year one. MVP: NFL Pick'em, NFL Survivor, March Madness Pool. Full spec lives in `docs/`.

## Read first

- **Product:** `docs/mvp-spec.md` — standalone, complete MVP rule set for every game mode. Source of truth for _what_.
- **Architecture:** `docs/architecture.md` — locked stack, environments, simulator, data model, and decision log (D1–D15). Source of truth for _how_.
- **Engineering rules:** `.claude/rules/engineering.md` — standards every change must follow (imported below).
- **Backlog:** `backlog/` — work split by epic. Pick tasks from here.
- **Runtime verification:** `docs/runbooks/verification.md` — how to launch, drive, and prove a change works locally (ports, session minting, sim endpoints, test layers). `docs/simulator-guide.md` goes deeper on the simulator itself, the repo's primary verification harness.
- **Decisions:** `docs/adr/` — architecture decision records.

## Stack (see docs/architecture.md for rationale)

pnpm workspaces monorepo · Vite + React + TanStack Router/Query/Form SPA · Hono + `@hono/zod-openapi` on Vercel Functions · OpenAPI contract → generated `openapi-fetch` client · Neon Postgres (Docker locally) + Drizzle · Better Auth (Google + Discord) · Tailwind + shadcn/ui · cron-job.org → idempotent job endpoints · Vitest + Playwright.

## Layout (target — scaffolded in FND-1)

`apps/web` SPA (incl. static rules guide) · `apps/api` Hono app (routes, jobs, sim) · `packages/schemas` Zod DTOs + per-mode league settings · `packages/db` Drizzle schema/migrations · `packages/scoring` pure settlement functions · `packages/core` Clock service, `GameDataProvider`, ESPN/simulated providers, env config · `openapi/` committed generated spec + web client.

## Working here

- **Git flow:** feature branches branch off **`staging`** and PRs target `staging`; `staging` → `main` promotes to prod. Pushing feature branches needs no confirmation; anything touching `staging`/`main` prompts (guard hook in `.claude/hooks/`).
- **Execution model.** Work comes from `backlog/`, in build order. `/task` delivers it — clarify → execute → test & review → share; `/backlog` shows status and what's next; `/feedback` applies a review round; `/ask` answers questions read-only; `/adr` records decisions. The one custom agent is `evaluator`: a fresh-context review, mandatory on diffs touching scoring, lock/visibility semantics, settlement, override precedence, or a migration.
- **Parallel sessions.** A second session works in a sibling worktree from `/worktree` (it copies the env files a bare `git worktree add` silently omits). The dev DB on :5433 and the integration/e2e suites are shared state — heavy suites run one at a time, and the later branch rebases on `staging` after an earlier PR merges.
- **Decisions get recorded.** Any non-obvious architectural choice → `/adr`. If a choice contradicts `docs/architecture.md`, update that doc too — `mvp-spec.md` and `architecture.md` are **locked at v0.3** and mutually reconciled, so deviating needs a recorded reason and keeps them in step with each other.
- **Time discipline is the repo's most load-bearing convention:** no raw `Date.now()`, no `new Date()` for "now", no SQL `now()` in domain logic — everything reads the injected `Clock` (arch D13). A lint rule enforces it from FND-6 on.
- **The shell is zsh.** Quote a glob meant for the *tool* rather than the shell (`grep --include='*.ts'`) — unquoted, zsh tries to expand it first and the command dies with `no matches found`. In a compound command that `cd`s, use absolute paths afterwards: relative ones resolve against the new directory and fail quietly, which is how a capture ends up half-empty rather than obviously broken.

## Guardrails

- Protected branches: `staging` and `main` — changes land through PRs; never merge a PR (human-only).
- Never read or write live secret files; use `.example`/`.template` files and ask a human to populate live values out of band.
- Never force-push, bypass hooks, destroy uncommitted work, repoint remotes, or weaken guardrails.
- Terraform/CDK/kubectl mutations are denied in `.claude/settings.json`. **Vercel is not denied**: its protection is `.claude/hooks/guard-destructive.sh`, which *prompts* on `vercel --prod`/`promote`/`rollback` (and on `drizzle-kit push|migrate` against a non-localhost `DATABASE_URL`, and `curl` to `/jobs/*` or `/sim/*` off-localhost). Treat a prompt as a stop, not a formality.
- Permission precedence is `deny` over `ask` over `allow`, regardless of specificity. A permission mode that suppresses prompts can bypass an `ask`; it cannot override a `deny` or an enforcement hook.

## Tracker

Local markdown in `backlog/` — one file per epic, stable IDs, four checkbox states (`[ ]`/`[~]`/`[x]`/`[!]`), deps-based availability. Build order comes from `backlog/README.md`, not the order the files sort in: file numbers record when an epic was written, not its priority. GitHub Issues is unused — never `gh issue create` here. Conventions and triage tags live in `backlog/README.md`.

@.claude/rules/engineering.md

