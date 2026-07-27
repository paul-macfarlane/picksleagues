# 0009. Leagues span seasons via league_seasons instances; upcoming seasons exist before their data

- **Status:** Accepted
- **Date:** 2026-07-23
- **Related:** amends ADR-0008 (league–season binding); mvp-spec.md §Membership, §Commissioner Powers; architecture.md §Domain Model, §Locking Model, D10, D11, D13; backlog SF-1…SF-3

## Context

ADR-0008 bound a league permanently to one `sport_seasons` row. Two walls emerged the
moment the Leagues epic was used in the offseason (July): (1) leagues cannot be created
at all between a season's end and its schedule release (Feb–May for NFL; ~April–March
for NCAAMB, leaving March Madness a one-week creation window), because creation binds
to the *latest ingested* season, which is the finished one; (2) a league dies with its
season — "same friends, next year" means recreating the league and re-inviting everyone.
Both contradict the product intent of persistent friend groups. The picks epics
(05–07) are about to key picks/results/standings tables off leagues; if the per-season
split doesn't happen first, it becomes a migration through live pick data.

## Decision

- **`leagues` keeps identity only** — name, mode, visibility, max members, members,
  commissioners. Membership is league-level and persists across seasons.
- **New `league_seasons` instance table** — `league_id` (cascade) + `season_id`
  (restrict), `UNIQUE(league_id, season_id)`, and it takes over what is per-year:
  the **settings JSONB** (absorbing the `league_settings` table), **status**
  (ACTIVE/CONCLUDED), and the derived start boundary. A league's *current season* is
  its newest instance. Existing leagues backfill to exactly one instance.
- **Picks, pick_results, and standings (epics 05–07) reference `league_seasons`**, not
  `leagues`. Per-mode per-season constraints (elimination's unique-team-per-member)
  scope to the instance — a team is reusable next year.
- **Renewal is explicit, not automatic:** once the next season row exists, a
  commissioner action mints the league's next instance with settings copied from the
  previous one (editable pre-start as usual). No auto-enrollment.
- **Upcoming seasons exist before their data.** Once a sport's in-progress season
  concludes, the schedule sync ensures next year's `sport_seasons` row: ESPN first
  (season dates and week structure are often published before games), otherwise a
  **provisional** placeholder (flagged as such) built from known structure — NFL
  starts a Thursday in early September, the tournament a Thursday in mid-March.
  Provisional rows are overwritten in place by real ingestion. **Placeholders never
  include games**: `leagueStartAt` derives only from real kickoffs, so an offseason
  league has `startsAt = null` ⇒ pre-start ⇒ creatable, joinable, editable — the
  existing derived-lock rules (D11) engage automatically the day real data lands.
- Commissioner cap, discovery, and join rules consult the **current instance's**
  status where they read league status today.

## Consequences

- League creation works eleven-plus months a year for every mode; nothing about the
  clock/locking model changes — the offseason is simply a long pre-start.
- The schema move (new table + backfill + service rebinding) must land **before
  epic 05** (backlog SF-1 blocks 05-pickem); the renew UX (SF-3) can trail.
- Per-season settings snapshots mean a rule change next year can never reinterpret a
  finished season's standings (strengthens D10's pure-derivation guarantee).
- UI display of an estimated start ("Season starts ~Sept 10") must mark provisional
  dates as such; provisional data never drives locks.
- ADR-0008's single-season binding is superseded where it conflicts; its derivation
  rule (`leagueStartAt` from real kickoffs, `override_kickoff_at ?? kickoff_at`)
  carries over unchanged, now scoped to an instance.
