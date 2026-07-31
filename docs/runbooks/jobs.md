# Runbook: Background Jobs

How the `/api/jobs/*` endpoints are configured, scheduled, and operated (arch §Background
Jobs, D7; ADR-0007). Jobs are plain HTTP endpoints — idempotent, safe to re-run, safe to
double-trigger, safe to fire manually.

## Endpoints

All are `POST`, require the shared-secret header, and return the uniform `JobRunResponse`
envelope (`200` on success, `500` with `status: "error"` on failure — the non-2xx is what
the cron scheduler alerts on).

| Endpoint                          | Work                                                                                          |
| --------------------------------- | --------------------------------------------------------------------------------------------- |
| `/api/jobs/nfl/sync-schedule`     | Upsert NFL season, weeks (regular + postseason, Pro Bowl excluded), games, kickoffs, statuses |
| `/api/jobs/nfl/sync-odds`         | Snapshot current spreads for unstarted games in the current/next week into `odds_snapshots`   |
| `/api/jobs/nfl/sync-scores`       | Refresh live/final scores + statuses; fast no-op when no games are active. **Settles the affected league-weeks** when a game goes final — scores and standings move together |
| `/api/jobs/settle-sweep`          | Nightly reconciliation: recompute `pickem_pick_results` + `pickem_standings` for every active league season from stored results (arch D10) |

Query params (all optional; defaults derive from the Clock and our own tables):
`season` (e.g. `2026`), `week`, `weekType` (`regular` | `postseason`; defaults to
`regular` when `week` is given, and is only meaningful together with `week` — bare
`weekType` is ignored). Explicit params are the manual/simulator path — the season
replay drives these same endpoints with explicit values. A requested week the provider
doesn't expose (e.g. the excluded Pro Bowl week) returns `{ skipped: true, reason:
"week_not_synced" }`.

**Offseason — the daily job self-heals; no manual trigger required.** A bare (no-query)
run of `nfl-sync-schedule` — the daily cron shape — additionally checks whether the
*default* season (`nflSeasonYearFor`) has concluded (its greatest ingested week's
`endsAt <= now`) and, if so, ensures `seasonYear + 1` exists (ADR-0009 "upcoming seasons
exist before their data"): real data if ESPN has published it, otherwise a **provisional**
placeholder built from a plausible NFL calendar skeleton (18 regular weeks anchored to
the first Thursday of September, then the four postseason rounds) — flagged
`provisional: true` and carrying **zero games**, so `leagueStartAt` keeps deriving `null`
and the league stays a normal pre-start league. League creation (which binds to the
latest season row, ADR-0009) therefore works through the entire offseason, not just after
ESPN publishes. Once ESPN's real structure lands — typically May — the very next daily
run overwrites the provisional weeks in place (same row ids, corrected dates) and clears
the flag; games start ingesting normally. An explicit early trigger still works and is
harmless (`POST /api/jobs/nfl/sync-schedule?season=<upcoming year>`) but is no longer
required. Explicit `?season=`/`?week=` triggers (manual/simulator) never run this
self-heal step — only a bare no-arg call does.

## Authentication

Every request needs the `x-job-secret` header matching the `JOB_SECRET` env var (32+
chars; per-environment value, see `docs/runbooks/environments.md`). Missing/wrong secret
→ `401`.

## cron-job.org configuration (production only)

Jobs are scheduled by [cron-job.org](https://cron-job.org) against **production only**
(arch §Environments — scheduled crons against staging would fight simulated time).
Staging/local runs are manual (below) or simulator-driven.

For each job: create a cron job with the production URL, method `POST`, and a custom
header `x-job-secret: <production JOB_SECRET>`.

| Job                | Schedule                            | cron pattern (UTC)      | Notes                                                     |
| ------------------ | ----------------------------------- | ----------------------- | --------------------------------------------------------- |
| `nfl-sync-schedule`| Daily 6am ET                        | `0 10 * * *`            | 10:00 UTC = 6am EDT; acceptable drift under EST           |
| `nfl-sync-odds`    | 3×/day in season                    | `0 12,17,22 * * *`      | Morning/afternoon/evening ET; harmless no-op off-season   |
| `nfl-sync-scores`  | Every 5 minutes                     | `*/5 * * * *`           | No-ops in milliseconds when nothing is active — leave on year-round |
| `settle-sweep`     | Daily 3am ET                        | `0 7 * * *`             | Full recompute; catches late stat corrections, admin overrides, and any missed tick |

`settle-sweep` takes no query params — it derives its own scope (every active league
season). It is a **safety net, not the main path**: `nfl-sync-scores` already settles a
game's picks within ~5 minutes of it going final, so a missed sweep costs freshness of
late corrections, never correctness of the day's results.

Future jobs (`ncaamb-sync-bracket`, every 5 min on tournament days) follow the same
pattern and get added here when their epics land.

**Failure alerting:** enable cron-job.org's failure notifications (Settings → Notify on
failure) for each job. A failed run returns HTTP 500, which cron-job.org emails about —
this is the alerting mechanism (ADR-0007); there is no in-app alerting. Repeated
failures also show in the Vercel function logs as single-line JSON `job.failed` events.

## Manual triggering

Any environment, any time — jobs are idempotent:

```sh
# local
curl -X POST -H "x-job-secret: $JOB_SECRET" "http://localhost:3000/api/jobs/nfl/sync-schedule"

# explicit season/week (manual backfill or simulator replay)
curl -X POST -H "x-job-secret: $JOB_SECRET" \
  "http://localhost:3000/api/jobs/nfl/sync-schedule?season=2024"
curl -X POST -H "x-job-secret: $JOB_SECRET" \
  "http://localhost:3000/api/jobs/nfl/sync-odds?season=2026&week=1"
curl -X POST -H "x-job-secret: $JOB_SECRET" \
  "http://localhost:3000/api/jobs/nfl/sync-scores?season=2024&weekType=postseason&week=1"
```

The guard hook in `.claude/hooks/` prompts before job calls against non-local hosts.
The admin page (ADM epic) will add button-press triggers using the same endpoints.

## Reading a run

Responses carry per-job counters, e.g. sync-schedule:
`{ seasonYear, weeksSynced, gamesCreated, gamesUpdated, duplicateProviderGames,
postponements, cancellations, weekMoves, kickoffChanges }`. `gamesUpdated` counts rows
whose provider fields actually changed — a healthy no-op re-run reports zeros. Skipped
runs return `{ skipped: true, reason }` (`no_active_games`, `no_current_week`,
`week_not_synced`, `season_not_synced`).

A bare (no-arg) sync-schedule run additionally carries the offseason self-heal outcome:
`upcoming` (`"real"` | `"provisional"` | `"skipped_not_concluded"` | `"skipped_no_weeks"`)
and `upcomingSeasonYear`. `skipped_not_concluded` is the normal in-season/most-of-the-year
result; `provisional`/`real` only appear once the default season has concluded.
