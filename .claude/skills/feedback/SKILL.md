---
description: Apply a round of human review feedback (triage → fix → verify → log)
argument-hint: <feedback-file-or-pasted-feedback> [--branch=<name>]
---

Apply the review feedback in: **$ARGUMENTS**

Feedback is a numbered or free-form list of review comments from the human — typically a file like `feedback.md` at the repo root (never commit these files), or pasted inline. Items may be change requests, standards to codify, or questions; handle all three.

## Execution model

You apply the feedback yourself, in this conversation — the `/task` execution model applies here too. Delegate `implementer` agents only for parallel mechanical slices or to keep a large mechanical wave off the premium budget; never for scoring/locking/settlement/override-precedence changes. When agents run concurrently they must have **disjoint file surfaces** (a concurrent `git mv` or edit bleeding into another agent's commit is a real failure mode), and checkpoint commits use explicit pathspecs (`git commit -- <paths>`, never bare `git commit` while agents run).

## Steps

1. **Triage** — read every item. Classify: change request, standard to codify (→ `.claude/rules/engineering.md` + ADR if architectural), or question (gets a written answer in the final report, plus a fix if the answer implies one). If an item needs a decision that is genuinely the human's (pattern choice, scope, where work lands), ask before planning — batched, with a recommendation. Sensible defaults you can own: pick, note, move on.
2. **Plan** — establish the current-state facts each item depends on from the repo, not memory (read directly; fan out `scout` agents only for genuinely broad surveys). Order the work, note which items are answered rather than coded, and flag any item that conflicts with another or with the locked docs.
3. **Execute** — work through the items; after each logical chunk, run the gates (`pnpm typecheck && pnpm lint && pnpm test`) and checkpoint-commit it. Follow the repo git flow — no push unless asked.
4. **Review** — apply `/task` step 3 to the round's full diff: gates plus a working-flow check, and the risk-gated `evaluator` dispatch (briefed with the commit range, the feedback file, the plan, and focus areas) when the diff touches a risk surface — on demand otherwise. Confirmed findings → fix, then the same evaluator re-verifies; rejected findings → recorded rationale surfaced in the report.
5. **Report** — final gates first (`pnpm contract:check`, `pnpm --filter @picksleagues/web build` — the repo's only build script; there is no root `pnpm build` — and `pnpm test:e2e` on top of the per-chunk gates), then: every feedback item → what shipped (commits) or the written answer; review findings and how each was resolved (fixed / rejected + why); anything flagged for the human (pre-deploy checks, deferred work, pushback on an item). Append the round's item→resolution table (with commits/decisions) to the epic's file under `docs/feedback/` (named after the epic's backlog file; create it on an epic's first round — see `docs/feedback/README.md`) and commit it with the round — the log is the durable index; the report message is transient. Don't push or update the PR unless asked.
