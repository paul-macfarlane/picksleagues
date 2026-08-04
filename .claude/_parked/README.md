# Parked harness (Atlas experiment)

Nothing in this directory is loaded by Claude Code — skills load from `.claude/skills/*/SKILL.md` and agents from `.claude/agents/*.md`, and this is neither. Files are parked here rather than deleted so the experiment is one `git mv` away from reversal.

These pieces were parked because [`atlas-v3`](https://github.com/JahnelGroup/atlas-plugin-v3) covers the same ground. See `docs/atlas-experiment.md` for the full rationale, the setup brief, and the rollback procedure.

| Parked | Atlas replacement | Why |
| --- | --- | --- |
| `skills/task` | `/atlas-implement` (+ optional `/atlas-plan`) | Same pipeline: plan → implement → verify → close out. Atlas adds a resume-safe state file and an explicit AC-level verification map. |
| `skills/backlog` | `docs/agents/issue-tracker.md` | Atlas treats local Markdown as a tracker. The `backlog/` conventions (stable IDs, `[ ]`/`[~]`/`[x]`/`[!]`, `deps:`, the build order in `backlog/README.md`) become that doc's configured availability and transition rules. |
| `skills/feedback` | `/atlas-implement` on a spec | A feedback round is a work package whose stable contract is the feedback file. |
| `skills/simplify` | *(nothing)* | Atlas has no craft/dedup pass. **This is a known coverage gap** — see the experiment doc's "what Atlas does not cover". |
| `skills/verify` | `docs/agents/verification-runbook.md` + generated `docs/agents/testing.md` | Content was moved, not lost. Atlas workers receive exact commands in their execution packet rather than invoking a skill. |
| `agents/implementer` | `atlas-worker` | Same role: one bounded deliverable from a complete spec, isolated context. |
| `agents/evaluator` | *(nothing — deliberate)* | Atlas requires the orchestrator to perform the single formal code review itself and forbids delegating the accept/reject judgment (`atlas-implement/SKILL.md`). **This is the sharpest doctrinal difference** and the main thing the experiment should be judged on: it removes the fresh-context adversarial review from `packages/scoring`, locking, settlement, and override-precedence diffs. |

## Still active, deliberately

`skills/adr`, `skills/ask`, `agents/scout`, `rules/engineering.md`, `hooks/guard-destructive.sh` — none has an Atlas equivalent, and `rules/engineering.md` is exactly the coding-standards document Atlas's code-review axis 2 reads.

## Restore

```sh
git mv .claude/_parked/skills/* .claude/skills/
git mv .claude/_parked/agents/* .claude/agents/
```

Or discard the whole experiment: `git checkout staging && git branch -D chore/atlas-experiment`.
