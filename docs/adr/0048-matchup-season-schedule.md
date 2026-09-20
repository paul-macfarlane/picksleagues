# 0048. Matchup results become the available season schedule

- **Status:** Accepted
- **Date:** 2026-09-13
- **Related:** [mvp-spec.md §Screens](../mvp-spec.md#screens-mvp-inventory) (amended here), architecture.md D6–D7, ADR-0040, STAT-9; Notion task “PicksLeagues: Show Schedule for Elimination”

## Context

Survivor members need future opponents to plan which teams to use later. The shared matchup sheet's Results segment only showed started games, so its prior-season fallback hid an already-ingested upcoming season.

## Decision

Replace Results with Schedule in the shared NFL matchup sheet and replace its read contract with `/games/{gameId}/nfl-schedule`. Serve each team's available games in kickoff order, including scheduled, live, final, postponed, and cancelled fixtures. Prefer the current season whenever it has ingested games; otherwise label the prior-season fallback. Preserve scores, final W/L/T, and the newest stored update among the displayed games. No new ingestion or database migration is needed.

## Consequences

Pick'em and Survivor share the feature. Missing fixtures are never invented. A bye row is derived only when a complete modern regular-season schedule proves it: 17 games occupy 17 distinct Weeks 1–18, leaving exactly one week absent. Partial or ambiguous schedules still show only stored fixtures. Two-line upcoming rows keep opponents legible at phone width; completed scores label both teams. The basic and advanced stats tiers retain their existing prior-season policy. API and generated client ship together; this is a replacement for the internal SPA contract, not a second results API to maintain.
