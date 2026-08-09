---
description: Run a backlog task through the implementation pipeline (clarify → execute → test & review → share)
argument-hint: <task-id | next | epic-prefix> [--plan|--no-plan] [--test=auto|manual|skip]
---

Run the implementation pipeline for: **$ARGUMENTS**

A "task" may be one backlog item, several related items, or a whole epic — scope it from the argument.

## Target & setup

- **Target:** `next` = the first available task in build order per `backlog/README.md`. A task ID (e.g. `PKM-3`) = that item. An epic prefix (e.g. `PKM`) = that epic's open tasks in order. Nothing runnable → say so and stop.
- Mark the task `[~]` and state the resolved target in one line.
- **Branch first:** create `feat/<task-id-or-epic-slug>` off `staging` before touching code. If the tree has unrelated uncommitted changes, ask before proceeding.

You implement directly — planning, coding, and verification stay in this conversation with full context. `Explore` is available for genuinely broad surveys; a question one or two files can answer, read directly. Never hand `packages/scoring`, lock/visibility semantics, settlement, or override precedence to a subagent: this repo's bugs live there.

**Rule of three.** If the work would create a third copy of anything — a constant, a guard block, a response descriptor, a test fixture — extract it to a shared home first.

## 1. Clarify

**Mandatory for work touching user-visible behavior or a `docs/mvp-spec.md` section.** After reading the task and its doc sections, ask the batched requirement and edge-case questions via the native question dialog, each with a recommended answer, and wait. Purely mechanical work (refactors, tooling, dep bumps) proceeds without stopping — say so. For feature work, "no questions" is itself a claim: state what makes the contract complete enough to skip.

## 2. Execute

Know the plan before coding, at the weight the task deserves — a few sentences for a contained change; files, approach, applicable `docs/mvp-spec.md` / `docs/architecture.md` §sections, and any decision needing an ADR for multi-file or risk-surface work. Verify current-state facts from the repo, not memory. Planning happens here, in conversation; nothing is written to a plan file. `--plan` presents the plan and waits for approval (default off).

Then implement, following `.claude/rules/engineering.md` and the architecture doc. Contract changes regenerate `openapi/` in the same commit.

## 3. Test & review

**Tests land with the behavior:** new or changed behavior gets an automated test at the cheapest layer that can pin it (the testing ladder in `.claude/rules/engineering.md`). Driving the simulator by hand is the proof of last resort, for what no layer can pin — visual layout, third-party behavior.

Then: `pnpm typecheck && pnpm lint && pnpm test` scoped to what you touched, plus demonstrating the affected flow works — prefer the simulator; mechanics in `docs/runbooks/verification.md`. `pnpm test:integration` and `pnpm test:e2e` share databases and ports, so they run one at a time.

Review by risk:

- **Risk-gated independent review:** if the diff touches `packages/scoring`, lock/visibility semantics, settlement/recompute, override precedence, or a migration, dispatch the `evaluator` (fresh context) briefed with the diff, the plan, the acceptance criteria, and two standing checks: **the unhandled-error/observability path** (service throws → logged JSON 500; framework 4xx refusals pass through) and **boundary instants** for anything clock-derived. Confirmed findings get fixed and re-verified by the same evaluator via `SendMessage`; rejected findings get a recorded rationale.
- **Everything else:** self-review the full diff against the plan and `.claude/rules/engineering.md`. `/code-review` (bugs) and `/simplify` (reuse, dedup, altitude) are available on demand; run both over the full diff for epic-scale work or any run of 3+ tasks, where cross-task duplication accumulates.
- In `--test=manual`, describe what to test and wait for the result. `--test=skip` only when there is no runtime surface.

## 4. Share

Docs updated if behavior or architecture changed, non-obvious decisions recorded via `/adr`, task marked `[x]`. Commit to the feature branch (conventional-prefix messages, logically grouped), push, and open a PR targeting `staging` with `gh pr create` — summary, task IDs, test and review outcomes.

**The PR body ends with a `## Human review` section** — three subsections, each written even when the answer is "none":

- **Decisions made without asking** — choices the docs didn't settle, one-line rationale each.
- **Judgment surfaces** — UX, layout, copy, and visual choices automation can't validate.
- **Not provable by automation** — anything whose proof needs prod config, real ESPN behavior, or eyes on a screen.

Then report: what shipped, review and test outcomes, docs/ADRs touched, the PR link, the Human-review section mirrored verbatim, and the next unblocked task. Pushing a feature branch needs no confirmation; never push to `staging`/`main` directly.

## Escalate — in every mode

Stop and ask when:

- a change would **deviate from `docs/architecture.md` or `docs/mvp-spec.md`** (locked at v0.3) — propose the deviation and an ADR before coding it;
- a **product or scope question** isn't settled by the spec, architecture doc, or task, and a wrong guess means real rework (choices with a sensible default: pick it, note it, move on);
- **prerequisites are missing** — credentials, env vars, an unmet `deps:` task;
- you're **not progressing** — ~3 review/test fix loops on the same issue; report what you tried;
- the task is **materially bigger** than its one-line scope implies — propose a split.

Make the ask the headline, give your recommendation, and wait.
