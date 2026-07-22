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
