---
description: Run a backlog task through the implementation pipeline (plan → implement → review → test → document → done)
argument-hint: <task-id | next | epic-prefix> [--auto] [--plan|--no-plan] [--test=auto|manual|skip]
---

Run the implementation pipeline for: **$ARGUMENTS**

A "task" may be one backlog item, several related items, or a whole epic — scope it from the argument.

## Target & gates

- **Target:** `next` = first `[ ]` in build order across `backlog/` whose `deps:` are all `[x]`. A task ID (e.g. `PKM-3`) = that item. An epic prefix (e.g. `PKM`) = that epic's open tasks in order. Nothing runnable → say so and stop.
- **Gates** (human checkpoints, skipped by `--auto`):
  - `plan-review` — human review of the plan before implementing. **Default OFF**: the plan is written and handed straight to implementation without stopping. `--plan` turns review ON (present the plan and wait for approval). A plan is **always** produced regardless of this gate (Pipeline step 1) — the gate only controls whether a human approves it first, never whether a plan exists.
  - `test` — default `auto`; `--test=manual` stops for the human to test; `--test=skip` only when there is no runtime surface.
- State the resolved target and gates in one line, and mark the task `[~]` in its backlog file.
- **Branch first:** before touching any code, create a feature branch off `staging` (`feat/<task-id-or-epic-slug>`); all pipeline work happens on it. If the working tree already has unrelated uncommitted changes, ask before proceeding.

## Model routing — three tiers, risk-weighted

You are the **orchestrator**: planning, integration, dispatching, and reconciling stay with you. Delegate self-contained mechanical chunks (established pattern, no open design decisions) to the **`implementer` subagent (Sonnet)**. It sees only your prompt, so each delegation must be a complete spec: task ID, files, acceptance criteria, applicable architecture/spec §sections, and the pattern to follow. Completed work is reviewed by the **`evaluator` subagent (Opus)** — see Pipeline step 3. When implementer output and evaluator findings disagree, you adjudicate: trace the code yourself, decide, and record the rationale; the human breaks ties you can't. You own the correctness and integration of everything either agent returns.

**Risk-weighted overrides** — this repo's bugs will live in scoring, locking, settlement, and override precedence, so spend model capacity there:

- Diffs touching **`packages/scoring`**, lock/visibility semantics, settlement/recompute, or override precedence: implement them **yourself** (orchestrator) or dispatch `implementer` with a per-dispatch **Opus** override — never plain mechanical dispatch. Evaluate them with the evaluator dispatched at the **session model tier** (per-dispatch override) instead of its default Opus.
- Purely mechanical scout sweeps (file inventories, listing test titles) may use a per-dispatch **Haiku** override. Haiku never implements or evaluates.
- Everything else: defaults (scout Sonnet, implementer Sonnet, evaluator Opus).

Every delegation is built from the Pipeline step-1 plan: hand the implementer the relevant slice of that plan as its spec. The plan is always written and always drives the coding — so an agent never codes without a plan behind it, even when the plan-review gate is off.

## Pipeline

1. **Plan** — **always** produce a written plan: files to touch, approach, applicable `docs/mvp-spec.md` / `docs/architecture.md` §sections, any decision needing an ADR. When the plan depends on current-state facts you haven't verified (call sites, existing patterns, coverage), dispatch `scout` agents first rather than planning from memory. The plan must be concrete enough to hand off. If the plan-review gate is on (`--plan`), present it and wait for approval; by default, hand it straight to implementation.
2. **Implement** — follow `.claude/rules/engineering.md` and the architecture doc; use the Vercel/Drizzle/shadcn skills for framework specifics. Contract changes regenerate `openapi/` in the same commit.
3. **Review & test** — done when the `evaluator` subagent, briefed with the diff, the plan, and the task's acceptance criteria, returns a clean verdict (confirmed findings go to an `implementer` to fix, then the same evaluator re-verifies; findings you reject get a recorded rationale), and the affected flow demonstrably works (`/verify` or `/run` — prefer driving it through the **simulator** once SIM lands — plus unit tests for scoring/service logic). `/code-review` remains available for focused single-concern passes. In `--test=manual`, describe what to test and wait for the result.
4. **Close out** — docs updated if behavior/architecture changed, non-obvious decisions recorded via `/adr`, task marked `[x]`. Then commit the work to the feature branch (conventional-prefix messages, logically grouped commits), push it, and open a PR targeting `staging` with `gh pr create` (summary, task IDs, test/review outcomes in the body). Pushing a feature branch needs no confirmation; never push to `staging`/`main` directly.
5. **Report** — what shipped, review/test outcomes, docs/ADRs touched, the PR link, next unblocked task.

## Escalate — in every mode, including `--auto`

Stop and ask the human when:

- a change would **deviate from `docs/architecture.md` or `docs/mvp-spec.md`** (locked at v0.3) — propose the deviation and an ADR before coding it;
- a **product or scope question** isn't settled by the spec, architecture doc, or task, and a wrong guess means real rework (choices with a sensible default: pick it, note it, move on);
- **prerequisites are missing** — credentials, env vars, an unmet `deps:` task;
- you're **not progressing** — ~3 review/test fix loops on the same issue; report what you tried;
- the task is **materially bigger** than its one-line scope implies — propose a split.
  Plus your standing defaults for anything destructive, irreversible, outward-facing, or security-sensitive. Make the ask the headline, give your recommendation, and wait.
