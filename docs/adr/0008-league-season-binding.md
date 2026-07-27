# 0008. Leagues bind to a sport season; league start is derived from its games

- **Status:** Accepted — amended by ADR-0009 (leagues now bind per season via `league_seasons`; the `leagueStartAt` derivation carries over per instance)
- **Date:** 2026-07-22
- **Related:** mvp-spec.md §Membership (join cutoff), §Commissioner Powers (pre/post-start windows); architecture.md §Domain Model, §Locking Model, D11, D15; backlog LG-1, LG-2, LG-4, LG-6

## Context

The spec derives the join cutoff and every commissioner power window from a single boundary — "the league's first week has started" (NFL modes) or "the first Round of 64 game has tipped" (March Madness) — and the architecture mandates that this boundary be computed from game timestamps + the injected Clock, never stored (D11). But the v0.3 domain-model sketch gave `leagues` no link to the sports data: without knowing *which* season's week 5 a Pick'em league starts in, the boundary is uncomputable. Storing a start timestamp on the league would violate the derive-don't-store rule and go stale when schedules move.

## Decision

- `leagues.season_id` is a required FK to `sport_seasons` (`ON DELETE RESTRICT`). Creation binds the league to the **latest ingested season** for the mode's sport (NFL for Pick'em/Elimination, NCAAMB for March Madness); creation fails with 409 `no_active_season` when that sport has no season yet.
- One shared derivation, `leagueStartAt` (`apps/api/src/services/leagues.ts`): NFL modes take MIN(kickoff) over games in the settings' start week; March Madness takes MIN(kickoff) over the season's games in weeks ≥ 2, treating week 1 as the First Four (placeholder until epic 07 fixes the NCAAMB week model — MM leagues cannot exist before NCAAMB ingestion anyway). Kickoffs resolve `override_kickoff_at ?? kickoff_at` (D15): a corrected kickoff must move the lock boundary, exactly as it does for pick locking.
- **No games ingested for the start week ⇒ pre-start.** Joins stay open and pre-start powers stay available until a real kickoff exists to pass.

## Consequences

- Join cutoff, pre/post-start windows, and discovery's pre-cutoff filter all read one function; a schedule move or admin kickoff correction shifts every boundary consistently with zero stored state.
- The derivation costs one small query per league per read — acceptable at ≤50-user scale; a batch join is a later optimization if dashboards grow.
- Season deletion is blocked while leagues reference it (RESTRICT) — reference data with dependents can't be swept by a bad sync.
- Revisit the MM week-≥-2 placeholder when epic 07 lands the real NCAAMB week model; the architecture doc's Domain Model comment for `leagues` now records the season FK.
