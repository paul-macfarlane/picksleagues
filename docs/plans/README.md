# Technical plans

One file per work package: `docs/plans/<work-package-id>.md`, lowercased —
`simp.md` for an epic, `simp-3.md` for a single ticket.

A plan holds the `[EXECUTION PLAN]` and, as work proceeds, the `[PROGRESS]`,
`[SCOPE CHANGE]`, `[BLOCKED]`, `[AI CODE REVIEW]`, and `[CLOSEOUT]` records.
The matching `backlog/` epic file gets a `## Technical plan` pointer and nothing
else.

## Why plans are not inlined in epic files

`backlog/` epic files are a thin contract: one goal-shaped line per ticket,
pointing at the `docs/mvp-spec.md` / `docs/architecture.md` section that defines
the behavior. That thinness is deliberate — it is what keeps the ticket list
readable and what stops doc mechanics from being restated where they will drift.
A 400-line technical plan inlined among the tickets destroys it: the first plan
written this way took `12-simplification.md` from 63 lines to 460.

The rule needs stating explicitly because the tracker here **is** markdown in
this repository, so "repository storage" and "tracker storage" would otherwise
name the same physical medium and carry no instruction at all. `docs/agents/`
guidance that says only "storage: repository" is under-specified; the normative
path is in `docs/agents/issue-tracker.md` §Planning artifact storage.

## Lifecycle

A plan is written before implementation and **drafts require owner approval**
(`docs/agents/planning.md`). It stays in the repo after the work merges: it is
the record of what was decided and why, and `/atlas-improve` reads it when
auditing a finished run. Plans are not cleared between work packages, and as of 2026-08-07 neither is the
evidence root — it is scoped per work package instead
(`docs/agents/testing.md` §Evidence policy).
