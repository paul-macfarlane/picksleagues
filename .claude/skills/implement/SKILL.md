---
description: Pull a story from the backlog, implement it with self-review, and present for approval. The primary development workflow.
user_invocable: true
---

# /implement — Story Implementation Workflow

Implements a backlog story end-to-end following the project's ways of working.

## Arguments

- `$ARGUMENTS` (optional): A story ID (e.g., "PL-020") to work on a specific story. If omitted, picks the highest priority unstarted story.

## Workflow

### 1. Select Story

- Read `work/Backlog.md`
- If `$ARGUMENTS` is provided, find that story. Otherwise, find the first `[ ]` (pending) story in the file.
- Mark it `[~]` (in progress) in the backlog.

### 2. Understand Requirements

- Read the relevant section(s) of `docs/BUSINESS_SPEC.md` that the story traces to.
- Read any related existing code to understand current patterns.
- Identify edge cases explicitly called out in the spec.

### 3. Ask Clarifying Questions

If requirements are ambiguous or there are multiple valid approaches, ask the user before proceeding. Don't make assumptions about business behavior.

### 4. Plan Changes

- Enter plan mode.
- List files to create or modify.
- Verify the approach matches `docs/ARCHITECTURE.md` patterns.
- Present the plan for approval.

### 5. Implement

Follow layer order:

1. Schema / migrations (`lib/db/schema/`)
2. Data layer (`data/`)
3. Business logic (`lib/`)
4. Server Actions (`actions/`)
5. UI components (`components/`)
6. Pages (`app/`)
7. Tests (`*.test.ts`)

Reference rules in `rules/` throughout implementation.

### 6. Self-Review

Invoke the `/self-review` skill to check changes against project standards.

### 7. Automated Checks

Run all checks:

```bash
pnpm lint && pnpm typecheck && pnpm test
```

Fix any issues found.

### 8. Present to User

Provide a summary:

- What was implemented and which BUSINESS_SPEC sections it covers
- Files created or modified
- Decisions or trade-offs made
- Anything uncertain or needing a second opinion

### 9. Await Approval

**Do not commit until the user approves.** If changes are requested, make them and re-run steps 6-7.

### 10. Commit and Push

Once approved:

```bash
git add <specific files>
git commit -m "<descriptive message>"
git push origin main
```

Mark the story `[x]` (complete) in `work/Backlog.md`.
