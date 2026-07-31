# Simulator guide

How to drive the season simulator. `docs/architecture.md` §Simulator & Time covers
*why* it is built this way; this is the operator runbook.

Non-prod only. Production ignores `SIM_ENABLED` entirely and never registers an
`/api/sim/*` route (ADR-0014). The SPA route `/sim` exists in the bundle either
way; without the API behind it, it renders as an unknown page.

## The two levers

The simulator is two independent mechanisms, and most confusion comes from
treating them as one:

1. **A clock offset** — a single integer on the `app_state` singleton row.
   Simulated `now` is always `system time + offsetMs`. Time is displaced, never
   frozen; it still ticks. It lives in the database so every serverless instance
   agrees on it.
2. **A data source swap** — with a scenario loaded, the `GameDataProvider`
   resolves to `SimulatedProvider` instead of the ESPN adapter. ESPN is the
   default everywhere, including locally, until you load something.

Either works alone. Moving the clock with no scenario simply shifts time over
real ESPN data.

## The pipeline

Fixtures are **not** the app's data. They are what the *provider* would say if
asked. The chain is:

```
sim_fixtures ──▶ SimulatedProvider ──▶ sync job ──▶ games/weeks tables ──▶ the app
```

**Nothing in the product changes until a sync job runs.** Load a scenario, open
Admin → Games, and you will still see the old slate — that is correct, not a bug.
Request paths never call a provider; jobs ingest, reads serve our tables
(engineering rules §Architecture).

The same applies to time: advancing the clock changes what the provider *would*
report, so advancing is a two-step move — advance, then re-run the sync.

## How a fixture becomes a status

A fixture stores a season's terminal truth (`finalStatus` plus final scores).
`projectFixtureGame` (`packages/core/src/sim-provider.ts`) rolls it back through
the clock:

| condition | reported status | scores |
| --- | --- | --- |
| `now < kickoff` | `scheduled` | none |
| `kickoff ≤ now < kickoff + 3h15m` | `in_progress` | forced `0–0` |
| later | `final` | the real final scores |

Boundaries are half-open, matching the derived-lock rule `locked = kickoff_at <= now`
(arch D11): a game is live *from the kickoff instant itself*.

In-progress scores are held at `0–0` rather than the eventual result on purpose.
A score that varied with the clock would make replays non-deterministic, and
revealing the final score early would let code that wrongly settles an unfinished
game produce accidentally-correct output. Grading against `0–0` is visibly wrong,
which is the bug report we want.

Cancelled and postponed fixtures never move with the clock — a provider announces
those ahead of time rather than discovering them at kickoff.

## The UI

**Simulator** in the top nav (visible only to an `admin` user in an environment
where the simulator is enabled). Four sections:

- **Clock** — simulated now, real now, the offset, and the active scenario.
  Controls: step buttons (±1h / ±1d / +1w), jump to a week anchor, set an exact
  instant, and back to real time (which leaves the scenario loaded).
- **Scenarios** — the canned edge-case library, any imported seasons, and the
  replay importer. Loading re-anchors the clock to the scenario's start.
- **Fixtures** — one week at a time, showing each fixture's terminal truth beside
  its live projection, with a per-row editor for kickoff, week, spread, and final
  status/scores.
- **Reset** — one league, or the whole environment.

A banner in the header shows simulated time and the active scenario on *every*
page, so you cannot forget which clock you are on. It stays silent at a zero
offset with no scenario, where the environment behaves exactly like a real one.

### Week anchors

`week_start`, `before_first_kickoff`, and `after_last_game` resolve against our
own **ingested** `games` rows, never the provider. Sync before you anchor, or the
week has nothing to anchor to.

`before_first_kickoff` is the pick-testing anchor (everything still open);
`after_last_game` is the settlement anchor (nothing left to play).

## The canonical workflow

```
1. Reset → environment            load does NOT clear ingested data (FK RESTRICT
                                  from league_seasons blocks it), so reset first
2. Scenarios → Load
3. Admin → Jobs → Sync schedule   (+ Sync odds)
4. Clock → jump to a week, anchor "before first kickoff"
5. Create/join a league, make picks
6. Clock → advance past kickoff → Admin → Jobs → Sync scores → observe
7. POST /sim/settle                grade the week and inspect the standings
```

Step 7 is the settlement step (SIM-5). `nfl-sync-scores` already settles a game's
picks as it goes final, so step 6 usually leaves standings correct on its own —
`/sim/settle` is how you *inspect* the result, and how you force a full recompute
after hand-editing a fixture. It is a full rebuild, so it is safe to run
repeatedly: same inputs, same output (arch D10).

Step 1 is the one people skip. A load leaves old seasons/weeks/games in place and
you end up reading a confusing mix of two seasons.

## Scenario library

Seven canned NFL edge cases (`apps/api/src/services/sim/scenarios/`), each
covering a specific spec rule:

`push-ats` · `tie-game` · `cancelled-game` · `postponed-game` · `week-move` ·
`all-eliminated` · `mixed-week`

Library scenarios are re-materialized from their code definition on every load
and anchored to the current real instant, so their kickoffs always land in the
near future. Stored replays keep their historical timestamps untouched.

`docs/runbooks/pickem-regression.md` drives six of these seven as a manual Pick'em
regression pass — what to click and what to assert, per scenario.

## Replay a real season

Scenarios → **Import a replay season**. Pulls a real past NFL season from ESPN
into fixtures.

- Only **completed** seasons are offered. A season labelled `Y` runs Aug of `Y`
  through the Super Bowl in Feb of `Y+1`, so it does not become replayable until
  after that — `latestCompletedNflSeasonYear` decides, and the picker counts down
  from it, so every option is one the importer accepts.
- It is a synchronous full-season crawl. Expect it to take a while.
- Historical ESPN feeds strip odds, so **spreads are synthesized** deterministically
  from the provider game id (ADR-0011). They are stable across re-imports but they
  are not real market lines.
- Re-importing is idempotent — same slug, same fixtures, same spreads.

## Seeing what it did

| Where | What it tells you |
| --- | --- |
| Simulator → Fixtures | The projection, recomputed live as you move the clock. Fastest loop — needs no sync, because it is derived, not stored. |
| Admin → Games | What actually got **ingested**. The real check, and only reflects the simulator after a sync job runs. |
| Admin → Seasons | Weeks and their windows. |
| Toasts | The clock controls report the instant they landed on — worth reading for week anchors, where the result is not obvious. |
| `docker compose exec db psql -U postgres -d picksleagues` | Ground truth. |

Verify time-dependent behaviour by **moving the clock**, never by editing kickoff
timestamps — editing a timestamp tests a different thing than the one you care
about (engineering rules §Quality).

## Reset scopes

- **League** — that league's invites, members, seasons, and the league row. The
  clock is untouched.
- **Environment** — every league's rows *plus* all ingested seasons, weeks, games,
  and odds snapshots. `teams` are kept (ingestion re-links rather than recreates
  them). Users, sessions, and accounts are never touched — a reset that signed the
  operator out would be unusable.
  - *Keep the active scenario* rewinds the clock to that scenario's start, so the
    wiped season re-ingests as unplayed. Without the rewind every game would come
    back already final and its spreads would be unrecoverable, since the odds sync
    only snapshots games that have not kicked off.
  - *Drop it* deletes the active scenario and returns the clock to real time.

## Gotchas

- **A 404 on any `/api/sim/*` route** means `SIM_ENABLED` is unset/false or
  `APP_ENV=production`. The routes are not *registered* — that non-registration is
  the actual production gate, not a broken route.
- **"Back to real time" leaves the scenario loaded.** To get fully back to real
  data, reset the environment with *drop it and return to real time*.
- **An environment reset wipes ingested data**, so re-run the schedule sync
  afterward or the app has no games.
- **Editing a fixture changes nothing until the next sync** — same pipeline rule
  as everything else.
- **Settling does not need a sync first, but it does need one *before*.**
  Settlement reads our own `games` rows, so a fixture edit only reaches it after
  a score sync. Edit → sync scores → settle.

## Driving it without the UI

Everything the panel does is an ordinary API call, useful for scripting. All
`/sim/*` routes need an admin **session** (not the jobs shared-secret header):

```
GET   /api/sim/state                     clock, active scenario, library
POST  /api/sim/clock                     {kind: instant|advance|week|reset}
POST  /api/sim/scenarios/{slug}/load
POST  /api/sim/scenarios/replay          {seasonYear}
GET   /api/sim/fixtures/games            ?scenarioId=&weekType=&weekNumber=
PATCH /api/sim/fixtures/games/{gameId}
POST  /api/sim/reset                     {scope: league|environment}
POST  /api/sim/settle                    {leagueId?} — omit for every active league
```

`/sim/settle` returns the settled state rather than a bare counter: per league,
its season standings and each settled week's standings and result count, ordered
so two runs diff cleanly by eye.

To mint an admin session for a local script, see `.claude/skills/verify` and
`e2e/setup/session.ts` (`mintSession({ appRole: "admin" })`).
