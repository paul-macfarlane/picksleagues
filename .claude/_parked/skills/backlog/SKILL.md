---
description: Show backlog status across epics and the next runnable task
argument-hint: [epic-prefix]
---

Report backlog status$ARGUMENTS.

- Read the epic files in `backlog/` (all of them, or just the one matching a prefix argument like `PKM`).
- For each epic, show counts: done `[x]`, in-progress `[~]`, blocked `[!]`, todo `[ ]`.
- List in-progress and blocked items explicitly (with why they're blocked, from `deps:`).
- Identify the **next runnable task**: the first `[ ]` whose `deps:` are all `[x]`, walking epics in the order given by **`backlog/README.md` §Build order** (not the order the files sort in — file numbers are historical).
- Report status grouped by that same order, so the summary reads as the plan rather than as the filesystem.
- Keep it a scannable summary, not a dump of every task. End with: run `/task next` to start the next one.
