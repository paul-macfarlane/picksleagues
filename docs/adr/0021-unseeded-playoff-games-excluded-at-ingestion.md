# 0021. Unseeded playoff games are excluded at ingestion

- **Status:** Accepted
- **Date:** 2026-08-06
- **Related:** [0007](0007-game-data-ingestion-model.md) (sync-role split, postseason ingestion),
  [0008](0008-league-season-binding.md) (`leagueStartAt`; "no games ⇒ pre-start"),
  [0010](0010-normalized-teams.md) (amended — placeholder teams no longer ingest),
  [0018](0018-pickem-atomic-immutable-weekly-submission.md) (submit-once),
  [0020](0020-season-range-presets.md) (amended — the mid-week resolution rule);
  `docs/mvp-spec.md` §Game Mode 1 Core Rules, §Locking; `docs/architecture.md` §Domain Model;
  backlog DATA-9 (`backlog/02-game-data.md`)

## Context

ESPN publishes each NFL playoff round months ahead as real scoreboard events. Until the round is
seeded, both competitors are a shared placeholder — `team.id` `-1` and `-2`, abbreviation `TBD`,
the same pair reused across every game in the round — carrying a placeholder kickoff.

Ingested as ordinary games, these are corrosive in a way a merely-cosmetic bug is not. A Pick'em
pick stores a **side**, not a team (`pickem_picks.side`), so when ESPN later seeds the matchup the
existing row silently becomes a pick on a team the member never saw, never mind chose. ADR-0018
made a week's submission atomic and immutable, so there is no remedy available to them afterwards:
the pick cannot be changed once submitted. Two junk `teams` rows also exist purely to satisfy
`games`' NOT NULL team FKs, and every unseeded game in the round points at the same pair.

Beyond picks, the placeholder kickoff is itself fabricated data. `leagueStartAt`, the join cutoff,
league discovery's `startsAt`, and the kickoff labels in the SPA would all be derived from a
timestamp ESPN invented as a stand-in and will overwrite.

The two candidate boundaries were: **skip at ingestion**, or **ingest and mark unpickable**.

## Decision

**An event whose competitors are undetermined is not yet a game in our domain, and is excluded at
the provider boundary.** `EspnProvider.fetchNflWeekGames` drops any competition where *either*
competitor is a placeholder. `GameDataProvider.fetchNflWeekGames` states the contract on the
interface, so every adapter inherits the obligation rather than each one rediscovering it.

Detection lives in the ESPN adapter because the encoding is an ESPN shape, and provider shapes
never leak past their adapter (engineering rules). The predicate, applied per competitor:

- numeric `team.id` < 0, **or** `abbreviation` equal to `TBD`, case-insensitive.

Both signals, deliberately. Real NFL team ids are positive and no real abbreviation is `TBD`, so
false positives are effectively impossible, while either signal alone identifies today's
placeholders — the redundancy costs nothing and survives ESPN changing one of them.

No new state is introduced: the game row is created by the normal `sync-schedule` upsert on the
first sync after ESPN seeds the matchup, on the same `providerGameId`. A one-time data migration
removes the placeholder `games` and `teams` rows already ingested, guarded to raise rather than
destroy any `pickem_picks` row that references one.

### The season-range resolver fallback is part of this decision

Skipping alone would have made a Postseason (or Full Season) league **uncreatable** for the gap
between a round kicking off and the next round being seeded — up to ~3 days, recurring at every
round boundary. That is not acceptable, and it is not inherent to the boundary: it was an artifact
of `resolvePickemSeasonRange` selecting candidate start weeks by an inner join on `games`, which
makes a week with no games invisible rather than merely empty.

`weeks.starts_at` / `weeks.ends_at` are NOT NULL and are ingested from the ESPN **season
structure**, independently of games, months before any round is seeded. The resolver therefore
judges a candidate week by:

- its first **effective** kickoff (`override_kickoff_at ?? kickoff_at`, arch D15) when the week has
  games — today's exact rule, unchanged, so resolution can never disagree with `leagueStartAt` or
  the lock derivation about which week has begun;
- its own **`ends_at`** when the week has no games.

`starts_at` is explicitly *not* the fallback bound. ESPN's week windows open days before the first
kickoff, so a `starts_at` comparison would mark a round "underway" while it is still entirely
ahead, and skip past it to the following round. `ends_at` is the honest bound: the round has not
been played yet.

This amends ADR-0020's mid-week resolution rule. Its range-confinement rule is untouched — a
Regular Season league created during the playoffs still finds nothing in its own range, falls back
to the nominal start, and correctly meets `start_week_passed`.

## Consequences

**Easier.** Only one surface knows what a placeholder is. Everything downstream already answers
correctly for an *absent* game and wrongly for a *present-but-placeholder* one: ADR-0008's
"no games ingested for that week ⇒ pre-start" means a league whose start week is unseeded is
pre-start — joins open, settings editable — and adopts the round's real first kickoff the moment
seeding lands. Join cutoffs, commissioner windows, and displayed start times are never derived from
a fabricated timestamp.

**Harder / accepted.**

- A postseason week shows an empty slate until its round is seeded. Members can still navigate
  there (`resolveCurrentWeekId` reads `weeks.starts_at`/`ends_at`, not games). This is honest and
  presents identically to the provisional-season case that already exists.
- **Partial-seeding forfeit.** A round's two conferences can finish hours apart, so seeding can
  land across a sync boundary. A member who submits while only part of the round's slate exists
  submits `required = min(cap, submittable)` over the seeded subset, and ADR-0018's
  `ALREADY_SUBMITTED` then permanently excludes them from games seeded later. Both candidate
  boundaries share this, and it is congruent with ADR-0018's accepted shape for late arrivals and
  unpriced ATS games — but it is a real consequence and belongs on the record.
- If ESPN changes the placeholder encoding, unmatched placeholders ingest again. The failure mode
  is the status quo ante rather than new corruption, and `warnOnTeamCorrectionWithPicks` remains
  the tripwire that logs when a picked game's teams change on re-sync.

**Rejected: ingest and mark unpickable.** `games.home_team_id`/`away_team_id` are NOT NULL FKs, so
marking requires either keeping the junk `teams` rows permanently or migrating the FKs to nullable.
It then needs an "unseeded" signal — a stored flag, or a downstream check against placeholder team
identity, which is precisely the provider-shape leak the adapter boundary avoids. Five surfaces
would have to learn to ignore these rows (`slate.ts`'s `pickable`, `nflWeekFirstKickoffAt`,
`resolvePickemSeasonRange`, `requiredPickemPickCount`, the SPA rows), and ADR-0008 would need
amending because "no games ⇒ pre-start" would stop being sufficient. It also does not close the
creation gap for free: the only way it does so unaided is by letting an ESPN-invented kickoff drive
league start, which makes the join cutoff and displayed start time fabricated numbers that jump
when seeding lands. The resolver fallback above gets creation working with a start time that is
honestly unknown until it is known.

**Revisit if:** ESPN changes the placeholder encoding; a mode arrives whose picks reference a team
rather than a side, which would make an unseeded game meaningful to show but still unpickable; or
partial-seeding forfeit is observed to actually bite a member, at which point the remedy is
ADR-0018's scope, not this one's.
