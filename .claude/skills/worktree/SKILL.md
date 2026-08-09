---
description: Bootstrap a sibling git worktree so a second session can work in parallel (branch, env files, install)
argument-hint: <task-id | branch-name>
---

Create a parallel-session worktree for: **$ARGUMENTS**

1. **Resolve the branch:** an existing branch name is used as-is; a task ID becomes `feat/<task-id-slug>` cut from `staging`.
2. **Create the worktree as a sibling**, never inside the repo: `git worktree add ../picksleagues-<slug> <branch>` (with `-b` when cutting fresh).
3. **Copy every gitignored env file the stack reads** from the main checkout into the same relative paths — root `.env*` and any `apps/*/.env*` present. This is the load-bearing step: a worktree without them fails silently, `pnpm test:e2e` in particular.
4. **Install:** run `pnpm install` in the worktree (the store is shared, so this is fast).
5. **Report:** print the worktree path and the reminders that travel with it — open the new Claude Code session in that directory; heavy suites (`test:integration`, `test:e2e`) are one-at-a-time across sessions; the dev database on :5433 is shared state.

After the branch merges, clean up from the main checkout: `git worktree remove ../picksleagues-<slug>`.
