# Worktree workflow

Arguments: `<task-id | branch-name>`. Use the values supplied in the user’s request.

Create a parallel-session worktree for: **the request arguments**

1. **Resolve the branch:** an existing branch name is used as-is; a task ID becomes `codex/<task-id-slug>` in Codex or `feat/<task-id-slug>` otherwise cut from `staging`.
2. **Create it as a sibling**, never inside the repo: `git worktree add ../picksleagues-<slug> <branch>` (with `-b` when cutting fresh).
3. **Environment setup:** do not read or copy live secret files. Copy tracked `.example`/`.template` files to the corresponding paths if needed and ask the human to populate live values out of band. Report environment setup as pending until supplied; a bare worktree omits the ignored env files required by the stack. Continue independent setup while waiting.
4. **Install:** `pnpm install` in the worktree (the store is shared, so it's fast).
5. **Report** the path, and the one constraint that travels with it: the dev database on :5433 and the integration/e2e suites are shared state, so run heavy suites one session at a time.

After the branch merges, request confirmation before removing the worktree: `git worktree remove ../picksleagues-<slug>` from the main checkout.
