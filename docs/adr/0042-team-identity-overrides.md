# 0042. Team identity gets override parallels, resolved in one serialization home

- **Status:** Accepted
- **Date:** 2026-08-14
- **Related:** architecture.md §Manual Sports Data Overrides / D15 (§Admin role wording updated), backlog STAT-8, [0041](0041-stats-overrides-outlive-resync.md)

## Context

`teams` was the last provider-synced table members see with no correction
path: the architecture's admin section called the teams browser read-only,
so a provider mistake in a display field (name, abbreviation, location, a
logo URL) could only be fixed by editing provider columns directly — which
the next schedule sync silently clobbers, the exact failure ADR-0041 closed
for the stats tables. Unlike games and stats, team identity renders on
*every* surface (slate, boards, picks, matchup sheet, admin browsers), so the
open question was where precedence resolves without each serializer restating
the coalesce.

## Decision

- **Five `override_*` display-field parallels on `teams`** (`name`,
  `abbreviation`, `location`, `logo_light_url`, `logo_dark_url`) plus
  `overridden_by`/`overridden_at`, written via a three-state PUT
  (`/admin/teams/{teamId}/override`) with the D15 mechanics: FOR UPDATE,
  audit row in the same transaction, full-clear indistinguishable from
  never-corrected. **Identity keys are not overridable**: `provider_team_id`
  and the bootstrap abbreviation uniqueness are what syncs match rows on, and
  the override layer sits outside both constraints.
- **One resolution home: `services/teams.ts`** (`resolveTeamIdentity` + the
  SQL coalesce helper `effectiveTeamColumns`), the `services/games.ts`
  pattern. Every serializer naming a team — slate, survivor standings, the
  admin game/stats browsers, audit labels — reads through it; admin surfaces
  show effective identity for orientation, and the teams browser is the one
  place the layers show side by side.
- **No settlement recompute, no lock guard** — identity is display data that
  feeds no outcome (the ADR-0041 rationale).

## Consequences

- The architecture's "teams and seasons are view-only" sentence is amended:
  team *display* fields are correctable through the override layer; seasons
  remain view-only.
- Sync matching never reads the override layer, so a corrected abbreviation
  can't break provider-row matching by construction — and a re-sync can't
  clobber a correction (pinned by integration test).
- New audit vocabulary `team_identity_override` / target table `teams`, new
  refusal `team_not_found`. Correction never creates a team.
- Because the override layer sits outside the uniqueness constraints, two
  teams *can* be given the same effective abbreviation — nothing in the
  domain breaks (ids do all matching), but boards and matchup labels turn
  ambiguous. Accepted: it takes an admin typo to produce, and the fix is the
  same edit that caused it; a uniqueness check over a display override would
  refuse legitimate transitional states (swapping two teams' corrections).
- Any future surface that serializes team identity must go through
  `services/teams.ts` — a raw `teams.name` read is now a review flag.
