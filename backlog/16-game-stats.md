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
  tables. Genuinely mode-agnostic (Survivor consumes it unchanged), so the
  generic name is earned. _(deps: STAT-4)_
- [x] **STAT-6** — Pick-surface UI: matchup stats reachable from the Pick'em
  and Survivor game rows — basic tier by default, advanced tier one action
  away; stats carry a last-updated stamp (never a real-time claim); mobile-first.
  Which stats land in which tier is this task's clarify-phase decision.
  _(deps: STAT-3, STAT-5)_
