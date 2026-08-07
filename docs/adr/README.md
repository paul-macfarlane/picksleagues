# Architecture Decision Records

Short documents capturing a significant technical/architectural decision, its context, and consequences. New records use `template.md`, numbered sequentially (`NNNN-kebab-title.md`). Once merged, an ADR is immutable — supersede it with a new one rather than editing (link both ways).

Create one with `/adr <title>` whenever a choice is non-obvious, hard to reverse, or contradicts an existing decision. If a decision changes `docs/architecture.md` or `docs/mvp-spec.md`, update that doc too and reference the ADR — the two docs must stay reconciled with each other.

Pre-baseline alternatives analysis lives in the architecture doc's own decision log (D1–D15); ADRs pick up from there.

## Index

| #                                             | Title                                | Status   |
| --------------------------------------------- | ------------------------------------ | -------- |
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions        | Accepted |
| [0002](0002-baseline-architecture-v0-3.md)    | Adopt architecture v0.3 as baseline  | Accepted |
| [0003](0003-migrations-via-github-actions.md) | Deployed-DB migrations via GH Actions | Accepted |
| [0004](0004-multi-commissioner-leagues.md)    | Multi-commissioner leagues; no mid-season leaving | Accepted |
| [0005](0005-tanstack-form.md)                 | TanStack Form for SPA forms          | Accepted |
| [0006](0006-minted-session-e2e.md)            | Minted-session E2E ahead of the simulator | Accepted |
| [0007](0007-game-data-ingestion-model.md)     | Game-data ingestion model            | Accepted |
| [0008](0008-league-season-binding.md)         | Leagues bind to a sport season; start derived from games | Accepted (amended by 0009) |
| [0009](0009-multi-season-leagues.md)          | Leagues span seasons via `league_seasons` instances | Accepted |
| [0010](0010-normalized-teams.md)              | Teams are normalized reference data  | Accepted (amended by 0021) |
| [0011](0011-simulator-admin-ops-merge.md)     | Simulator & admin ops merge; UI-driven sim, admin-session auth | Accepted |
| [0012](0012-simulated-provider-clock-projection.md) | Simulated data flows through real ingestion; fixtures project through the clock | Accepted |
| [0013](0013-admin-role-in-database.md)        | Admin capability lives in `users.app_role` | Accepted |
| [0014](0014-sim-enabled-env-toggle.md)        | `SIM_ENABLED` toggles the simulator; production overrides it | Accepted |
| [0015](0015-pickem-pick-entry-semantics.md)   | Pick'em pick entry: whole-week replace, unplayable games unpickable, settings change resets picks | Accepted (rules 1–2 superseded in part by 0018/0019; rule 3 stands) |
| [0016](0016-per-mode-result-and-standings-tables.md) | Results/standings are per-mode; mode-scoped naming repo-wide | Accepted |
| [0017](0017-pickem-pick-uniqueness-is-per-week.md) | Pick'em pick uniqueness is per week, not per season | Accepted (motivation superseded by 0018; constraint stands) |
| [0018](0018-pickem-atomic-immutable-weekly-submission.md) | A Pick'em week is one atomic, immutable submission | Accepted |
| [0019](0019-week-moves-out-of-scope.md)       | Week moves out of scope; an admin `cancelled` override covers the real case | Accepted |
| [0020](0020-season-range-presets.md)          | Season-range presets replace explicit Start Week / End Week | Accepted (amended by 0021) |
| [0021](0021-unseeded-playoff-games-excluded-at-ingestion.md) | Unseeded playoff games are excluded at ingestion | Accepted |
| [0022](0022-member-set-avatar-url.md)         | Member-set avatar is an `https:` URL in an `image_override` column | Accepted |
| [0023](0023-survivor-is-the-mode-name.md)     | Game Mode 2 is named Survivor, not Elimination | Accepted |
| [0024](0024-survivor-settings-carry-a-resolved-range.md) | Survivor settings carry a resolved season range, not a chosen one | Accepted |
| [0025](0025-survivor-team-ledger-and-prefix-ordered-settlement.md) | Survivor team consumption is a partial unique index over a settlement-owned `released` flag; settlement is prefix-ordered | Accepted |
