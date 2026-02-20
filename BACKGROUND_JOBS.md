# PicksLeagues — Background Jobs & Data Sync

> This document defines all background jobs, their scheduling, and the ESPN data sync pipeline. For business rules, see [BUSINESS_SPEC.md](./BUSINESS_SPEC.md). For tech stack details, see [TECH_STACK.md](./TECH_STACK.md).

---

## Table of Contents

1. [Overview](#1-overview)
2. [Inngest Setup](#2-inngest-setup)
3. [Initial Setup Job](#3-initial-setup-job)
4. [Scheduled Sync Jobs](#4-scheduled-sync-jobs)
5. [Event-Driven Jobs](#5-event-driven-jobs)
6. [ESPN API Reference](#6-espn-api-reference)
7. [External ID Mapping](#7-external-id-mapping)
8. [Game Window Detection](#8-game-window-detection)
9. [Job Schedule Summary](#9-job-schedule-summary)

---

## 1. Overview

All background work is managed by **Inngest**. There are three categories of jobs:

| Category | Trigger | Examples |
|----------|---------|---------|
| **Initial setup** | Manual (one-time) | Seed data source, sportsbook, sync all NFL data |
| **Scheduled sync** | Cron (time-based) | Weekly event sync, game-day odds, live score polling |
| **Event-driven** | Inngest event | Standings recalculation when a game finishes |

Key principles:
- **Every job is idempotent** — safe to re-run without creating duplicates (upsert pattern)
- **Every multi-step job uses Inngest steps** — each step gets its own execution timeout and retry
- **External IDs are mapped to internal IDs** via bridge tables — the data source (ESPN) can be swapped without changing core logic

---

## 2. Inngest Setup

### Installation

```
npm install inngest
```

### File Structure

```
src/lib/inngest/
├── client.ts              # Inngest client instance
├── functions/
│   ├── setup.ts           # One-time setup function
│   ├── weekly-sync.ts     # Weekly full data sync
│   ├── odds-sync.ts       # Game-day odds sync
│   ├── live-scores.ts     # Live score polling during games
│   └── standings.ts       # Standings recalculation (event-driven)
└── index.ts               # Export all functions for the serve handler
```

### API Route

Create a single API route to serve all Inngest functions:

```
src/app/api/inngest/route.ts
```

This route registers all functions with Inngest's webhook system.

### Local Development

Run the Inngest Dev Server alongside your Next.js app:

```
npx inngest-cli@latest dev
```

This provides a local dashboard to trigger and inspect function runs.

---

## 3. Initial Setup Job

### Purpose

A one-time idempotent setup that populates all foundational data in a fresh database. Replaces the previous multi-step seed-then-cron-then-seed process.

### Function: `setup/initialize`

**Trigger**: Manual invocation from Inngest dashboard or CLI.

**Steps (executed sequentially):**

1. **Seed data source** — Upsert the ESPN data source record
2. **Seed sportsbook** — Upsert the default sportsbook (ESPN Bet)
3. **Sync seasons** — Fetch current + upcoming NFL seasons from ESPN, upsert into database with external ID mapping
4. **Sync weeks** — Fetch all regular season + postseason weeks for synced seasons, upsert with calculated pick lock times, exclude Pro Bowl
5. **Override week dates** — Apply our preferred week start/end boundaries (Tuesday 2AM ET instead of ESPN's Thursday midnight ET)
6. **Sync teams** — Fetch all NFL teams for current season, upsert with logos (light + dark)
7. **Sync events** — Fetch all game matchups for all weeks, upsert with home/away team associations
8. **Sync odds** — Fetch betting lines for current/next week from the default sportsbook

This entire function is idempotent. Running it again on an existing database updates data without creating duplicates.

---

## 4. Scheduled Sync Jobs

### 4.1 Weekly Full Sync

**Function**: `espn/weekly-sync`
**Schedule**: Every Tuesday at 2:00 AM Eastern, September through February
**Purpose**: Refresh the full dataset once a week — picks up schedule changes, new events, bye week adjustments.

**Steps:**

1. `sync-seasons` — Upsert current + upcoming seasons
2. `sync-weeks` — Upsert weeks + recalculate pick lock times + override dates
3. `sync-teams` — Upsert teams (catches mid-season roster/branding changes)
4. `sync-events` — Upsert all events for all weeks in the current season

### 4.2 Odds Sync

**Function**: `espn/odds-sync`
**Schedule**: Game-day aware (see [Section 8](#8-game-window-detection))
- **Game days (Thu/Sat/Sun/Mon)**: Every 30 minutes from 9:00 AM to first kickoff
- **Non-game days**: Once daily at 9:00 AM Eastern
- **Inactive months (Mar–Aug)**: Off

**Purpose**: Keep spread data fresh so users see current lines when making picks. Stops at kickoff since odds aren't useful after games start.

**Steps:**

1. `sync-events-current-week` — Upsert events for current + next week (catches last-minute schedule changes)
2. `sync-odds` — Fetch odds from the default sportsbook for all events in current + next week, upsert

### 4.3 Live Score Polling

**Function**: `espn/live-scores`
**Schedule**: Game-day aware (see [Section 8](#8-game-window-detection))
- **During active game windows**: Every 1–2 minutes
- **Game days outside game windows**: Every 15 minutes (catches early/late starts)
- **Non-game days**: Off
- **Inactive months (Mar–Aug)**: Off

**Purpose**: Keep live scores current for the UI and detect when games finish to trigger standings.

**Steps:**

1. `sync-live-scores` — For all events in current + next week:
   - Fetch current score, game status, period, clock from ESPN
   - Upsert live score records
   - When status transitions to `final`: create/update outcome record with confirmed final score
2. `check-for-finals` — After syncing, check if any games transitioned to `final` in this run
3. `emit-game-finished` — If finals detected, emit `"game/finished"` Inngest event with the list of event IDs that just finished. This triggers the standings job.

### NFL Game Windows

Standard NFL game windows (all times Eastern):

| Day | Typical Windows |
|-----|----------------|
| Thursday | 8:15 PM (TNF) |
| Saturday | 1:00 PM, 4:30 PM, 8:15 PM (late season / postseason only) |
| Sunday | 1:00 PM, 4:05 PM, 4:25 PM, 8:20 PM (SNF) |
| Monday | 8:15 PM (MNF) |

The polling window should span from 30 minutes before the earliest kickoff to ~4 hours after the latest kickoff (to capture game completion). See [Section 8](#8-game-window-detection) for implementation.

---

## 5. Event-Driven Jobs

### 5.1 Standings Recalculation

**Function**: `standings/recalculate`
**Trigger**: `"game/finished"` event (emitted by live score sync when games go final)
**Purpose**: Score picks and update standings immediately after games end.

**Event payload:**

```json
{
  "name": "game/finished",
  "data": {
    "eventIds": ["uuid-1", "uuid-2"]
  }
}
```

**Steps:**

1. `find-affected-leagues` — Find all leagues that have picks on the finished events
2. `score-picks` — For each affected league:
   - Find all unscored picks for the finished events
   - Calculate result (win/loss/push) using the scoring rules from BUSINESS_SPEC.md Section 8.1
   - Update each pick's result
3. `recalculate-standings` — For each affected league:
   - Recompute total wins, losses, pushes, and points from all scored picks (full recalculation for integrity)
   - Recompute rankings using dense ranking
4. `log-completion` — Log which leagues were updated and how many picks were scored

### Why Event-Driven

Previously, standings ran on a fixed Tuesday 2AM schedule. This meant users waited hours (or overnight) after Monday Night Football to see updated standings. With event-driven recalculation, standings update within minutes of each game ending.

---

## 6. ESPN API Reference

### Base URL

```
https://sports.core.api.espn.com/v2/
```

No API key required — this is a public API.

### Endpoints Used

| Data | Endpoint | Notes |
|------|----------|-------|
| NFL league info | `/sports/football/leagues/nfl` | League metadata |
| Seasons | `/sports/football/leagues/nfl/seasons` | Returns current + upcoming seasons |
| Weeks | `/seasons/{seasonId}/types/{typeId}/weeks` | Type 2 = regular season, Type 3 = postseason. Exclude type 1 (preseason), type 4 (offseason). |
| Teams | `/seasons/{seasonYear}/teams` | All teams for a season year |
| Events (games) | `/seasons/{seasonId}/types/{typeId}/weeks/{weekNumber}/events` | Games for a specific week |
| Odds | Fetched via `$ref` URL from event metadata | Betting lines from a specific sportsbook |
| Score (per team) | Fetched via `$ref` URL from external event metadata | Individual team score |
| Game status | Fetched via `$ref` URL from external event metadata | Status: scheduled → in progress → final |

### ESPN Season Types

| Type ID | Name | Include? |
|---------|------|----------|
| 1 | Preseason | No |
| 2 | Regular Season | Yes |
| 3 | Postseason | Yes |
| 4 | Offseason | No |

### ESPN Game Status Values

| Status | Meaning | Action |
|--------|---------|--------|
| `STATUS_SCHEDULED` | Not started | Map to `not_started` |
| `STATUS_IN_PROGRESS` | Live | Map to `in_progress` |
| `STATUS_FINAL` | Completed | Map to `final`, create/update outcome record |
| `STATUS_POSTPONED` | Delayed | Treat as `not_started` |

### Pro Bowl Filtering

ESPN includes Pro Bowl as a postseason week. Filter it out by week label or number during the weeks sync. Pro Bowl games should not appear as pickable events.

### Week Date Override

ESPN defines NFL weeks as starting Thursday midnight ET. We prefer Tuesday 2AM ET as the week boundary (to capture Monday Night Football results within the correct week). During the weeks sync, override the start/end dates after fetching from ESPN.

### Rate Limiting

ESPN's public API does not document rate limits, but be respectful:
- Limit concurrent requests to **10 parallel** when batch-fetching (e.g., fetching scores for all events in a week)
- Use `p-limit` or similar for concurrency control

---

## 7. External ID Mapping

All ESPN entities are mapped to internal UUIDs via bridge tables. This decouples core logic from the data provider.

### Bridge Table Pattern

Each bridge table has:
- `externalId` (string) — The ESPN ID or `$ref` URL
- `dataSourceId` (UUID, FK → data_sources) — Identifies ESPN as the provider
- `internalId` (UUID, FK → the core table) — Our internal ID
- `metadata` (JSON, optional) — Provider-specific data (e.g., ESPN `$ref` URLs for score/status endpoints)

### Bridge Tables

| Bridge Table | Maps To | Metadata Contains |
|-------------|---------|-------------------|
| `external_seasons` | `seasons` | ESPN season slug |
| `external_weeks` | `weeks` | ESPN season type + week number |
| `external_teams` | `teams` | — |
| `external_events` | `events` | ESPN `$ref` URLs for: odds, away team score, home team score, game status |
| `external_odds` | `odds` | — |
| `external_sportsbooks` | `sportsbooks` | — |

### Why This Pattern

- **Swap data source**: If ESPN changes their API or a better source becomes available, only the sync functions change — no core logic changes
- **Idempotent upserts**: On each sync, look up by (`externalId`, `dataSourceId`). If found, update. If not, insert. No duplicates.
- **Metadata for lazy fetching**: ESPN's API uses `$ref` URLs extensively. Storing these in metadata means we can follow them later (e.g., fetch scores for a specific event) without re-querying the parent resource.

---

## 8. Game Window Detection

For live score polling and odds sync, we need to know when games are actually happening to avoid wasteful polling.

### Approach

Query the database for events in the current week:

1. Find the earliest `startTime` and latest `startTime` among all events in the current week
2. **Polling window**: from `earliestStart - 30 minutes` to `latestStart + 4 hours` (games typically last ~3.5 hours)
3. When the live score cron fires, check if `now` falls within the polling window
4. If outside the window, short-circuit — skip the ESPN API calls

### Schedule Configuration

Rather than encoding complex day-of-week logic in cron expressions, use a simple frequent cron (e.g., every 2 minutes during Sep–Feb) and let the function itself decide whether to run:

```
Cron fires every 2 minutes
  → Function starts
  → Query: any events in current week with startTime within [-30min, +4hr] of now?
  → If no: return early (no-op)
  → If yes: sync live scores
```

This is simpler and more robust than trying to encode "Thursday 7:45 PM to 11:30 PM, Sunday 12:30 PM to midnight, Monday 7:45 PM to 11:30 PM" in cron expressions, especially since the NFL schedule varies week to week (London games, holiday schedules, flex scheduling).

### Seasonal On/Off

All scheduled game-day jobs (odds sync, live scores) should only be active September through February. The simplest approach is to check the month at the start of each function and return early if outside the NFL season window.

---

## 9. Job Schedule Summary

| Job | Trigger | Frequency | Active Period |
|-----|---------|-----------|---------------|
| `setup/initialize` | Manual | One-time | Anytime |
| `espn/weekly-sync` | Cron | Tuesday 2:00 AM ET | Sep–Feb |
| `espn/odds-sync` | Cron | Every 30 min (self-gating) | Sep–Feb, game days only |
| `espn/live-scores` | Cron | Every 2 min (self-gating via game window detection) | Sep–Feb |
| `standings/recalculate` | Event (`game/finished`) | On demand | Whenever games finish |

### Self-Gating Pattern

The odds and live score jobs run on a frequent cron but **check whether they need to do anything** before making ESPN API calls:

- **Live scores**: Check if any games are within the active game window. If not, return early.
- **Odds**: Check if any un-started games exist in the current week and current time is before the latest kickoff. If not, return early.

This avoids complex cron expressions while keeping polling tight during actual games and silent otherwise.
