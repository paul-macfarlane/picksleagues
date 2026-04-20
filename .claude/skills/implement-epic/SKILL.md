---
description: Run an entire backlog epic end-to-end on a dedicated branch, with AI code review replacing per-story human review, and open a PR for manual testing. Use for larger autonomous runs; use /implement for single stories.
user_invocable: true
---

# /implement-epic — Autonomous Epic Workflow

Implements an entire backlog section (an "epic") on a dedicated branch and opens a PR when done. Based on [docs/WAYS_OF_WORKING_V2.md](../../../docs/WAYS_OF_WORKING_V2.md). Read that doc before this skill — it holds the rationale; this skill holds the procedure.

## Arguments

- `$ARGUMENTS` (optional): An epic identifier. One of:
  - A section number from `work/Backlog.md` (e.g., "3", "4")
  - A section slug (e.g., "leagues", "picks-and-scoring", "simulator")
  - A story ID within the epic (e.g., "PL-020" → maps to the Leagues section)
  - Omitted → pick the first section containing any `[ ]` stories whose upstream dependencies are complete.

## Pre-flight

Before Phase 1, verify:

- Working tree is clean (`git status`). If not, halt and ask.
- Current branch is `main` (or prompt to switch).
- No `[~]` or `[!]` stories in the target epic. If any exist, halt and ask.
- Upstream epics (all earlier sections in the backlog) are fully `[x]`. If not, halt and ask.

## Phase 1 — Epic Kickoff (human-assisted)

### 1.1 Resolve the epic

Read `work/Backlog.md`. Map `$ARGUMENTS` to a section. List the stories in the epic and the BUSINESS_SPEC sections they cite. Report this resolution to the user in one short message before proceeding.

### 1.2 Read all context (delegated)

Spawn an **Explore** subagent at `model: "haiku"` to gather context. Read targets:

- Every story's linked BUSINESS_SPEC section.
- Related ARCHITECTURE sections.
- Any existing code in the file areas the epic will touch.
- Prior task notes (`work/tasks/*.md`) for upstream work that this epic builds on.

Ask it to return a **structured digest**, not raw file contents, in this format:

```
## Per-story briefs
### PL-XXX — <title>
- BUSINESS_SPEC quotes (verbatim, only the rule-bearing bullets): ...
- Files likely to be touched: ...
- Existing patterns to follow: ...
- Ambiguities / edge cases to surface in the clarification round: ...

## Cross-cutting observations
- Shared schema touch-points: ...
- Shared lib modules / validators: ...
- Upstream task-note context: ...
```

The orchestrator plans off the digest, not the raw files — this keeps the parent context lean across the whole epic loop.

### 1.3 Clarification round

Consolidate **every** ambiguous question across all stories in the epic into a single message. Cover:

- Business rule edge cases not explicit in BUSINESS_SPEC.
- UX choice points that could go multiple ways.
- Cross-cutting approach decisions (e.g., how one lib module will be structured when used by 3 stories).
- Which stories, if any, should be split, merged, or dropped.

Wait for answers. Do not proceed until all questions are resolved.

**This is the only scheduled question round.** After it, don't ask again unless a halt condition fires.

### 1.4 Epic plan

Write the epic plan to the user (not to disk). Format:

```
## Epic: <name> (<N> stories)

### Stories
- PL-XXX — <title> — <one-line approach>
- ...

### Cross-cutting decisions
- <decision>: <rationale>

### Shared changes
- Schema: <tables>
- New lib modules: <paths>
- New validators: <paths>

### Known risks
- <risk>: <mitigation>

### Deviations from backlog
- <story ID>: <change and why>  (or "none")
```

Ask for explicit approval: "Approve this plan to start the autonomous loop? (yes / changes)".

## Phase 2 — Branch Setup

On plan approval:

1. `git checkout main && git pull origin main`
2. `git checkout -b epic/<slug>` — slug from the section name, kebab-case, no leading section number.
3. Mark all stories in the epic `[~]` in `work/Backlog.md`.
4. Commit: `chore(epic/<slug>): start epic — <name>`.

## Phase 3 — Autonomous Story Loop

For each story in dependency order, do all of the following without asking for human input (unless a halt condition fires):

### 3.1 Implement

Before writing code, spawn an **Explore** subagent at `model: "haiku"` with a per-story brief prompt:

> Read the BUSINESS_SPEC sections cited by PL-XXX and the current state of the files likely to be touched (use the epic digest from Phase 1.2 as a starting point). Return a structured brief: (1) exact rules to enforce, quoted verbatim; (2) current file layout in the target area; (3) closest existing pattern to mirror; (4) edge cases explicitly called out in the spec.

Implement against the brief. Follow layer order: schema → `data/` → `lib/` → `actions/` → `components/` → `app/` → tests. Respect every rule in `rules/*.md`. Use patterns in `docs/ARCHITECTURE.md`.

### 3.2 + 3.3 Review (parallel)

Run **`code-reviewer` and `spec-tracer` in parallel** — one message, two Agent tool calls. They review the same diff for different things.

**`code-reviewer`** at `model: "sonnet"`:

> Review the uncommitted changes against project rules. Story: PL-XXX (<title>). Scope: files changed since HEAD. Return blockers and non-blockers.

**`spec-tracer`** at `model: "haiku"` (skip entirely if the story cites no BUSINESS_SPEC sections):

> Verify the implementation of PL-XXX matches BUSINESS_SPEC sections <list>. Scope: files changed since HEAD. Flag any divergence.

Fix every **blocker** from either agent. Record **non-blockers** in the story's task notes under "Follow-ups" or "Notable / Gotchas". If a spec-tracer divergence looks like a spec bug rather than an implementation bug, **halt**.

### 3.4 Checks

Run `pnpm check`. If `format:check` fails, run `pnpm format` and re-run. If anything else fails, attempt one round of self-repair. If it still fails, **halt**.

### 3.5 Task notes (delegated)

Delegate to a **general-purpose** subagent at `model: "haiku"`. Give it: the story ID, the staged diff (`git diff --cached`), the story's backlog entry, the non-blocker findings from 3.2 that weren't fixed, and the template from `docs/WAYS_OF_WORKING.md §4`. Ask it to write `work/tasks/PL-XXX.md`. Terse; link commits rather than restating diffs.

### 3.6 Commit

Stage specific files (including the task notes file). Commit with the V1 message style:

```
<type>(PL-XXX): <short description>
```

Types: `feat`, `fix`, `refactor`, `docs`, `chore`, `test`. One commit per story. Do not push.

### 3.7 Mark done

Flip the story to `[x]` in `work/Backlog.md`. Include this change either in the story commit (preferred) or a follow-up `chore(epic/<slug>)` commit at epic end.

## Phase 4 — Epic Validation

After the last story:

1. Run `pnpm check` against the whole diff from `main`.
2. Invoke `code-reviewer` on the **full epic diff** (`git diff main...HEAD`). Keep the **default (parent) model** for this one — do not downgrade. Cross-story judgment is the main safety net and is worth the spend. Prompt:

   > Review the full epic diff for cross-story issues: duplicated logic, inconsistent patterns introduced across stories, helpers that should have been shared, regressions in adjacent code. Scope: `git diff main...HEAD`.

3. Fix any findings. If fixes are needed, commit as `chore(epic/<slug>): end-of-epic cleanup`.

## Phase 5 — Pull Request

1. `git push -u origin epic/<slug>`
2. Create the PR with `gh pr create`. Title: `Epic: <name>`. Body:

   ````markdown
   ## Summary

   <one paragraph: what this epic delivers and why it matters>

   ## Stories shipped

   - PL-XXX — <title> — `<sha>`
   - ...

   ## BUSINESS_SPEC coverage

   - §X.Y — <section title>
   - ...

   ## Manual test plan

   Written for a cold reader. Golden paths first, then regression checks for adjacent features.

   - [ ] <flow 1>
   - [ ] <flow 2>
   - [ ] Regression: <adjacent flow that could have been broken>

   ## Known limitations / follow-ups

   - <anything deferred, ambiguity resolved, or debt taken on>

   ## How to test locally

   ```bash
   git checkout epic/<slug>
   pnpm install
   pnpm dev
   ```
   ````

   ```

   ```

3. Report the PR URL and stop. Do not merge. Do not delete the branch.

## Halt protocol

When a halt condition fires (see WAYS_OF_WORKING_V2.md §7):

1. Stop the loop immediately.
2. Post a message to the user with:
   - What story was in progress.
   - Which halt condition fired.
   - What state the branch is in (commits made, files modified but uncommitted).
   - Suggested options for unblocking.
3. Do not roll back. Leave the branch and any uncommitted changes in place for human inspection.

## What this skill does NOT do

- Does not merge PRs.
- Does not squash commits.
- Does not push to `main`.
- Does not update `BUSINESS_SPEC.md` silently — that's a halt.
- Does not run in parallel across stories — one story at a time, committed, before the next starts.
- Does not skip the `code-reviewer` or `spec-tracer` agents to save time.
