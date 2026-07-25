# 0012. Simulated data flows through real ingestion; fixtures store terminal truth and project through the clock

- **Status:** Accepted
- **Date:** 2026-07-24
- **Related:** extends ADR-0011 (simulator/admin merge); mvp-spec.md §Testing & Internal Tooling; architecture.md §Simulator & Time, §Environments, D13, D14; backlog SIM-1…SIM-6
- **Amended by ADR-0014:** where this record says the gate is `APP_ENV !== production` (decisions 3 and 5), the gate is now `isSimEnabled` = `APP_ENV !== production && SIM_ENABLED`. Production remains structurally excluded, so every conclusion below still holds; only the predicate widened.

## Context

ADR-0011 settled *who* drives the simulator (the admin page) and *how it is gated*
(non-registration outside production). It left three mechanical questions open, and
SIM-1/2/3/6 cannot be built without answering them:

1. **Where simulated data enters the app.** `sim_fixtures` could either be read directly
   by request paths and settlement (a parallel read path), or fed through the existing
   sync jobs as just another `GameDataProvider`.
2. **What a fixture stores.** A season's games are known in full at load time, but a
   simulator whose games are all already final cannot exercise locking, join cutoffs, or
   the pick window — the very things the simulated clock exists for.
3. **How the provider gets selected**, given that ESPN is the default in every
   environment and the replay importer needs ESPN *while* a scenario is loaded.

## Decision

**1. `SimulatedProvider` implements `GameDataProvider`; simulated seasons enter through
the normal sync jobs.** Fixtures hold provider-shaped rows (team abbreviations, a
provider game id, week type + number), and `sync-schedule`/`sync-odds`/`sync-scores`
ingest from them into `sport_seasons`/`weeks`/`games`/`odds_snapshots` exactly as they do
from ESPN. Nothing downstream of ingestion knows the simulator exists. No parallel read
path, and the ingestion code itself is exercised by every simulated run.

**2. Fixtures store the season's terminal truth; the provider projects it through
`clock.now()`.** A fixture game carries kickoff, spread, and how the game *ends*
(`final_status` plus final scores). `projectFixtureGame` — a pure function in
`packages/core` — derives what a provider would report at the simulated instant:

- `now < kickoff` → `scheduled`, no scores
- `kickoff <= now < kickoff + 3h15m` → `in_progress`, scores `0-0`
- at or past the end of that window → the fixture's terminal status and scores
- `cancelled`/`postponed` fixtures report that status at every instant — those are
  announced ahead of time, not discovered at kickoff

Boundaries are half-open, matching the derived-lock rule (`locked = kickoff_at <= now`,
D11). Advancing the clock and re-running the sync jobs therefore makes a week unfold
exactly as a real one does.

The in-progress score is `0-0`, held stable for the whole window, rather than the
eventual final score or an interpolation. Two reasons: a score that varied with the clock
would make replays non-deterministic, which is the property D14 buys the simulator for;
and revealing the final score early would let code that wrongly settles a non-final game
produce *accidentally correct* output. Grading against `0-0` is visibly wrong, which is
the bug report we want.

**3. Provider selection mirrors `resolveClock`.** `resolveGameDataProvider` returns ESPN
in production unconditionally — the simulated branch is structurally unreachable there,
the same shape as the clock's production short-circuit — and outside production returns
the simulated provider only when `app_state.sim_active_scenario_id` is set. One active
scenario, environment-wide, pinned to one season year; any other year reports "no weeks /
no games", the shape ESPN returns for an unpublished season (ADR-0009). The resolver
takes the caller's already-resolved `Clock` rather than resolving its own, so the
provider's "now" is the exact instant the rest of the request uses — two independently
resolved clocks differ by microseconds and could straddle a kickoff boundary mid-job.
`AppDeps` keeps a separate `espnProvider` for the replay importer, which must reach the
real provider precisely when a scenario is loaded.

**4. Loading a scenario positions the clock at its `starts_at`.** Replay scenarios anchor
one hour before the season's earliest kickoff; library scenarios declare kickoffs as
offsets and materialize against real now at load. Without this, replaying 2024 in 2026
starts with every game already final.

**5. The simulator's routes are in the committed OpenAPI contract even though production
never registers them.** `generate-openapi.ts` builds the app with no env, and the mount
condition is "not production" rather than "env present and non-production", so the spec
carries `/api/sim/*`. The SPA reaches the simulator through the generated client like
every other endpoint (engineering rules §API-first) instead of hand-rolling fetch for the
one surface that could not be typed.

## Consequences

Easier: the simulator exercises the real ingestion path rather than bypassing it, so a
bug in ingestion surfaces in simulated runs; scoring/lock edge cases are reproducible by
moving one clock; a replayed season is byte-reproducible because synthesized spreads are
seeded from the provider game id, never `Math.random`.

Harder/accepted: mid-game scores are fiction (`0-0`), so nothing may test "live score
display" against the simulator — the honest boundary of the model, and no spec rule
depends on mid-game values. The committed contract documents routes that 404 in
production; the route summaries say so. Simulated and live seasons cannot be mixed in one
run — a loaded scenario means the environment is under test.

Revisit if a mode ever needs a scoring rule keyed to in-game state (none in the MVP), or
if bracket fixtures (MM-8, renumbered from SIM-8) need a projection rule that game-level
kickoffs cannot express.
