---
description: Run a backlog task through the implementation pipeline (plan → implement → verify → done)
argument-hint: <task-id | next | epic-prefix> [--auto] [--plan|--no-plan] [--test=auto|manual|skip]
---

Run the implementation pipeline for: **$ARGUMENTS**

A "task" may be one backlog item, several related items, or a whole epic — scope it from the argument.

## Target & gates

- **Target:** `next` = first `[ ]` in build order across `backlog/` whose `deps:` are all `[x]`. A task ID (e.g. `PKM-3`) = that item. An epic prefix (e.g. `PKM`) = that epic's open tasks in order. Nothing runnable → say so and stop.
- **Gates** (human checkpoints, skipped by `--auto`):
  - `plan-review` — human review of the plan before implementing. **Default OFF**: plan and proceed without stopping. `--plan` turns review ON (present the plan and wait for approval).
  - `test` — default `auto`; `--test=manual` stops for the human to test; `--test=skip` only when there is no runtime surface.
- State the resolved target and gates in one line, and mark the task `[~]` in its backlog file.
- **Branch first:** before touching any code, create a feature branch off `staging` (`feat/<task-id-or-epic-slug>`); all pipeline work happens on it. If the working tree already has unrelated uncommitted changes, ask before proceeding.

## Execution model

You implement directly — planning, coding, and verification stay in this conversation, with full context. Subagents are tools you reach for when they buy something concrete, not a pipeline every task passes through:

- **Delegate to `implementer` (Sonnet)** when several self-contained mechanical slices can run **in parallel on disjoint files** (wall-clock win), or when a large mechanical wave is worth keeping off the premium-usage budget (cost valve). A dispatch must be a complete spec — task ID, files, acceptance criteria, applicable architecture/spec §sections, the pattern to follow — because the agent sees only your prompt. If writing the spec costs as much as making the edit, make the edit yourself.
- **Never delegate** diffs touching `packages/scoring`, lock/visibility semantics, settlement/recompute, or override precedence. This repo's bugs will live there; that code is yours.
- **`scout` agents** are for parallel fact-gathering when a survey is genuinely broad (many call sites, cross-workspace sweeps). A question one or two files can answer, read directly. A per-dispatch Haiku override is fine for purely mechanical sweeps.
- **Rule of three.** "Follow the pattern of X exactly" faithfully propagates boilerplate — whether you're coding or dispatching. If the work would create a third copy of anything (a constant, a guard block, a response descriptor, a test fixture), extract it to a shared home first.

You own the correctness and integration of everything, including anything a subagent returns — verify delegated work yourself (spot-read the diff, run gates) before building on it.

## Pipeline

1. **Plan** — know the plan before coding, at the weight the task deserves: a few sentences for a contained change; a written plan (files to touch, approach, applicable `docs/mvp-spec.md` / `docs/architecture.md` §sections, any decision needing an ADR) for multi-file or risk-surface work. Verify current-state facts from the repo, not memory — read directly, or fan out scouts when the survey is broad. If `--plan` is on, present the plan and wait for approval.
2. **Implement** — follow `.claude/rules/engineering.md` and the architecture doc; use the Vercel/Drizzle/shadcn skills for framework specifics. Contract changes regenerate `openapi/` in the same commit.
3. **Verify** — always: `pnpm typecheck && pnpm lint && pnpm test` scoped to what you touched, plus demonstrating the affected flow works (`/verify` or `/run` — prefer driving it through the **simulator**), plus unit tests for scoring/service logic. Then review by risk:
   - **Risk-gated independent review:** if the diff touches `packages/scoring`, lock/visibility semantics, settlement/recompute, override precedence, or a migration, dispatch the `evaluator` (fresh context) briefed with the diff, the plan, the acceptance criteria, and the two standing checks: **the unhandled-error/observability path** (service throws → logged JSON 500; framework 4xx refusals pass through) and **boundary instants** for anything clock-derived. Confirmed findings get fixed and re-verified by the same evaluator (SendMessage keeps its context); rejected findings get a recorded rationale.
   - **Everything else:** self-review the full diff against the plan and `.claude/rules/engineering.md` before closing out. The `evaluator` and `/code-review` stay available on demand when a fresh pair of eyes would genuinely help.
   - In `--test=manual`, describe what to test and wait for the result.
4. **Close out** — docs updated if behavior/architecture changed, non-obvious decisions recorded via `/adr`, task marked `[x]`. **For epic-scale targets (or any run of 3+ tasks): run `/simplify` over the full diff before opening the PR** — correctness review skips style by design; the simplify pass is where cross-task duplication gets caught, and lint's `max-lines` warnings are its input list. Then commit the work to the feature branch (conventional-prefix messages, logically grouped commits), push it, and open a PR targeting `staging` with `gh pr create` (summary, task IDs, test/review outcomes in the body). Pushing a feature branch needs no confirmation; never push to `staging`/`main` directly.
5. **Report** — what shipped, review/test outcomes, docs/ADRs touched, the PR link, next unblocked task.

## Escalate — in every mode, including `--auto`

Stop and ask the human when:

- a change would **deviate from `docs/architecture.md` or `docs/mvp-spec.md`** (locked at v0.3) — propose the deviation and an ADR before coding it;
- a **product or scope question** isn't settled by the spec, architecture doc, or task, and a wrong guess means real rework (choices with a sensible default: pick it, note it, move on);
- **prerequisites are missing** — credentials, env vars, an unmet `deps:` task;
- you're **not progressing** — ~3 review/test fix loops on the same issue; report what you tried;
- the task is **materially bigger** than its one-line scope implies — propose a split.
  Plus your standing defaults for anything destructive, irreversible, outward-facing, or security-sensitive. Make the ask the headline, give your recommendation, and wait.
