---
description: Apply a round of human review feedback (triage → fix → verify → report)
argument-hint: <feedback-file-or-pasted-feedback> [--branch=<name>]
---

Apply the review feedback in: **$ARGUMENTS**

Feedback is a numbered or free-form list of review comments from the human — typically `feedback.md` at the repo root (gitignored; never commit it), or pasted inline. Items may be change requests, standards to codify, or questions; handle all three.

The `/task` execution model applies: you do the work in this conversation, and `/task`'s escalation rules hold.

1. **Triage** — read every item. Classify: change request, standard to codify (→ `.claude/rules/engineering.md`, plus an ADR if architectural), or question (gets a written answer in the final report, plus a fix if the answer implies one). If an item needs a decision that is genuinely the human's — pattern choice, scope, where work lands — ask before planning, batched, with a recommendation. Sensible defaults you can own: pick, note, move on.
2. **Plan** — establish each item's current-state facts from the repo, not memory. Order the work, note which items are answered rather than coded, and flag any item that conflicts with another or with the locked docs.
3. **Execute** — work through the items; after each logical chunk run `pnpm typecheck && pnpm lint && pnpm test` and checkpoint-commit it.
4. **Review** — apply `/task` step 3 to the round's full diff: the risk-gated `evaluator` dispatch (bounded at two rounds) when the diff touches a risk surface, and a working-flow check only for what no automated test pins.
5. **Report** — the full gate stack runs **once, here** (`pnpm contract:check`, `pnpm --filter @picksleagues/web build`, `pnpm test:integration`, `pnpm test:e2e`), not per item and not again in step 4 — the round's diff is what merges, so one final pass over it is the proof; repeats just multiply the suites. Then: every feedback item → what shipped (commits) or the written answer; review findings and how each was resolved; anything flagged for you — pre-deploy checks, deferred work, pushback on an item. Don't push or update the PR unless asked.
