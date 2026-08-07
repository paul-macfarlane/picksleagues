# Epic: Game Data (DATA)

Sports data schema, the provider abstraction, ESPN ingestion, and the sync jobs. Ref: arch §External Data, §Background Jobs, §Domain Model, D6–D7.

- [x] **DATA-1** — Drizzle schema: `sport_seasons`, `weeks`, `games` (provider fields + `override_*` parallels + `overridden_by/at`), `odds_snapshots`. _(deps: FND-2)_
- [x] **DATA-2** — `GameDataProvider` interface in `packages/core` + `EspnProvider` adapter (NFL season/week structure, schedules with kickoff timestamps, live/final scores, spreads); ESPN shapes fully contained in the adapter. _(deps: DATA-1)_
- [x] **DATA-3** — Job endpoint skeleton `/api/jobs/*`: shared-secret header guard, idempotency conventions, structured logging, manual-trigger friendliness. _(deps: FND-1, FND-3)_
- [x] **DATA-4** — `sync-schedule` job: upsert weeks/games/kickoffs; detect postponements, cancellations, and week moves and flag affected picks. _(deps: DATA-2, DATA-3)_
- [x] **DATA-5** — `sync-odds` job: snapshot current spreads for unstarted games into `odds_snapshots`. _(deps: DATA-2, DATA-3)_
- [x] **DATA-6** — `sync-scores` job: fetch live/final scores every 5 min, fast no-op when nothing in progress; settlement hookup lands in PKM-4. _(deps: DATA-4)_
- [x] **DATA-7** — Ingestion failure alerting — resolved as cron-job.org failure emails (jobs return 500 on failure); the in-app Discord webhook + `job_health` streak tracking were built, then removed per owner feedback as overkill (ADR-0007). Operational setup: `docs/runbooks/jobs.md`. _(deps: DATA-4)_

- [x] **DATA-8** — Live in-game state: capture `period` + `clock_seconds` from the ESPN scoreboard in `sync-scores` (normalized, not the provider's display string — arch "provider shapes never leak"), store them on `games` with `override_*` parallels so an admin can correct them (ADM-2 surface), and surface them on the pick and week-detail rows as e.g. "Q3 12:34". Displayed with an as-of stamp sourced from the row's last observed change — the clock is a snapshot of an instant, so a bare value would read as live when the poll is 5 minutes apart (arch §Score freshness; spec §UI conventions "never claims real-time freshness"). Not "real-time score updates" (spec §Out of Scope) — same poll, same cadence, honest timestamp; arch:230 already anticipated this. _(deps: DATA-6, ADM-2)_

- [x] **DATA-9** — Unseeded playoff games must not be pickable. ESPN publishes each playoff round months ahead as real events whose competitors are a shared TBD placeholder (`team.id` `-1`/`-2` — the same pair across every game in the round) with placeholder kickoffs, so ingestion creates two junk `teams` rows that every unseeded game points at, and a postseason Pick'em league offers them as ordinary picks. A pick stores `side`, not a team, so seeding silently converts it into a pick on a team the member never chose — and submit-once (ADR-0018) leaves no way out. Decide where the boundary belongs (skip at ingestion vs. ingest and mark unpickable — the choice changes what `leagueStartAt` returns for a postseason league) and record it. Ref: spec §Game Mode 1 Core Rules, §Locking; arch §Domain Model. _(deps: none)_ _(needs-triage)_

Post-review scope addition (owner feedback, ADR-0007): ingestion covers the NFL **postseason** as well as the regular season — `weeks.week_type` + `label`, Pro Bowl excluded; jobs/services/routes are NFL-named (`/api/jobs/nfl/*`, `services/nfl/`).

## Technical plan

- **DATA-9** — `docs/plans/data-9.md` (approved and delivered; carries the execution record, AI code review, and closeout)
