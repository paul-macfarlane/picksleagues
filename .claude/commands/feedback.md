---
description: Apply a round of human review feedback via the three-tier pipeline (orchestrate → implement → evaluate → reconcile)
argument-hint: <feedback-file-or-pasted-feedback> [--branch=<name>]
---

Apply the review feedback in: **$ARGUMENTS**

Feedback is a numbered or free-form list of review comments from the human — typically a file like `feedback.md` at the repo root (never commit these files), or pasted inline. Items may be change requests, standards to codify, or questions; handle all three.

## Three-tier pipeline

You are the **orchestrator**: you triage, plan, dispatch, mediate, and report — you do not write feature code yourself (harness/docs prose and trivial one-line fixes are fair game). The **`implementer` subagent (Sonnet)** executes each well-specified slice. The **`evaluator` subagent (Opus)** adversarially reviews the result. You reconcile disagreements between the two and own the final outcome. The risk-weighted model overrides from `/task` apply here too: scoring/locking/settlement/override-precedence slices get an Opus implementer (or you), and their evaluation runs at the session model tier.

## Steps

1. **Triage** — read every item. Classify: change request, standard to codify (→ `.claude/rules/engineering.md` + ADR if architectural), or question (gets a written answer in the final report, plus a fix if the answer implies one). If an item needs a decision that is genuinely the human's (pattern choice, scope, where work lands), ask before planning — batched, with a recommendation. Sensible defaults you can own: pick, note, move on.
2. **Scout** — dispatch parallel `scout` agents (Sonnet; read-only) to gather the facts the plan needs (current call sites, duplication maps, coverage inventories). Don't plan from memory. A per-dispatch Haiku override is fine for purely mechanical sweeps.
3. **Plan** — write the plan to the session scratchpad: waves of work with **disjoint file surfaces** (parallel agents must not touch the same files — a concurrent `git mv` or edit bleeding into another agent's commit is a real failure mode), an item→wave map, per-wave gates (`pnpm typecheck && pnpm lint && pnpm test`), and which items are answered rather than coded.
4. **Execute** — per wave: dispatch `implementer` agents with complete specs (files, exact changes, constraints, gates — the agent sees only your prompt). Verify each result yourself (spot-read the diff, run gates), then checkpoint-commit the wave with explicit pathspecs (`git commit -- <paths>`, never bare `git commit` while agents run concurrently). Follow the repo git flow — no push unless asked.
5. **Evaluate** — dispatch the `evaluator` on the round's full diff against the feedback items and the plan. Its brief must include the commit range, the feedback file, focus areas (behavior-preserving claims, lock/visibility semantics, settlement purity, migrations, contract drift), and the plan path.
6. **Reconcile** — for each finding: confirmed → dispatch a fix to an `implementer`, then have the same evaluator re-verify (SendMessage to the same agent keeps its context); rejected → record your rationale and surface it to the human in the report — the human breaks ties. Loop until the evaluator's verdict is clean or every open finding has a recorded rejection.
7. **Report** — final gates first (full `pnpm build` + `pnpm test:e2e` on top of the per-wave gates), then: every feedback item → what shipped (commits) or the written answer; evaluator findings and how each was resolved (fixed / rejected + why); anything flagged for the human (pre-deploy checks, deferred work, pushback on an item). Append the round's item→resolution table (with commits/decisions) to the epic's file under `docs/feedback/` (named after the epic's backlog file; create it on an epic's first round — see `docs/feedback/README.md`) and commit it with the round — the log is the durable index; the report message is transient. Don't push or update the PR unless asked.
