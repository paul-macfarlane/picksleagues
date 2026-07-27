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
| [0010](0010-normalized-teams.md)              | Teams are normalized reference data  | Accepted |
| [0011](0011-simulator-admin-ops-merge.md)     | Simulator & admin ops merge; UI-driven sim, admin-session auth | Accepted |
| [0012](0012-simulated-provider-clock-projection.md) | Simulated data flows through real ingestion; fixtures project through the clock | Accepted |
| [0013](0013-admin-role-in-database.md)        | Admin capability lives in `users.app_role` | Accepted |
| [0014](0014-sim-enabled-env-toggle.md)        | `SIM_ENABLED` toggles the simulator; production overrides it | Accepted |
| [0015](0015-pickem-pick-entry-semantics.md)   | Pick'em pick entry: whole-week replace, unplayable games unpickable, settings change resets picks | Accepted |
