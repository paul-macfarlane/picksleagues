# SIMP-13 — Pick'em regression runbook rewritten against shipped behavior

Work package `simp-pr3`, deliverable D4. Commit `1df91b0` on
`feat/simp-pr3-presets-and-closeout`.

_Placed by the frontier orchestrator: the worker's harness refused its own file write and
it reported that rather than routing around the refusal. The scenario-registry and log-line
checks below were re-run by the orchestrator against the code, not taken on report._

## What this criterion is proved by

The plan's verification map calls for a **read-through against shipped behavior**, not a
command. This document changes no code, so no gate can prove it; what proves it is that
every remaining assertion traces to something in the repository, and that nothing it tells
an operator to load or look for is missing.

## Checks run by the orchestrator

| Check | Result |
|---|---|
| Every pass checkbox reset to unrun | 46 `[ ]`, **0** `[X]` |
| No pass references a deleted flow | Every surviving mention of `substitute`, `re-pricing`, `accept-latest`, `week move`, `push/tie`, or `differential` is an explicit *"this no longer exists"* statement, not an instruction |
| Scenario slugs exist in `SIM_SCENARIO_LIBRARY` | `mixed-week`, `push-ats`, `tie-game`, `cancelled-game`, `postponed-game` — all present. `week-move` is gone from the registry and named nowhere in the document |
| The operator note's detection surfaces are real | `logInfo("nfl-sync-schedule.week-move", { providerGameId })` at `apps/api/src/services/nfl/ingest-season.ts:417`; the `weekMoves` counter at `:214/:344/:416/:534`, surfaced through `sync-schedule.ts:172` into the job response. Both exist as described |
| `pnpm format` | exit 0, tree clean afterward |

That last row is the one that mattered most: an operator note telling someone to watch for
a log line that does not exist would be the same class of failure this ticket was written
to fix.

## What was cut

The whole week-move pass; the substitute control, its trade-confirm dialog, its
eligible-target picker, and the "declining leaves the push standing" step; re-pricing, the
accept-latest-spreads bar, the per-row *"Line moved to −6 — your pick holds −3.5"*, the
week-wide moved-lines count, and the toggle-off-and-on note; "0.5 **on the default
push/tie setting**"; "Standings differential: the push contributes 0"; Pass 4's *"No
substitute is offered (this is the difference from Pass 3)"* contrast; "re-pick within the
new cap"; the `standings-repick.test.ts` row from the automation table (that file is
deleted); and the header's stale "six of the seven scenarios" claim.

## What was added

A new first pass covering confirm-and-freeze, deliberately weighted to the branches the
merge-gate e2e does **not** take — the cancel path, a second tab hitting
`already_submitted` and flipping itself read-only, and a kickoff landing mid-sheet and
shrinking the required set. The ADR-0019 operator note, placed between Setup and Pass 1
with three concrete detection surfaces, the one-override remedy, and a drivable rehearsal.
Preset framing in Setup and Pass 7. The either-direction Picks-per-week invalidation rule
with the reason it changed. Pass 4's immediate-settlement assertion. A re-derived
automation table.

## Deviation

One extra file: `docs/simulator-guide.md` lost a parenthetical warning that this runbook
named a deleted scenario. That sentence became false at this commit, and leaving a
document asserting the runbook is broken was judged worse than a one-sentence scope
overrun. Accepted.

## Known limits, stated not hidden

- **Nobody drove the eight passes against a running stack.** Every assertion is traced to
  code, which is weaker than an observed run. This is the same standing that any manual
  runbook has the day it is written, and the checkboxes are `[ ]` precisely to say so.
- Pass 2's `covered by 8` / `short by 7` and its `1.5` / `1-1-1` totals are computed from
  the `push-ats` fixture and the scoring rules rather than observed. They are stated
  precisely on purpose, so a wrong number fails loudly on the first real pass.
