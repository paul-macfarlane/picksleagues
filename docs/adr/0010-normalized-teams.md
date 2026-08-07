# 0010. Teams are normalized reference data, not text columns on games

- **Status:** Accepted — amended by ADR-0021 (placeholder "TBD" teams no longer ingest at all; the partial unique index below stays, because it also covers provider-id-less bootstrap rows)
- **Date:** 2026-07-23
- **Related:** architecture.md §Domain Model, §Game Data (D15); mvp-spec.md §Elimination (unique team per member), §March Madness; backlog SF-4, epics 06–07

## Context

`games` currently embeds teams as four text columns (`home_team_abbr/name`,
`away_team_abbr/name`) copied from ESPN on every sync. That was fine for Pick'em
display, but two upcoming rules need a stable team *identity*: elimination's
"unique team per member per league" constraint (a DB constraint needs a key, not a
display string that ESPN could restyle), and March Madness seeding/bracket slots.
Duplicated text also can't carry team assets (logos, colors) without repeating them
on every game row.

## Decision

- New **`teams`** table: `sport`, `provider_team_id` (unique per provider), `name`,
  `abbreviation`, room for display assets later. Ingestion upserts teams the same way
  it upserts seasons — the schedule sync owns reference-data creation; recurring syncs
  update, never fork.
- `games` gains `home_team_id` / `away_team_id` FKs (`ON DELETE RESTRICT`); the four
  text columns are backfilled into `teams` rows, then dropped. Serializers join teams
  for display.
- Elimination's unique-team constraint (epic 06) targets `teams.id` scoped to a
  `league_seasons` instance (ADR-0009). Tournament-specific data (seeds, regions) is
  **per season per team** and lands with epic 07 (`team_seasons` or bracket-slot rows) —
  deliberately out of scope here.
- Provider shapes still never leak (engineering rules): ESPN team payloads are mapped
  inside the adapter; everything else sees `teams` rows.
- Amendment (SF-4 live-verification finding): the `(sport, abbreviation)` bootstrap key
  is a **partial** unique index (rows with `provider_team_id IS NULL` only) — ESPN ships
  placeholder "TBD" teams for undetermined playoff matchups as distinct provider ids
  sharing one abbreviation, so a full unique across all rows rejects legitimate data.

## Consequences

- One more join on game reads — trivial at this scale, and it removes four columns of
  duplicated text per game row.
- ESPN renaming/rebranding a team is one row update, not a re-sync of every game.
- Backfill must run before epic 06's constraint work (backlog SF-4 blocks 06, and
  practically lands with the SF mini-epic before 05).
