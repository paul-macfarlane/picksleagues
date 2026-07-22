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
| `/api/jobs/nfl/sync-scores`       | Refresh live/final scores + statuses; fast no-op when no games are active                     |

Query params (all optional; defaults derive from the Clock and our own tables):
`season` (e.g. `2026`), `week`, `weekType` (`regular` | `postseason`; defaults to
`regular` when `week` is given). Explicit params are the manual/simulator path — the
season replay drives these same endpoints with explicit values.

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

Future jobs (`settle-sweep` daily 3am ET, `ncaamb-sync-bracket` every 5 min on tournament
days) follow the same pattern and get added here when their epics land.

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
