# 0050. Aggregate scoring reconciliation

- **Status:** Accepted
- **Date:** 2026-09-14
- **Related:** AGENT-2; ADR-0049; architecture.md D10, §Settlement & Scoring and §Engineering agent diagnostics (inventory extended); mvp-spec.md §Game Modes 1–2; [owner-approved scope](https://app.notion.com/p/3dbc4dbb62178176bb3fd91928e2e466)

## Context

Stored result points and standings can agree while both are wrong. The owner requested deeper diagnostic checks with aggregate responses and no automatic repairs.

## Decision

Add a separate GET reconciliation operation for one known league-season UUID. Inside a read-only repeatable-read transaction, recompute Pick’em outcomes and weekly/season standings using the existing pure scoring functions; reuse Survivor’s settlement replay and release-flag derivation. Only aggregate missing, unexpected and differing record counts leave the service. Unlike the SQL-only consistency endpoint, this operation temporarily loads scoring inputs and technical member/pick references into server memory; no identities, raw picks or per-member outcomes enter responses or logs. Survivor replay returns warning data for the writing caller to log; reconciliation emits only the existing bounded request audit.

## Consequences

Reconciliation detects drift from the current rules and cached game data, including corrected results, but cannot independently establish that the shared scoring implementation or cached provider data is correct. Missing rows can mean normal settlement lag or a season not yet rebuilt. The existing lightweight diagnostics remain unchanged; reconciliation is an on-demand whole-season operation whose cost grows with that season’s picks and members. No provider calls, persistence, migrations, automatic monitoring or repair permission are added. Repair design is a separate specification task, AGENT-3. Member-facing rules remain unchanged; the architecture diagnostic inventory is extended.
