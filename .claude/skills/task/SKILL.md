---
description: Run a backlog task through the implementation pipeline (clarify → plan → implement → verify → done)
argument-hint: <task-id | next | epic-prefix> [--plan|--no-plan] [--test=auto|manual|skip]
---

Run the implementation pipeline for: **$ARGUMENTS**

A "task" may be one backlog item, several related items, or a whole epic — scope it from the argument.

## Target, claim & gates

- **Target:** `next` = first `[ ]` whose `deps:` are all `[x]`, walking epics in the order given by **`backlog/README.md` §Build order** — not the order the files happen to sort in. File numbers record when an epic was written, not its priority, and one epic (`09-launch`) is deliberately split across two positions, so directory order is wrong and cannot be made right by renaming. A task ID (e.g. `PKM-3`) = that item. An epic prefix (e.g. `PKM`) = that epic's open tasks in order. Nothing runnable → say so and stop.
- **Conflict check before claiming:** read the other `[~]` items across all epics. For each, establish its file surface — its `docs/plans/<id>.md` when one exists, else inferred from its description and epic. If this task's surface plausibly overlaps (same package, both force `openapi/` regeneration, same epic file), say so and recommend sequencing; the human decides. The check is heuristic, not a registry — when in doubt, flag it.
- **Gates** (human checkpoints):
  - `clarify` — **mandatory for work touching user-visible behavior or a `docs/mvp-spec.md` section.** After reading the task and its doc sections, ask the batched requirement and edge-case questions via the native question dialog, each with a recommended answer, and wait for the answers. Purely mechanical work (refactors, tooling, dep bumps) proceeds without stopping — say so. For feature work, "no questions" is itself a claim: state what makes the contract complete enough to skip.
  - `plan-review` — human review of the plan before implementing. **Default OFF**: plan and proceed without stopping. `--plan` turns review ON (present the plan and wait for approval).
  - `test` — default `auto`; `--test=manual` stops for the human to test; `--test=skip` only when there is no runtime surface.
- State the resolved target and gates in one line, and mark the task `[~]` in its backlog file.
- **Branch first:** before touching any code, create a feature branch off `staging` (`feat/<task-id-or-epic-slug>`); all pipeline work happens on it. A second concurrent session works in a sibling worktree created by `/worktree`, never in the main checkout. If the working tree already has unrelated uncommitted changes, ask before proceeding.

## Execution model

You implement directly — planning, coding, and verification stay in this conversation, with full context. Subagents are tools you reach for when they buy something concrete, not a pipeline every task passes through:

- **Delegate to `implementer` (Sonnet)** when several self-contained mechanical slices can run **in parallel on disjoint files** (wall-clock win), or when a large mechanical wave is worth keeping off the premium-usage budget (cost valve). A dispatch must be a complete spec — task ID, files, acceptance criteria, applicable architecture/spec §sections, the pattern to follow — because the agent sees only your prompt. If writing the spec costs as much as making the edit, make the edit yourself.
- **Never delegate** diffs touching `packages/scoring`, lock/visibility semantics, settlement/recompute, or override precedence. This repo's bugs will live there; that code is yours.
- **`scout` agents** are for parallel fact-gathering when a survey is genuinely broad (many call sites, cross-workspace sweeps). A question one or two files can answer, read directly. A per-dispatch Haiku override is fine for purely mechanical sweeps.
- **Rule of three.** "Follow the pattern of X exactly" faithfully propagates boilerplate — whether you're coding or dispatching. If the work would create a third copy of anything (a constant, a guard block, a response descriptor, a test fixture), extract it to a shared home first.

You own the correctness and integration of everything, including anything a subagent returns — verify delegated work yourself (spot-read the diff, run gates) before building on it.

## Pipeline

1. **Clarify & plan** — run the `clarify` gate first. Then know the plan before coding, at the weight the task deserves: a few sentences for a contained change; a written plan (files to touch, approach, applicable `docs/mvp-spec.md` / `docs/architecture.md` §sections, any decision needing an ADR) for multi-file or risk-surface work. **Epic-scale work, and any task about to run alongside another session, writes the plan to `docs/plans/<id>.md`** — for parallel work the plan doubles as the file-surface declaration the conflict check reads. Verify current-state facts from the repo, not memory — read directly, or fan out scouts when the survey is broad. If `--plan` is on, present the plan and wait for approval.
2. **Implement** — follow `.claude/rules/engineering.md` and the architecture doc; use the Vercel/Drizzle/shadcn skills for framework specifics. Contract changes regenerate `openapi/` in the same commit.
3. **Verify** — **tests land with the behavior:** any new or changed behavior gets an automated test at the cheapest layer that can pin it (the testing ladder in `.claude/rules/engineering.md`); driving the simulator by hand is the proof of last resort, reserved for what no layer can pin (visual layout, third-party behavior). Then always: `pnpm typecheck && pnpm lint && pnpm test` scoped to what you touched, plus demonstrating the affected flow works — prefer driving it through the **simulator**; mechanics in `docs/agents/verification-runbook.md`. **Heavy suites are exclusive:** `pnpm test:integration` and `pnpm test:e2e` share databases and ports across sessions — confirm no concurrent session is mid-suite before running either. Then review by risk:
   - **Risk-gated independent review:** if the diff touches `packages/scoring`, lock/visibility semantics, settlement/recompute, override precedence, or a migration, dispatch the `evaluator` (fresh context) briefed with the diff, the plan, the acceptance criteria, and the two standing checks: **the unhandled-error/observability path** (service throws → logged JSON 500; framework 4xx refusals pass through) and **boundary instants** for anything clock-derived. Confirmed findings get fixed and re-verified by the same evaluator (SendMessage keeps its context); rejected findings get a recorded rationale.
   - **Everything else:** self-review the full diff against the plan and `.claude/rules/engineering.md` before closing out. The `evaluator` and `/code-review` stay available on demand when a fresh pair of eyes would genuinely help.
   - In `--test=manual`, describe what to test and wait for the result.
4. **Close out** — docs updated if behavior/architecture changed, non-obvious decisions recorded via `/adr`, task marked `[x]`. **For epic-scale targets (or any run of 3+ tasks): run `/simplify` over the full diff before opening the PR** — correctness review skips style by design; the simplify pass is where cross-task duplication gets caught, and lint's `max-lines` warnings are its input list. Then commit the work to the feature branch (conventional-prefix messages, logically grouped commits), push it, and open a PR targeting `staging` with `gh pr create` (summary, task IDs, test/review outcomes in the body). **The PR body ends with a `## Human review` section** — three subsections, each written even when its answer is "none":
   - **Decisions made without asking** — choices the docs didn't settle, with a one-line rationale each.
   - **Judgment surfaces** — UX, layout, copy, and visual choices automation can't validate.
   - **Not provable by automation** — anything whose proof needs prod config, real ESPN behavior, or eyes on a screen.

   If another session's PR merged to `staging` since branching, rebase before merge. Pushing a feature branch needs no confirmation; never push to `staging`/`main` directly.
5. **Report** — what shipped, review/test outcomes, docs/ADRs touched, the PR link, the Human-review section mirrored verbatim, next unblocked task.

## Escalate — in every mode

Stop and ask the human when:

- a change would **deviate from `docs/architecture.md` or `docs/mvp-spec.md`** (locked at v0.3) — propose the deviation and an ADR before coding it;
- a **product or scope question** isn't settled by the spec, architecture doc, or task, and a wrong guess means real rework (choices with a sensible default: pick it, note it, move on);
- **prerequisites are missing** — credentials, env vars, an unmet `deps:` task;
- you're **not progressing** — ~3 review/test fix loops on the same issue; report what you tried;
- the task is **materially bigger** than its one-line scope implies — propose a split.
  Plus your standing defaults for anything destructive, irreversible, outward-facing, or security-sensitive. Make the ask the headline, give your recommendation, and wait.
