# 0007. Game-data ingestion model

- **Status:** Accepted
- **Date:** 2026-07-21
- **Related:** architecture.md §External Data, §Background Jobs, §Domain Model, D6–D7, D15; backlog DATA-1..7

## Context

The DATA epic turns the architecture's ingestion design into schema and jobs. The
architecture doc settles the big shapes (override parallels, idempotent HTTP jobs,
provider adapter isolation) but leaves several implementation choices open: primary-key
strategy for domain tables, where the game-status value set lives, which season types to
ingest, whether job endpoints belong in the OpenAPI contract, how "flag affected picks"
is represented before picks exist, and what "alert on repeated failure" concretely means.

## Decision

- **Domain tables use `uuid` PKs (`gen_random_uuid()`) with natural unique keys** for
  upserts (`games.provider_game_id`, `(season_id, week_number)`, `(sport, year)`).
  Better Auth's app-generated text PKs are an adapter convention, not a domain one.
- **`GAME_STATUS` and `SPORT` value sets live in `packages/schemas`**
  (`scheduled | in_progress | final | postponed | cancelled | moved`); `packages/db`
  and `packages/core` take a workspace dependency on `schemas` (type-only in `db`).
  `moved` is override-only — providers express a week move as the game's week FK
  changing; ingestion never writes `moved`.
- **Regular-season-only ingestion (ESPN seasontype 2) for MVP.** All MVP NFL modes run
  on the regular season; NCAAMB bracket ingestion is its own epic.
- **Job endpoints are part of the OpenAPI contract** (`POST /jobs/sync-*`), guarded by a
  timing-safe `x-job-secret` header check, with one uniform `JobRunResponse` envelope
  for 200 and 500 (a deliberate deviation from the `ErrorResponse` 500 idiom so jobs
  keep exactly one failure shape). Manual/simulator triggers pass explicit
  `?season=&week=` params; defaults derive from the injected Clock
  (`nflSeasonYearFor`) and our own `weeks` rows — never from provider "current week".
- **Sync-role split:** `sync-schedule` owns creating/updating seasons, weeks, and games
  (all provider fields, including scores, so a `final` status can never coexist with
  null scores); `sync-odds` and `sync-scores` only read reference rows and update/insert
  their own data — they never create games or weeks. Provider fetches always complete
  before a write transaction opens. Schedule changes (postponed/cancelled/week-move) are
  detected, counted, and logged, but **no pick-flag state is stored** — pick push/re-pick
  handling derives from game status + week FK at settlement time (spec §Cancellations,
  arch D10's pure-derivation rule).
- **Repeated-failure alerting = per-job consecutive-failure streaks** in a `job_health`
  table, maintained by the shared job runner; a Discord webhook
  (`DISCORD_ALERT_WEBHOOK_URL`, optional) fires once when a streak reaches 3, and a
  success resets the streak. Alerting and bookkeeping are best-effort: they can never
  change a job's outcome.

## Consequences

- Writes keyed on natural unique keys (diff-based insert/update, with conflict targets
  guarding concurrent first-inserts) make every sync job idempotent and safe to
  double-trigger, per arch D7 — a no-op re-run leaves rows byte-identical; the simulator
  (epic 04) can replay past seasons through the same handlers by passing explicit
  season/week params.
- `schemas` as the value-set home keeps one definition serving DB typing, API contract,
  and UI, at the cost of `db`/`core` gaining a (cycle-free) dependency edge.
- Storing no pick-flag state means settlement (PKM-4+) must derive cancellation/move
  semantics from game rows — the recompute-friendly path the architecture already
  requires; nothing to migrate when picks land.
- Ingesting only regular-season weeks means postseason NFL data is invisible to the app;
  revisit only if a post-MVP mode needs it.
- One alert per failure streak keeps noise near zero at the cost of no reminder while a
  job stays broken; revisit (re-alert interval) if a silent multi-day outage ever bites.
- **Accepted risk:** the failure streak lives in the same Postgres the jobs use, so a
  full database outage suppresses the Discord alert path. That mode is covered instead
  by cron-job.org's own failure notifications (failed jobs return 500); the webhook
  exists for app-level failures — ESPN shape drift, mapping bugs — where the DB is
  healthy. Revisit only if an outage proves this insufficient.
- **Accepted freshness corner:** the sync-scores fast no-op gate keys on
  `status ∈ (scheduled, in_progress)` and our stored `kickoff_at`, so a game postponed
  then resumed the same day, or a kickoff moved earlier than the last schedule sync
  recorded, can wait up to one daily schedule sync (~24h) before scores flow. Putting
  `postponed` in the active set would permanently defeat the no-op path (a passed-kickoff
  postponed game matches forever); the daily bound is accepted for MVP.
