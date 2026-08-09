# Atlas experiment (concluded)

Ran [`atlas-v3`](https://github.com/JahnelGroup/atlas-plugin-v3) as this repo's development harness in place of `/task`, 2026-08-03 → 2026-08-09, to find out whether it was a net improvement for a solo, single-repo project. **Reverted 2026-08-09.** The full setup record is in git history at `docs/atlas-experiment.md` before that date; what follows is what's worth keeping.

## Why it was reverted

- **Self-review replaced the risk-gated fresh-context `evaluator`** on exactly the surfaces this repo's bugs live on — scoring, locking, settlement, override precedence. Atlas requires the orchestrating context to perform the single formal review itself and forbids delegating the accept/reject judgment. That is a weaker check than an independent context, and it was the named risk going in.
- **Nothing covered the craft pass.** Atlas reviews correctness and standards conformity, not duplication, accretion, or idiom drift.
- **The multi-repo/policy apparatus cost more than it returned** on a single-repo solo project: a router/policy layer in `CLAUDE.md` plus seven generated `docs/agents/*` documents that restated conventions already having homes.

## What it permanently improved

The `/verify` skill became a doc (`docs/runbooks/verification.md`) rather than a skill, so commands are cited from one place. The restored harness also kept four amendments the experiment motivated: a mandatory clarify gate for feature work, a tests-land-with-behavior bar, a `## Human review` section in every PR body, and `/worktree` for parallel sessions.

Committed technical plans (`docs/plans/`) and a committed evidence root (`docs/evidence/`) also came out of it, and both were removed in the 2026-08-09 harness trim — the PR body holds what they held, and neither survived the question "would you read this again?"

## The defect pattern worth remembering

Two of the five defects found in the scaffold's output were the same failure: **an abstract configured value lost to a concrete unconditional instruction elsewhere in the same generated document.** The lifecycle config named four backlog states; a hardcoded instruction five lines below emitted seven. Plan storage was configured as `repository`; an unconditional instruction told the planner to write into the ticket, so it did — taking one epic file from 63 lines to 460.

The generalization: **a setting that renders as a bare noun with no mechanism attached should be treated as not yet configured.** Whichever instruction carries a concrete mechanism is the one that gets followed. This applies to any generated or templated guidance, not just Atlas.
