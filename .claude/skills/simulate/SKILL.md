---
description: Control the sports data simulator for testing with historical ESPN data during off-season.
user_invocable: true
---

# /simulate — Sports Data Simulator

Controls the simulator that replays historical ESPN data for testing picks, scoring, and standings during the off-season.

## Arguments

`$ARGUMENTS` determines the action:

### "init {year}"

Initialize a simulation using historical NFL season data:

- Fetch the {year} NFL season data from ESPN
- Populate the database with seasons, phases, teams, and events for that year
- Set the simulation state to Phase 1
- Report: number of phases, teams, and events loaded

Example: `/simulate init 2024`

### "advance"

Advance the simulation to the next phase:

- Sync live scores for the current phase (all games marked as final using historical data)
- Create outcome records for all completed events
- Sync odds for the next phase
- Recalculate standings for all leagues
- Report: phase completed, events scored, standings updated

### "status"

Show the current simulation state:

- Active season year
- Current phase (and total phases)
- Events completed vs remaining
- Any leagues with active standings

### "reset"

Clear all simulation data:

- Confirm with user before proceeding
- Delete all synced sports data (seasons, phases, teams, events, odds, live scores, outcomes)
- Reset standings
- Report: data cleared

## Prerequisites

The simulator service (`lib/simulator.ts`) must be implemented (story PL-040). This skill is the user-facing interface to that service.

## How It Works

The simulator calls the exact same sync functions used by the production cron jobs (`lib/sync/nfl/`), but feeds them historical ESPN data instead of live data. This ensures the sync code paths are identical between testing and production.
