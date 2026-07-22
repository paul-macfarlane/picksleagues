# Epic: Game Data (DATA)

Sports data schema, the provider abstraction, ESPN ingestion, and the sync jobs. Ref: arch §External Data, §Background Jobs, §Domain Model, D6–D7.

- [x] **DATA-1** — Drizzle schema: `sport_seasons`, `weeks`, `games` (provider fields + `override_*` parallels + `overridden_by/at`), `odds_snapshots`. _(deps: FND-2)_
- [x] **DATA-2** — `GameDataProvider` interface in `packages/core` + `EspnProvider` adapter (NFL season/week structure, schedules with kickoff timestamps, live/final scores, spreads); ESPN shapes fully contained in the adapter. _(deps: DATA-1)_
- [x] **DATA-3** — Job endpoint skeleton `/api/jobs/*`: shared-secret header guard, idempotency conventions, structured logging, manual-trigger friendliness. _(deps: FND-1, FND-3)_
- [x] **DATA-4** — `sync-schedule` job: upsert weeks/games/kickoffs; detect postponements, cancellations, and week moves and flag affected picks. _(deps: DATA-2, DATA-3)_
- [x] **DATA-5** — `sync-odds` job: snapshot current spreads for unstarted games into `odds_snapshots`. _(deps: DATA-2, DATA-3)_
- [x] **DATA-6** — `sync-scores` job: fetch live/final scores every 5 min, fast no-op when nothing in progress; settlement hookup lands in PKM-4. _(deps: DATA-4)_
- [x] **DATA-7** — Ingestion failure alerting — resolved as cron-job.org failure emails (jobs return 500 on failure); the in-app Discord webhook + `job_health` streak tracking were built, then removed per owner feedback as overkill (ADR-0007). Operational setup: `docs/runbooks/jobs.md`. _(deps: DATA-4)_

Post-review scope addition (owner feedback, ADR-0007): ingestion covers the NFL **postseason** as well as the regular season — `weeks.week_type` + `label`, Pro Bowl excluded; jobs/services/routes are NFL-named (`/api/jobs/nfl/*`, `services/nfl/`).
