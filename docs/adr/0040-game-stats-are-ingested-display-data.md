# 0040. Game stats are ingested display data with a tiered surface

- **Status:** Accepted; amended by [0041](0041-stats-overrides-outlive-resync.md), whose override layer [0046](0046-remove-sports-data-overrides.md) removed — the "no `override_*` parallels" decision below stands again
- **Date:** 2026-08-12
- **Related:** architecture.md §External Data / D6–D7 / D10–D11, mvp-spec.md §Screens (amended here), backlog STAT-1…STAT-6

## Context

Members deciding a pick leave the app to look up records, injuries, and team
form. The STAT epic puts those beside the pick: W-L records, injury reports,
scoring stats, and matchup context (recent form, ATS, ESPN's FPI projection),
with last season's numbers standing in until the current season has games
(owner, 2026-08-12).

Everything needed is available from the ESPN unofficial API we already depend
on (verified live 2026-08-12): the bulk standings endpoint carries every
team's record, home/road splits, streak, and points for/against in one
season-parameterized request; the per-event summary endpoint carries pregame
injury reports, FPI projections, last-five form, and ATS records. Three facts
constrain the design:

1. **Request paths never call ESPN** (arch §External Data) — so this is
   ingestion into our tables, like every other provider read.
2. **Injuries are live-only.** A historical game's summary returns the teams'
   *current* injuries (a 2023 game answered with entries dated 2026-08).
   Era-correct injury history does not exist, so simulator replay cannot have
   real injuries — the same shape as historical odds being stripped
   (docs/simulator-guide.md).
3. **ATS records are season-scoped and empty until the season has games** —
   the prior-season fallback cannot cover them, so early weeks simply omit ATS.

The owner also set a product constraint: the surface must not overwhelm — a
small basic tier by default, the full set one deliberate action away.

## Decision

- **Two tables, one new sync job.** `nfl_team_season_stats` holds per-team,
  per-season record facts (W-L-T, home/road splits, signed streak, points
  for/against) keyed `(team_id, season_year)`; `nfl_game_stat_context` holds one
  JSONB payload per game (injuries, FPI win probabilities, ATS summaries,
  last-five form) validated by `NflGameStatContextPayloadSchema` and evolving
  additively, the league-settings pattern. `sync-stats` ingests both: one bulk
  standings request per season targeted, one summary request per unstarted
  game in the same anchor-plus-following week window sync-odds prices.
- **Every stats surface is NFL-named** — `nfl_*` tables, `Nfl*` schemas and
  OpenAPI components, `GET /games/{gameId}/nfl-stats` — because the shapes are
  the sport's, not the app's: another sport's season record has no ties and
  its matchup context carries different stats, so per engineering §naming the
  next sport adds symmetric surfaces of its own rather than bending these
  (owner, 2026-08-13).
- **Provider facts only; derivations at read.** PPG/OPG averages and league
  ranks are computed at read time from the stored rows (32 rows is not a
  query worth denormalizing for) — a stored rank goes stale the moment any
  other team's row changes, the same staleness D11 rejects for lock flags.
- **No `override_*` parallels.** This is display-only data that never feeds
  settlement, locking, or visibility; the recourse for a bad value is the next
  sync run, and an audited correction path would be machinery with no failure
  to prevent (contrast arch D15, whose overrides exist because ingestion can
  clobber corrections that *do* change outcomes). *(Superseded by ADR-0041:
  when the provider itself is wrong, every sync re-asserts the error, so
  "the next sync" is no recourse at all.)*
- **`season_year` is a bare integer, not a `sport_seasons` FK.** The week-1
  fallback serves last season's rows; a prior season's stats legitimately
  exist without that season ever being synced.
- **Prior-season fallback resolves at read.** A team whose current-season row
  has no games yet is served its previous season's row, and the response
  names the season the numbers describe — the client never guesses.
- **The simulator mocks injuries and derives the rest** (owner, 2026-08-12):
  `SimulatedProvider` computes records and points from its fixtures' terminal
  scores clipped to the simulated clock, so replayed stats agree with the
  replayed season; injuries are deterministic synthetic entries, since real
  ones are unobtainable (fact 2). Like synthesized spreads, sim-only. One
  accepted gap: a scenario carries exactly one season, so the week-1
  prior-season fallback is unexercisable under the simulator — a sim week-1
  sheet shows honest zeros/dashes where production will show last season
  (docs/simulator-guide.md records it beside the synthesized-spreads note).
- **Tiered surface as product contract:** basic = record, streak, PPG/OPG,
  key injuries (statuses other than Questionable); advanced = ranks,
  home/road splits, point differential, last five, ATS, full injury report,
  and FPI — the one *prediction*, shown only in advanced and attributed to
  ESPN FPI so the default surface stays neutral.

## Consequences

- A new cron entry (daily) must be registered on cron-job.org per
  docs/runbooks/jobs.md — stats freshness is bounded by that schedule, which
  is why every stats surface carries its `updated_at` as an as-of stamp.
- The stats read is mode-agnostic (`GET /games/{id}/stats`): Survivor and
  Pick'em consume it unchanged, which is what earns the generic name under
  the naming rule.
- Early-season gaps are accepted and visible: ATS empty until the season has
  games, FPI/last-five whatever the provider serves at sync time. The UI
  renders what exists and omits what doesn't rather than fabricating.
- ESPN reshaping these two endpoints breaks only the adapter (provider shapes
  never leak); the surfaces degrade to stale-with-stamp rather than erroring,
  since reads never touch ESPN.
