# 0016. Per-mode result and standings tables, and mode-scoped naming

- **Status:** Accepted
- **Date:** 2026-07-27
- **Related:** architecture.md D9 (amended by this ADR), ADR-0015, docs/mvp-spec.md
  §Game Mode 2 / §Game Mode 3, backlog epics 05–07

## Context

D9 chose per-mode pick tables over one polymorphic table, and drew the line there:
"shared behavior lives in `games`, `pick_results`, and `standings`. New modes add
tables rather than mutating shared ones." The Pick'em epic built both tables under
that assumption.

Reviewing the shipped schema against the spec shows the line was drawn in the wrong
place. The two "shared" tables are Pick'em-shaped, and the other two modes contradict
them on their primary axes:

- **`standings`** is `(league_season, member, week?, points, rank)` with a unique on
  `(season, member, week)`. Spec §Game Mode 2's Elimination board is a **survivor
  board** — status alive/eliminated, week eliminated, weekly pick history, teams
  consumed. It has no points and no rank at all; co-winners share first place with no
  ordering. Spec §Game Mode 3 ranks **one row per bracket**, up to 10 per member,
  which the unique constraint forbids outright.
- **`pick_results`** is `(outcome, points, differential)`. Elimination produces
  survive/eliminate with no points and no differential — and `elimination_state`
  already exists in the data model as its ledger. March Madness has points but no
  differential (its tiebreaker is the champion score prediction, not margin).

So `pick_results` fits one and a half modes and `standings` fits one. Keeping them
shared means Elimination and March Madness each add a nullable FK plus nullable
columns they never write, arbitrated by a `CHECK (num_nonnulls(...) = 1)` — the exact
"nullable-column swamp" D9 rejected for picks, relocated one table downstream.

Separately, the generic names had already produced an asymmetry the architecture doc
itself recorded: `PUT /leagues/:id/picks/week/:week` for Pick'em beside
`PUT /leagues/:id/picks/elimination/:week` for Elimination. Pick'em held the
unqualified name only because it shipped first.

## Decision

**Results and standings are per-mode, like picks.** `pick_results` →
`pickem_pick_results`, `standings` → `pickem_standings`, both living in
`packages/db/src/schema/pickem.ts` alongside `pickem_picks`. Elimination and March
Madness get their own tables shaped to their own spec sections rather than nullable
columns on Pick'em's.

**Mode-specific surfaces carry a `pickem` prefix repo-wide** — DB tables, Zod schemas
and their OpenAPI component names, API services and routes, HTTP paths
(`/leagues/{id}/pickem/…`), web data modules, query keys, and components. A surface
keeps its generic name only if it is genuinely mode-agnostic.

Three things stay generic on purpose:

- **`packages/scoring/src/standings.ts`** — `aggregateStandings` and `rankStandings`
  are pure functions over `(outcomes, memberIds)`. Competition ranking is the same
  rule in every mode that ranks at all. This is the reuse the table fork preserves,
  and it is the reuse that was actually load-bearing.
- **`GET /weeks/{id}/games` and `GET /leagues/{id}/weeks`** — both NFL modes play the
  same slate over the same clipped week range. `listLeagueWeeks` still refuses
  non-Pick'em leagues today; that gate widens when Elimination lands rather than the
  endpoint forking.
- **`PICK_OUTCOME` and `PICK_TYPE`** — correct/incorrect/push also grades March
  Madness (§Game Mode 3 resolves a vacated game as a push), and straight-up vs
  against-the-spread is already shared by both NFL modes.

The migrations were regenerated in place rather than shipped as renames: ADR-0003
applies migrations only on push to `staging`/`main`, and this stack has never merged,
so the pre-rename tables exist nowhere but local development.

## Consequences

D9's final sentence is amended — new modes add result and standings tables too, not
just pick tables. What remains genuinely shared is `games`, `odds_snapshots`, and the
league/membership tables; the settlement *shape* is shared as a pure-function
contract in `packages/scoring`, not as table columns.

Each mode's constraints can now encode its own rules honestly: March Madness keys
standings by bracket without relaxing anything Pick'em depends on, and Elimination
never carries points or differential columns it would leave null forever. The cost is
three settlement writers instead of one, and a `GET /leagues/{id}/…/standings` per
mode rather than a single endpoint — acceptable, since the boards render differently
anyway (spec §Screens: weekly/season toggle, survivor board, bracket leaderboard).

`/admin/leagues/{id}/rebuild` keeps its mode-agnostic name and currently dispatches to
Pick'em only; it becomes a real per-mode dispatch when the other modes' settlement
lands. The deferred simplify item "extract `rebuildStandings` before ELM-4 forces a
copy" is resolved by this ADR rather than by an extraction: Elimination's rebuild is a
different computation over a different table, so there was never a copy to avoid.
