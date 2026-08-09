# Technical plans

One file per work package: `docs/plans/<work-package-id>.md`, lowercased —
`simp.md` for an epic, `simp-3.md` for a single ticket.

A plan is written when the work is **epic-scale** or **about to run in parallel
with another session** (`/task` step 1) — for parallel work it doubles as the
file-surface declaration the claim-time conflict check reads. Contained
single-task work plans in-conversation and writes nothing here.

The matching `backlog/` epic file gets a `## Technical plan` pointer and nothing
else.

## Why plans are not inlined in epic files

`backlog/` epic files are a thin contract: one goal-shaped line per ticket,
pointing at the `docs/mvp-spec.md` / `docs/architecture.md` section that defines
the behavior. That thinness is deliberate — it is what keeps the ticket list
readable and what stops doc mechanics from being restated where they will drift.
A 400-line technical plan inlined among the tickets destroys it: the first plan
written this way took `12-simplification.md` from 63 lines to 460.

## Lifecycle

A plan stays in the repo after the work merges: it is the record of what was
decided and why. Plans are not cleared between work packages, and neither is the
evidence root — it is scoped per work package instead (`docs/evidence/README.md`).

Files here from the 2026-08 Atlas experiment (`docs/atlas-experiment.md`) carry
its record vocabulary (`[EXECUTION PLAN]`, `[PROGRESS]`, `[CLOSEOUT]`, …); they
are historical records and are left as written.
