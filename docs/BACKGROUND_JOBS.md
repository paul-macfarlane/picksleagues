# PicksLeagues — Background Jobs

> This document describes the background job architecture: what jobs exist, what they do, how they are scheduled, and key implementation details.

---

## Overview

Background jobs are implemented as **Next.js API route handlers** under `app/api/cron/`. They are triggered externally by [cron-job.org](https://cron-job.org) on a schedule. All cron routes are authenticated via a `CRON_SECRET` bearer token.

Jobs are sport-specific. NFL jobs live under `app/api/cron/nfl/`. Future sports get their own namespaces (e.g., `app/api/cron/march-madness/`). There is some shared infrastructure (auth, utilities) but sync logic per sport is intentionally separate.

---

## Authentication

All cron routes are protected via `lib/cron-auth.ts`, which checks for a `Authorization: Bearer <CRON_SECRET>` header. cron-job.org is configured to send this header with every request. Requests without a valid token return `401`.

```
lib/cron-auth.ts      # Bearer token validation helper
CRON_SECRET           # Environment variable (set in Vercel + cron-job.org)
```

---

## Self-Gating: isNflSeasonMonth

To avoid unnecessary work outside the NFL season, sync jobs check `isNflSeasonMonth()` before doing anything. This helper returns `true` only during the months the NFL season is active (roughly August through February). Jobs that run year-round but only need to do work during the season use this guard and return early with a `200 OK` (no-op) outside those months.

This is a lightweight guard — it does not replace proper season detection from the data source, but it avoids hitting external APIs unnecessarily in the off-season.

---

## Job Descriptions

### 1. Initial Setup Job

**Route:** `app/api/cron/nfl/setup`
**Trigger:** Manual (run once per season or as needed, not on a schedule)

Seeds all foundational data for an NFL season:

1. Seed the external data source record (ESPN)
2. Seed the sportsbook record
3. Sync seasons from ESPN
4. Sync phases (weeks) for the current season
5. Sync teams
6. Sync events (games) for all phases
7. Sync odds for all events

This job is idempotent — running it again should not create duplicates.

---

### 2. Weekly Sync Job

**Route:** `app/api/cron/nfl/weekly-sync`
**Schedule:** Once per week (e.g., Tuesday morning, after the previous week's games are fully settled)

Refreshes structural data that changes week to week:

- Syncs phases for the current season (in case new phases have been published)
- Syncs events for the current and upcoming phases
- Syncs teams (handles any roster or team metadata changes)

This job does **not** sync odds or live scores — those have dedicated jobs.

---

### 3. Odds Sync Job

**Route:** `app/api/cron/nfl/odds-sync`
**Schedule:** Every 15 minutes during the active pick window

Fetches current odds from the sportsbook and updates events. Only runs during the game window (see Game Window Detection below).

Odds are relevant until the pick lock deadline for each event. After an event starts, odds are frozen.

---

### 4. Live Scores Job

**Route:** `app/api/cron/nfl/live-scores`
**Schedule:** Every 5 minutes during active game windows

Fetches current scores and game statuses from ESPN. Updates event records with:

- Current score
- Game status (scheduled, in-progress, final, etc.)

When one or more events transition to a **final** status, this job triggers **standings recalculation** for all leagues that have picks on those events.

---

### 5. Standings Recalculation

**Not a standalone cron route.** Standings are recalculated as part of the live scores job when games finish. The recalculation logic lives in `lib/sync/nfl/` and is called internally.

Recalculation:

- Scores all picks for the completed event
- Aggregates win/loss/push counts and total points per member per phase
- Updates the season-long leaderboard

Standings can also be triggered manually if needed (e.g., if a score was corrected).

---

## Job Schedule Summary

All jobs are triggered by POST requests from cron-job.org with the header `Authorization: Bearer <CRON_SECRET>` (same value as the `CRON_SECRET` set in Vercel).

| Job           | Route                          | Method | Cron Expression       | Timezone         | Self-Gated        |
| ------------- | ------------------------------ | ------ | --------------------- | ---------------- | ----------------- |
| Initial Setup | `app/api/cron/nfl/setup`       | POST   | Disabled (manual run) | America/New_York | No                |
| Weekly Sync   | `app/api/cron/nfl/weekly-sync` | POST   | `0 6 * * 2`           | America/New_York | Yes               |
| Odds Sync     | `app/api/cron/nfl/odds-sync`   | POST   | `*/15 * * * *`        | America/New_York | Yes (game window) |
| Live Scores   | `app/api/cron/nfl/live-scores` | POST   | `*/5 * * * *`         | America/New_York | Yes (game window) |

All jobs are pinned to `America/New_York` (DST-aware) so operators read one timezone across the cron-job.org dashboard and Vercel logs. The NFL schedule is ET-native, so game windows, pick lock times, and "Tuesday 6:00 AM" all live in the same clock. Timezone on the every-N-minutes jobs is cosmetic — they fire every N minutes regardless — but keeping it consistent avoids the "wait, which job is in which tz?" tax.

### cron-job.org configuration

For each scheduled job:

- **URL**: `https://<production-host>/api/cron/nfl/<route>`
- **Request method**: POST
- **Headers**: `Authorization: Bearer <CRON_SECRET>` (single header, value matches the Vercel env var exactly)
- **Schedule**: use the cron expression + timezone from the table above
- **Request timeout**: 30s default is fine — routes set `maxDuration = 60` on the Vercel side and typical runs stay well under 30s
- **Retry on failure**: one retry — absorbs transient ESPN / database blips without masking persistent failures
- **Notifications**: enable failure notifications on the cron-job.org account so repeated non-200 responses page the operator

The Initial Setup job is kept **disabled** in cron-job.org and fired via the "Run now" button when seeding a new season — it should never run on a schedule.

After creating each job, smoke-test it with "Run now":

- Expected: `200 OK` with a JSON body summarizing the sync result (or a no-op `200 OK` if the self-gate short-circuits outside season or a game window).
- `401`: bearer token mismatch — check `CRON_SECRET` in both Vercel and the cron-job.org header.
- `5xx`: inspect Vercel function logs; the route logs the underlying error.

---

## Game Window Detection

Not all cron invocations need to do real work. The odds sync and live scores jobs detect whether there is an active or upcoming game window before hitting external APIs.

A **game window** is considered active when:

- There are events scheduled within the next N hours, OR
- There are events currently in-progress

Outside of game windows, these jobs return early (no-op `200 OK`). This avoids unnecessary API calls to ESPN and the sportsbook during quiet periods (e.g., Monday through Thursday when no games are scheduled).

---

## ESPN API Reference

### Base URL

```
https://sports.core.api.espn.com/v2/sports/football/leagues/nfl
```

We use ESPN's reference-based `sports.core.api.espn.com/v2` API rather than the `site.api.espn.com` scoreboard API. Responses are paginated lists of `$ref` URLs; each ref is resolved via a follow-up fetch. This is more round-trips but yields stable, typed records per entity (seasons, weeks, teams, events, odds, scores) that are easier to upsert into our schema.

### Key Endpoints

| Endpoint                                          | Description                                      |
| ------------------------------------------------- | ------------------------------------------------ |
| `/seasons?limit=100`                              | All NFL seasons (list of `$ref`)                 |
| `/seasons/{year}/types/{typeId}/weeks?limit=100`  | Weeks for a season type (list of `$ref`)         |
| `/seasons/{year}/teams?limit=100`                 | Teams for a season (list of `$ref`)              |
| `/seasons/{year}/types/{typeId}/weeks/{N}/events` | Events (games) for a week (list of `$ref`)       |
| Competition `odds` ref                            | Odds for an event (resolved from event response) |
| Competition `status` ref                          | Status for an event (resolved from competition)  |
| Competitor `score` ref                            | Per-team score (resolved from competitor)        |

### Pagination

Endpoints default to 10 items per page. Pass `?limit=100` to fetch all entities in one request for the volumes we deal with (≤100 weeks/teams/events per season).

### Season Types

| Value | Description    |
| ----- | -------------- |
| `1`   | Preseason      |
| `2`   | Regular season |
| `3`   | Postseason     |
| `4`   | Offseason      |

Pick'em syncs only regular season and postseason (type 2 and 3).

### Game Statuses

Each event's `status.type.name` is one of:

| Value                | Internal mapping |
| -------------------- | ---------------- |
| `STATUS_SCHEDULED`   | `not_started`    |
| `STATUS_POSTPONED`   | `not_started`    |
| `STATUS_IN_PROGRESS` | `in_progress`    |
| `STATUS_FINAL`       | `final`          |

The `status.type.completed` boolean can also be used to detect finished games.

### Pro Bowl Filtering

The Pro Bowl (and the Pro Bowl Skills Challenge) appear in ESPN's weeks list but should be **excluded** from sync. Filter out any week whose label starts with "Pro Bowl". These events do not have meaningful pick'em value and can cause data issues.

### Week Date Override

ESPN's weeks endpoint returns start/end dates for a "week" which may not exactly match calendar weeks. When syncing phases, the phase date range should be derived from the actual event dates within that phase, not from ESPN's week start/end metadata — ESPN's week boundaries can be inconsistent, especially around holidays and bye weeks.

---

## External ID Mapping (Bridge Tables)

PicksLeagues maintains its own internal IDs for all entities (seasons, phases, teams, events). ESPN data is linked via **bridge tables** that store the external ID alongside the internal ID.

Pattern:

- `nfl_seasons` → `espn_nfl_seasons` (stores ESPN season ID)
- `nfl_phases` → `espn_nfl_phases` (stores ESPN week ID)
- `nfl_teams` → `espn_nfl_teams` (stores ESPN team ID)
- `nfl_events` → `espn_nfl_events` (stores ESPN event ID)

This pattern:

- Keeps internal IDs stable even if the external data source changes
- Makes it straightforward to add a second data source in the future
- Allows querying by ESPN ID when processing sync responses

Sync jobs look up existing records by external ID before inserting — if the external ID already exists, they update; otherwise they insert.

---

## Future Sports

Each new sport gets its own sync pipeline:

- `lib/sync/march-madness/` — March Madness sync logic
- `app/api/cron/march-madness/` — March Madness cron routes

Shared infrastructure (`lib/cron-auth.ts`, common utilities) is reused, but sport-specific sync logic is kept separate. There is no single "universal" sync abstraction — the differences between sports are significant enough that separate pipelines are cleaner and more maintainable.
