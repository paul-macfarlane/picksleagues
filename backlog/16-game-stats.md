# Epic: Game Stats (STAT)

Pre-pick matchup stats for the viewer of a game: records, injuries, team
stats, and matchup context, so a member deciding a pick doesn't need a second
tab open. QoL for both NFL modes.

Feasibility was verified against the live ESPN endpoints (2026-08-12): W-L
records with home/road splits ride the scoreboard we already ingest; streaks
and points for/against come from the core `/record` endpoint; PPG and
league ranks from the core `/statistics` endpoint, which is
season-parameterized — so week 1 can show last season's numbers; injuries
(player, position, status, type), the FPI predictor, last-five form, and ATS
records all come from the site `/summary?event=` endpoint. Two facts shape
the design: request paths never call ESPN (arch §External Data), so all of
this is ingestion into our tables; and historical game summaries return the
teams' *current* injuries — era-correct injury history doesn't exist, so the
simulator mocks injuries rather than replaying them (owner, 2026-08-12).

**Tiered presentation is a requirement, not polish** (owner, 2026-08-12): the
default surface shows a small basic tier, and the full advanced tier sits one
deliberate action away — the goal is help without overwhelm, so the wall of
numbers is never what a member lands on.

- [x] **STAT-1** — Data model + ADR: tables for per-team season stats/records
  and per-game context (injuries, predictor), written by ingestion like all
  provider data; decide the week-1 prior-season fallback shape here since it
  decides what the tables key on. Includes the spec/architecture amendment for
  the new surface (locked at v0.3). Ref: arch §Domain Model, D6–D7. _(deps: none)_
- [x] **STAT-2** — Extend `GameDataProvider` + `EspnProvider` with the stat
  fetches (team season stats + records, game context incl. injuries); ESPN
  shapes stay contained in the adapter. _(deps: STAT-1)_
- [x] **STAT-3** — `SimulatedProvider` + sim fixtures serve the same surface:
  synthesized team stats, mocked injuries (owner, 2026-08-12), so sim-driven
  verification and e2e can exercise everything downstream. _(deps: STAT-2)_
- [x] **STAT-4** — Idempotent sync job(s) under `/api/jobs/nfl/*` ingesting
  stats, records, and injuries on a daily-ish cadence; cron registration and
  runbook entry per ADR-0007 / `docs/runbooks/jobs.md`. _(deps: STAT-2)_
- [x] **STAT-5** — Read endpoint serving a game's matchup stats from our
  tables. Shared by every NFL mode, but NFL-*named* (`/games/{id}/nfl-stats`),
  since the stat shapes are the sport's, not the app's (owner, 2026-08-13;
  ADR-0040). _(deps: STAT-4)_
- [x] **STAT-6** — Pick-surface UI: matchup stats reachable from the Pick'em
  and Survivor game rows — basic tier by default, advanced tier one action
  away; stats carry a last-updated stamp (never a real-time claim); mobile-first.
  Which stats land in which tier is this task's clarify-phase decision.
  _(deps: STAT-3, STAT-5)_
- [x] **STAT-7** — Admin stats surface + stat overrides (owner, 2026-08-13):
  an admin browser over `nfl_team_season_stats` and `nfl_game_stat_context`
  (view what the syncs wrote, with as-of stamps), plus `override_*` machinery
  for both — record facts as column parallels, context as a shape decided at
  task time (a JSONB payload doesn't parallel column-for-column). Precedence
  `override_* ?? provider_*` resolved in the read serializer, every override
  writing `admin_audit` in the same transaction (arch D15 pattern). **Amends
  ADR-0040**, which deliberately shipped these tables override-free — the
  amendment records why the owner wants correction to outlive a re-sync even
  for display data. Migration ⇒ evaluator mandatory. _(deps: STAT-6)_
- [ ] **STAT-8** — Team identity overrides (owner, 2026-08-13): `override_*`
  for team display fields (name, abbreviation, logos) on `teams`, corrected
  from an admin teams browser, audited like every override. Shares the admin
  browser home with STAT-7 but touches reference data every sport uses, so the
  precedence resolution lands where team identity is serialized, not in the
  stats read. Migration ⇒ evaluator mandatory. _(deps: STAT-7)_
- [x] **STAT-10** — Advantage indicators (owner, 2026-08-13): the matchup
  sheet's stat comparison marks which team holds the edge in each objectively
  comparable category (record, streak, scoring, ranks — never ATS strings or
  injury lists, where "better" is a judgment call). Pure presentation over
  data already served; no new ingestion or contract change. _(deps: STAT-6)_
- [ ] **STAT-9** — "Results" segment (owner, 2026-08-13): third option in the
  matchup sheet's segmented control (Basic | Advanced | Results) showing both
  teams' season game logs side by side — opponent, W/L, score, week. Zero new
  ingestion: served entirely from our `games` rows for the season. Mind the
  sheet's inner-scroll contract (close button stays put). _(deps: STAT-6)_
