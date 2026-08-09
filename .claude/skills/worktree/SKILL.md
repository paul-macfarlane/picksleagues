---
description: Bootstrap a sibling git worktree so a second session can work in parallel (branch, env files, install)
argument-hint: <task-id | branch-name>
---

Create a parallel-session worktree for: **$ARGUMENTS**

1. **Resolve the branch:** an existing branch name is used as-is; a task ID becomes `feat/<task-id-slug>` cut from `staging`.
2. **Create it as a sibling**, never inside the repo: `git worktree add ../picksleagues-<slug> <branch>` (with `-b` when cutting fresh).
3. **Copy every gitignored env file the stack reads** into the same relative paths — root `.env*` and any `apps/*/.env*`. This is the load-bearing step and the whole reason this skill exists: a worktree without them fails silently, `pnpm test:e2e` first.
4. **Install:** `pnpm install` in the worktree (the store is shared, so it's fast).
5. **Report** the path, and the one constraint that travels with it: the dev database on :5433 and the integration/e2e suites are shared state, so run heavy suites one session at a time.

After the branch merges: `git worktree remove ../picksleagues-<slug>` from the main checkout.
