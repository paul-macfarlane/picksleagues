# Picks Leagues

Web app where friends create and compete in sports pick'em leagues. Solo project, <50 users year one. MVP: NFL Pick'em, NFL Elimination, March Madness Pool. Full spec lives in `docs/`.

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
- **Execution model — under evaluation.** This branch is running the [`atlas-v3`](https://github.com/JahnelGroup/atlas-plugin-v3) plugin in place of the repo's own pipeline: `/atlas-implement` delivers a work package, `/atlas-plan` optionally plans one first, `/atlas-improve` audits a finished run. The skills `/task`, `/backlog`, `/feedback`, `/simplify` and the `implementer` and `evaluator` agents are parked in `.claude/_parked/` (not loaded) for the duration. `scout` remains available for broad fact-gathering surveys. Read `docs/atlas-experiment.md` for what changed, what Atlas does **not** cover, and how to revert.
- **Decisions get recorded.** Any non-obvious architectural choice → `/adr`. If a choice contradicts `docs/architecture.md`, update that doc too.
- Both docs are **locked at v0.3** and mutually reconciled — deviate only with a recorded reason (ADR), and keep them reconciled with each other.
- **Time discipline is the repo's most load-bearing convention:** no raw `Date.now()`, no `new Date()` for "now", no SQL `now()` in domain logic — everything reads the injected `Clock` (arch D13). A lint rule enforces it from FND-6 on.
- **The shell is zsh.** Quote a glob meant for the *tool* rather than the shell (`grep --include='*.ts'`) — unquoted, zsh tries to expand it first and the command dies with `no matches found`. In a compound command that `cd`s, use absolute paths afterwards: relative ones resolve against the new directory and fail quietly, which is how a capture ends up half-empty rather than obviously broken.

## Agent skills

### Issue tracker

Local markdown in `backlog/` — one file per epic, stable IDs, four checkbox states, deps-based availability, build order from `backlog/README.md`. GitHub Issues is unused. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical roles, unchanged, written as trailing tags on the task line. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — `docs/mvp-spec.md` + `docs/architecture.md` + root `docs/adr/`. See `docs/agents/domain.md`.

@.claude/rules/engineering.md

<!-- atlas-v3:guidance:start -->
## Workspace framing

Atlas workspace: **picksleagues**. Confirmed repositories:

- `picksleagues` at `.`; base `staging`; source host `github`.

When isolation or parallel delivery benefits from worktrees, they live beneath
`.claude/worktrees/<work-package>/<repository-id>/`. The frontier
orchestrator chooses direct checkout, worker worktrees, and an optional
integration worktree from the dependency, concurrency, file-ownership, and
shared-state risks. Never place worktrees beneath `.atlas/`. Each affected
repository keeps its own base SHA, branch, verification result, and pull request.

## Repository framing

**picksleagues** — Web app where friends create and compete in sports pick'em leagues. Solo project, under 50 users in year one. MVP game modes: NFL Pick'em, NFL Elimination, March Madness Pool.

### Structure

- `apps/web/` — Vite + React SPA (TanStack Router/Query/Form), including the static rules guide
- `apps/api/` — Hono + @hono/zod-openapi on Vercel Functions: routes, idempotent job endpoints, simulator endpoints
- `packages/schemas/` — Zod DTOs and per-mode league settings; the single source for runtime validation, OpenAPI generation, and TS types
- `packages/db/` — Drizzle schema and migrations
- `packages/scoring/` — Pure settlement and scoring functions: plain data in, plain data out, zero I/O
- `packages/core/` — Clock service, GameDataProvider, ESPN and simulated providers, env config
- `openapi/` — Committed generated OpenAPI spec and openapi-fetch web client
- `backlog/` — The issue tracker: one markdown file per epic
- `docs/` — mvp-spec.md and architecture.md (both locked at v0.3), adr/, agents/
- `e2e/` — Playwright specs run against the full local stack

### Repository-specific rules

- Time discipline is the most load-bearing convention: every 'now' read goes through the injected Clock. No Date.now(), no new Date() for current time, no SQL now() in domain logic. A lint rule enforces it. In the SPA, any label phrased relative to now reads useAppNow(), never Date.now(), because under the simulator the browser sits at a different instant.
- docs/mvp-spec.md and docs/architecture.md are locked at v0.3 and mutually reconciled. A change that deviates from either is a human decision requiring an ADR via /adr first. Escalate; never decide autonomously.
- .claude/rules/engineering.md governs craft standards and every change must follow it. Each rule states the failure it prevents.
- Lock state is derived, never stored: reads compute locked = kickoff_at <= clock.now(), and every pick mutation re-validates kickoff_at > clock.now() inside its transaction.
- The SPA consumes only the generated OpenAPI client. Changing a Zod schema or route means regenerating and committing openapi/ in the same change; pnpm contract:check fails otherwise.
- Postgres runs locally in Docker on port 5433 via pnpm db:up.
- Never run pnpm test:e2e without explicit human approval: it deletes every league in the dev database.
- The season simulator is the repo's primary verification harness. Driving it is usually stronger proof than a screenshot; mechanics live in docs/agents/verification-runbook.md.

## Atlas repository workflow

Use the lightest route that fits:

- Small, clear change: `/implement <description-or-spec>` then verify.
- Normal feature: `/grill-with-docs` → optional prototype → `/to-spec` → optional `/to-tickets` → `/atlas-red-team` when required → optional `/atlas-plan <ticket-epic-or-spec>` → `/atlas-implement`.
- Huge or unclear effort: `/wayfinder`, then rejoin at the spec route.
- Existing ticket, epic, or stable spec: optional `/atlas-plan <work-package>` → `/atlas-implement <work-package>`.

Run `/atlas-plan` and `/atlas-implement` using the most capable approved
frontier-grade model available. These commands reserve frontier capacity for
planning, orchestration, review, and final verification; implementation
delegates tightly specified or mechanical work to the least expensive capable
worker model.

Managed work uses `/atlas-implement <ticket-or-epic-or-spec>`. A frontier
orchestrator chooses the execution structure and delegates bounded deliverables
when useful. It uses the least expensive capable worker model per delegation;
tight, mechanical packets favor cheaper models, while final review and
verification judgment stay with the frontier orchestrator. Implementation
workers read and follow the supported Matt Pocock implementation skill source
while deferring its final review step. Size alone is never a reason to stop.

## Repository policy and contract model

`CLAUDE.md` is the agent entry point and cross-cutting policy router. Team-owned
documents under `docs/agents/` are authoritative for their named scope. Within
a document that classifies entries, the classification determines authority;
recommendations and repository facts do not silently become mandatory policy.
Tickets and specs remain stable work-package contracts. Planning resolves the
applicable repository policy and facts into technical plans and execution
packets. Generic skills provide reusable mechanics and do not override
repository policy.

Setup initializes `docs/agents/*`; the team owns those files afterward. A setup
rerun reads and preserves their current content instead of regenerating it.

- Before any tracker read, write, comment, claim, or transition, read and follow
  `docs/agents/issue-tracker.md`.
- Before creating, classifying, prioritizing, or decomposing tickets, read and
  follow `docs/agents/triage-labels.md`.
- Before clarifying, researching, prototyping, specifying, decomposing,
  technically planning, or red-team reviewing proposed work, read and follow
  `docs/agents/planning.md`. This includes `/grill-with-docs`, Wayfinder,
  planning prototypes, `/to-spec`, `/to-tickets`, and `/atlas-plan`.
- During planning, read `docs/agents/domain.md` when the work introduces or
  changes domain concepts and resolve conflicting terminology in the plan.
- Before writing acceptance criteria, Definition of Done, fixtures, or
  verification steps, read `docs/agents/testing.md`.
- During planning, read `docs/agents/tooling.md` when work depends on a detected
  capability and resolve the applicable tool into the execution plan.
- Before changing Claude permissions, Atlas hooks, git hooks, or guardrail
  policy, read `docs/agents/guardrails.md` and obtain human approval.

Execution workers receive resolved decisions, exact verification commands, and
the evidence location in their task packet. Do not make execution workers
reread planning, tracker, triage, domain, testing, or tooling guidance.

## Atlas planning contract

- Invoking `/atlas-implement` approves the fixed work-package contract and any
  existing technical plan. When the contract is content-complete but no plan
  exists, the frontier orchestrator derives the execution plan without inventing
  missing product or architectural decisions.
- `/atlas-plan` is optional. Read `docs/agents/issue-tracker.md` for the
  project's configured readiness, availability, claim, transition, and
  writeback policy; do not infer those rules here.

## Atlas guardrails

- Protected branches by repository: `picksleagues:staging`, `picksleagues:main`. Changes land through each repository's configured PR.
- Never merge a PR. Follow `docs/agents/issue-tracker.md` for human-only tracker actions.
- Never read or write live secret files. Use `.example` or `.template` files and ask a human to populate live values out of band.
- Never force-push, bypass hooks, destroy uncommitted work, repoint remotes, or weaken guardrails.
- Cloud tools detected/configured: vercel. Terraform, CDK, and kubectl mutations are denied outright in `.claude/settings.json`. **Vercel is not**: no `deny` rule covers it, and its protection is the repo's own `.claude/hooks/guard-destructive.sh`, which *prompts* rather than blocks on `vercel --prod`, `promote`, and `rollback` (and on `drizzle-kit push|migrate` against a non-localhost `DATABASE_URL`, and `curl` to `/jobs/*` or `/sim/*` off-localhost). Treat a prompt as a stop, not a formality.
- Guardrail exceptions must be durable, attributable, narrow, environment-specific, and time-bounded.
- Claude permission precedence is `deny` over `ask` over `allow`, regardless of
  specificity. Permission modes that suppress prompts can bypass an `ask`; they
  do not override a `deny` or an enforcement hook.
- Activation, failure behavior, transcript retention, and troubleshooting are in
  `docs/agents/guardrails.md`.
<!-- atlas-v3:guidance:end -->
