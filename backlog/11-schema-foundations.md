# Epic: Schema Foundations (SF)

Mini-epic making the schema season- and team-scalable **before the picks epics build
on it** — SF-1/SF-2 block `05-pickem`; SF-4 blocks `06-survivor`'s unique-team
constraint. Ref: ADR-0009 (multi-season leagues, offseason seasons), ADR-0010
(normalized teams); arch §Domain Model.

- [x] **SF-1** — Multi-season league schema: `league_seasons` instance table (absorbs `league_settings`; per-instance settings/status), backfill migration, services/API/UI rebound to the current instance (caps, discovery, join, settings windows). _(deps: none)_
- [x] **SF-2** — Offseason season lifecycle: schedule sync ensures the upcoming `sport_seasons` row once the current season concludes — ESPN data first, flagged provisional placeholder (dates/weeks, never games) otherwise, overwritten in place by real ingestion; creation binds to the upcoming season; provisional dates rendered as estimates. _(deps: SF-1)_
- [x] **SF-3** — League renewal: commissioner "start next season" action minting the next instance with copied settings; dashboard nudge when renewable. **Acceptance: the instance INSERT acquires `lockLeagueRow` first** — every membership-mutating tx validates against the current instance under that lock, so an unlocked renewal could commit alongside a join it should have refused (SF-1 evaluator advisory). _(deps: SF-2)_
- [x] **SF-4** — Normalized teams: `teams` table, `games` home/away FKs, sync upsert + backfill, serializer joins; drop the embedded text columns. _(deps: none)_
