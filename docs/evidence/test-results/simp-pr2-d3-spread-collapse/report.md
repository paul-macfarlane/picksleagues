# simp-pr2 / D3 — SIMP-7 verification

Deliverable: collapse the append-only `odds_snapshots` history into a single current-spread
column on `games`, so spread resolves through `override_spread ?? spread` like every other
game field (arch D15, §Spread strategy).

- Repository: `picksleagues`, branch `feat/simp-pr2-rule-surface-collapse`
- Comparison point: `4e76cd5` (D2, SIMP-6)
- Migration: `packages/db/migrations/0020_eminent_rocket_raccoon.sql`

**This deliverable inherits D2's red `pnpm typecheck` and adds a red `pnpm test:integration`
that it did not create.** Section 3 attributes every residual typecheck error; section 4
proves the integration failure set is byte-identical to the pre-change baseline.

Not run, by instruction: `pnpm test:e2e` (destroys the dev database — human-gated),
`pnpm contract:check`, any Vercel command. `contract:check` cannot pass here for a stronger
reason than staleness: OpenAPI generation loads `apps/api/src/routes/pickem.ts`, which imports
the `PickemRepickRequestSchema` that SIMP-5 deleted, so generation crashes until SIMP-8 lands.
The committed `openapi/` therefore stays stale by design; the plan schedules regeneration for
the first green state after SIMP-9.

---

## 1. Raw output

### `pnpm db:up` — exit 0

```
$ docker compose up -d db --wait
 Container picksleagues-db-1 Running
 Container picksleagues-db-1 Waiting
 Container picksleagues-db-1 Healthy
```

### `pnpm format` — exit 0

```
$ prettier --write .
```

Every file reported `(unchanged)` on the final run; the ~200-line per-file listing is omitted.

### `pnpm lint` — exit 0

```
$ eslint .
```

### `pnpm test` — exit 0

```
$ vitest run --project unit

 RUN  v4.1.10 /Users/paulmacfarlane/code/picksleagues


 Test Files  27 passed (27)
      Tests  519 passed (519)
   Start at  20:58:41
   Duration  1.01s (transform 1.45s, setup 0ms, import 3.95s, tests 285ms, environment 3ms)
```

### `pnpm db:migrate` — exit 0

```
$ pnpm --filter @picksleagues/db migrate
$ drizzle-kit migrate
No config path provided, using default 'drizzle.config.ts'
Reading config file '/Users/paulmacfarlane/code/picksleagues/packages/db/drizzle.config.ts'
Using 'pg' driver for database querying
[✓] migrations applied successfully!
```

Target was the local Docker Postgres on `localhost:5433` only.

Migration body (`0020_eminent_rocket_raccoon.sql`):

```sql
DROP TABLE "odds_snapshots" CASCADE;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "spread" double precision;
```

No backfill, per the ticket: dev data is disposable and the next odds sync repopulates.

Post-migration schema check:

```
$ docker exec picksleagues-db-1 psql -U postgres -d picksleagues -c "\d games"
 override_spread        | double precision         |           |          |
 spread                 | double precision         |           |          |

$ docker exec picksleagues-db-1 psql -U postgres -d picksleagues -c "\dt odds_snapshots"
Did not find any relation named "odds_snapshots".
```

### `pnpm test:integration` — exit 1 (26 inherited failures, 0 new — see section 4)

```
$ vitest run --project integration

 Test Files  4 failed | 22 passed (26)
      Tests  26 failed | 474 passed (500)
   Start at  20:59:39
   Duration  25.9s
```

### `vitest run --project integration --reporter=verbose apps/api/test/nfl-sync-odds.test.ts` — exit 0

The deliverable's own suite, in full:

```
 ✓ syncNflOdds > prices only unstarted games (a game past its kickoff is excluded)
 ✓ syncNflOdds > prices a postponed game whose kickoff is still ahead, but never a cancelled one
 ✓ syncNflOdds > stamps updated_at from the injected clock, not the DB clock
 ✓ syncNflOdds > counts unstarted games without a provider line and leaves their spread alone
 ✓ syncNflOdds > re-running against the same provider response leaves row state identical
 ✓ syncNflOdds > writes the new number when the line moves, and only then
 ✓ syncNflOdds > never clobbers an override_spread, and the override still wins after the re-sync
 ✓ syncNflOdds > pre-season: with no in-progress week, falls back to the next upcoming week and prices it
 ✓ syncNflOdds > off-season: after every week has ended with no explicit week, no_current_week and writes nothing
 ✓ syncNflOdds > explicit week: prices the requested week's unstarted games
 ✓ syncNflOdds > explicit postseason week: prices that week's unstarted postseason games
 ✓ syncNflOdds > explicit week that isn't synced returns week_not_synced (distinct from the derived no_current_week)
 ✓ syncNflOdds > no-ops when the season has not been synced and writes nothing
 ✓ syncNflOdds > ignores a provider game that isn't in our tables (never creates games/weeks)
 ✓ syncNflOdds: offseason season roll-forward > default season concluded + next season synced: a bare run prices the NEXT season's first week
 ✓ syncNflOdds: offseason season roll-forward > default season concluded + NO next season row: no-ops and never creates one
 ✓ syncNflOdds: offseason season roll-forward > derived season never synced + next season synced: a bare run prices the NEXT season
 ✓ syncNflOdds: offseason season roll-forward > derived season never synced + next season row with no weeks: stays put and creates nothing
 ✓ syncNflOdds: offseason season roll-forward > an explicit season/week still wins over the roll-forward
 ✓ syncNflOdds: offseason season roll-forward > an explicit week with a derived season rolls forward with it
 ✓ POST /api/jobs/nfl/sync-odds > 401s without the x-job-secret header
 ✓ POST /api/jobs/nfl/sync-odds > returns the job envelope with the odds counters

      Tests  22 passed (22)
```

The three the ticket owes:

- **Override precedence.** The set-wins and cleared-shows-through legs live where the write
  path is exercised — `admin-overrides.test.ts` ("returns the corrected game…":
  `overrideSpread: 7.5` → `effectiveSpread: 7.5` over a `spread: null` provider block; "clears
  one field back to provider truth…": `overrideSpread: null` → `effectiveSpread: -3.5`, the
  provider number showing through). The third leg — a sync re-run never clobbers an override —
  is in `nfl-sync-odds.test.ts`, since it is a property of the sync, and it asserts both that
  `override_spread` survives untouched **and** that `resolveGameOverrides` still returns it.
  All three run against real Postgres.
- **Idempotency.** "re-running against the same provider response leaves row state identical"
  compares whole `games` rows before and after a second run, `updated_at` included, so a
  restamped row would fail even though the number matched. Paired with "writes the new number
  when the line moves, and only then", which proves the skip isn't just a dead write path.
- **Postponed coverage survives.** "prices a postponed game whose kickoff is still ahead, but
  never a cancelled one" — unchanged in intent from the pre-existing regression test, retargeted
  from `odds_snapshots` rows to `games.spread`.

---

## 2. Complete `pnpm typecheck` output

`pnpm -r typecheck` runs `apps/api` and `apps/web` in parallel and aborts on the first failure,
so `apps/api`'s errors are truncated from the recursive run. Both are reproduced.

### `pnpm typecheck` — exit 2 (`apps/web` leg)

```
apps/web typecheck: src/api/pickem.ts(7,8): error TS2305: Module '"@picksleagues/schemas"' has no exported member 'PickemRepickRequest'.
apps/web typecheck: src/components/admin/games-browser.tsx(121,42): error TS2741: Property 'spread' is missing in type '{ id: string; weekId: string; providerGameId: string; homeTeam: {...}; awayTeam: {...}; kickoffAt: string; status: "scheduled" | ... 4 more ... | "moved"; ... 21 more ...; effectiveClockSeconds: number | null; }' but required in type '{ id: string; ... status: "scheduled" | ... 3 more ... | "cancelled"; ... 20 more ...; effectiveClockSeconds: number | null; }'.
apps/web typecheck: src/components/league/pickem-picks.tsx(159,13): error TS2339: Property 'movedGame' does not exist on type '{ id: string; gameId: string; side: "home" | "away"; spread: number | null; outcome: "push" | "correct" | "incorrect" | null; updatedAt: string; }'.
apps/web typecheck: src/components/league/pickem-picks.tsx(162,48): error TS2339: Property 'movedGame' does not exist on type '{ ... }'.
apps/web typecheck: src/components/league/pickem-picks.tsx(162,74): error TS2339: Property 'movedGame' does not exist on type '{ ... }'.
apps/web typecheck: src/components/league/pickem-picks.tsx(230,11): error TS2719: Type '{ weekId: string; ... }' is not assignable to type '{ weekId: string; ... }'. Two different types with this name exist, but they are unrelated.
apps/web typecheck:           Type '"scheduled" | "in_progress" | "final" | "postponed" | "cancelled" | "moved"' is not assignable to type '"scheduled" | "in_progress" | "final" | "postponed" | "cancelled"'.
apps/web typecheck: src/components/league/pickem-picks.tsx(459,27): error TS2339: Property 'movedGame' does not exist on type '{ ... }'.
apps/web typecheck: src/components/league/pickem-picks.tsx(460,33): error TS2339: Property 'movedGame' does not exist on type '{ ... }'.
apps/web typecheck: src/components/league/pickem-picks.tsx(460,75): error TS2339: Property 'movedGame' does not exist on type '{ ... }'.
apps/web typecheck: src/components/league/pickem-picks.tsx(460,124): error TS2339: Property 'movedGame' does not exist on type '{ ... }'.
apps/web typecheck: src/components/league/pickem-standings-table.test.ts(19,5): error TS2353: Object literal may only specify known properties, and 'differential' does not exist in type '{ leagueMemberId: string; ... rank: number; }'.
apps/web typecheck: src/components/league/pickem-standings-table.test.ts(37,44): error TS2353: ... 'differential' ...
apps/web typecheck: src/components/league/pickem-standings-table.test.ts(41,7): error TS2353: ... 'differential' ...
apps/web typecheck: src/components/league/pickem-standings-table.test.ts(47,46): error TS2353: ... 'differential' ...
apps/web typecheck: src/components/league/pickem-standings-table.test.ts(48,44): error TS2353: ... 'differential' ...
apps/web typecheck: src/components/league/pickem-standings-table.tsx(92,16): error TS2339: Property 'differential' does not exist on type '{ ... }'.
apps/web typecheck: src/components/league/pickem-standings-table.tsx(92,33): error TS2339: Property 'differential' does not exist on type '{ ... }'.
apps/web typecheck: src/components/league/pickem-standings-table.tsx(258,41): error TS2339: Property 'differential' does not exist on type '{ ... }'.
apps/web typecheck: src/components/league/pickem-week-detail.test.ts(27,5): error TS2353: ... 'differential' ...
apps/web typecheck: src/components/league/pickem-week-detail.tsx(140,19): error TS2719: Type 'Map<string, { ... }>' is not assignable to type 'Map<string, { ... }>'. Two different types with this name exist, but they are unrelated.
apps/web typecheck: src/components/league/pickem-week-detail.tsx(273,24): error TS2339: Property 'movedGame' does not exist on type '{ ... }'.
apps/web typecheck: src/components/sim/sim-fixtures-card.tsx(121,46): error TS2719: Type '{ id: string; scenarioId: string; ... }' is not assignable to type '{ id: string; scenarioId: string; ... }'. Two different types with this name exist, but they are unrelated.
apps/web typecheck: src/lib/game.ts(25,16): error TS2339: Property 'MOVED' does not exist on type '{ readonly SCHEDULED: "scheduled"; readonly IN_PROGRESS: "in_progress"; readonly FINAL: "final"; readonly POSTPONED: "postponed"; readonly CANCELLED: "cancelled"; }'.
apps/web typecheck: Failed
[ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL] @picksleagues/web@0.0.0 typecheck: `tsc -b`
Exit status 2
```

### `pnpm --filter @picksleagues/api typecheck` — exit 2

```
$ tsc
src/routes/pickem.ts(5,3): error TS2724: '"@picksleagues/schemas"' has no exported member named 'PickemRepickRequestSchema'. Did you mean 'SubmitPickemPicksRequestSchema'?
src/services/pickem/picks.ts(15,8): error TS2305: Module '"@picksleagues/schemas"' has no exported member 'PickemRepickRequest'.
src/services/pickem/settlement.ts(152,79): error TS2339: Property 'MOVED' does not exist on type '{ readonly SCHEDULED: "scheduled"; readonly IN_PROGRESS: "in_progress"; readonly FINAL: "final"; readonly POSTPONED: "postponed"; readonly CANCELLED: "cancelled"; }'.
src/services/sim/replay.ts(40,4): error TS2366: Function lacks ending return statement and return type does not include 'undefined'.
src/services/sim/replay.ts(50,22): error TS2339: Property 'MOVED' does not exist on type '{ ... }'.
test/pickem-picks.test.ts(303,64): error TS2339: Property 'MOVED' does not exist on type '{ ... }'.
test/pickem-picks.test.ts(754,62): error TS2339: Property 'MOVED' does not exist on type '{ ... }'.
test/pickem-picks.test.ts(932,20): error TS2339: Property 'movedGame' does not exist on type '{ ... }'.
test/pickem-picks.test.ts(933,20): error TS2339: Property 'movedGame' does not exist on type '{ ... }'.
test/pickem-picks.test.ts(934,20): error TS2339: Property 'movedGame' does not exist on type '{ ... }'.
test/pickem-picks.test.ts(938,54): error TS2339: Property 'movedGame' does not exist on type '{ ... }'.
[ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL] @picksleagues/api@0.0.0 typecheck: `tsc`
Exit status 2
```

All four workspace packages typecheck clean: `packages/schemas`, `packages/scoring`,
`packages/core`, `packages/db`. Only the two apps are red, exactly as after D2.

---

## 3. Typecheck attribution diff against D2's residual-error table

D2's table (`docs/evidence/test-results/simp-pr2-d2-schemas-migration/report.md` §3) has 18 rows.
This deliverable's output maps onto it one-for-one.

| D2 row | File | Status after D3 |
|---|---|---|
| 1 | `apps/api/src/routes/pickem.ts:5` | Unchanged — SIMP-8 |
| 2 | `apps/api/src/services/pickem/picks.ts:15` | Unchanged — SIMP-8 |
| 3 | `apps/api/src/services/pickem/settlement.ts:152` | Unchanged — SIMP-9 |
| 4 | `apps/api/src/services/sim/replay.ts:50` | Unchanged — SIMP-9 |
| 5 | `apps/api/src/services/sim/replay.ts:40` | Unchanged — SIMP-9 |
| 6 | `apps/api/test/pickem-picks.test.ts:303,754` | Unchanged — SIMP-9 |
| 7 | `apps/api/test/pickem-picks.test.ts:932,933,934,938` | Unchanged — SIMP-9 |
| 8 | `apps/web/src/api/pickem.ts:7` | Unchanged — SIMP-10 |
| 9 | `apps/web/src/components/admin/games-browser.tsx:121` | **Changed code, same site — see below** |
| 10 | `apps/web/src/components/league/pickem-picks.tsx:159,162,459,460` | Unchanged — SIMP-10 |
| 11 | `apps/web/src/components/league/pickem-picks.tsx:230` | Unchanged — SIMP-9 regen |
| 12 | `apps/web/src/components/league/pickem-standings-table.tsx:92,258` | Unchanged — SIMP-11 |
| 13 | `apps/web/src/components/league/pickem-standings-table.test.ts:19,37,41,47,48` | Unchanged — SIMP-11 |
| 14 | `apps/web/src/components/league/pickem-week-detail.test.ts:27` | Unchanged — SIMP-11 |
| 15 | `apps/web/src/components/league/pickem-week-detail.tsx:273` | Unchanged — SIMP-11 |
| 16 | `apps/web/src/components/league/pickem-week-detail.tsx:140` | Unchanged — SIMP-9 regen |
| 17 | `apps/web/src/components/sim/sim-fixtures-card.tsx:121` | Unchanged — SIMP-9 regen |
| 18 | `apps/web/src/lib/game.ts:25` | Unchanged — SIMP-9 regen |

**Diff: exactly one row changes, and it is row 9.** No error was added at a new site, and no
error was silenced.

`games-browser.tsx:121` is the single assignment where a row from the committed generated
client (`openapi/client/schema.d.ts`) is passed to a component typed against
`AdminGame` from `packages/schemas`. D2 left it failing TS2322 because the stale client still
carries `"moved"` in `GameStatus`. It now fails **TS2741** instead — `Property 'spread' is
missing` — because this deliverable renamed `AdminGame.latestSpread` → `spread` and dropped
`latestSpreadCapturedAt` (a "captured at" has no source once history is gone). TypeScript
reports the missing-property mismatch first and the `"moved"` union mismatch is masked behind
it; both clear together at the same event, the `openapi/` regeneration SIMP-9 schedules.

Attribution: **SIMP-9 — regen**, the same cause already carrying rows 11, 16, 17 and 18. It is
a staleness error in a committed artifact, not a defect in the code: the API serializes
`spread` and the browser reads `game.spread`, so the running admin page is correct today. The
web-side unit fixtures that type against `packages/schemas` directly rather than the generated
client (`game-override-patch.test.ts`) were updated in this commit and are green.

**Every error is attributed. There are no unattributed errors.**

---

## 4. Integration attribution — the inherited red state

D2 did not run `pnpm test:integration`, so its report could not record that the branch arrives
at D3 with the integration suite already failing. It is captured here.

**Baseline, captured on this branch immediately before any D3 edit** (commit `4e76cd5`):

```
 Test Files  4 failed | 22 passed (26)
      Tests  26 failed | 479 passed (505)
```

**After D3:**

```
 Test Files  4 failed | 22 passed (26)
      Tests  26 failed | 474 passed (500)
```

`diff` of the sorted, de-duplicated failing-test lists, before vs. after:

```
17c17
< FAIL |integration| apps/api/test/standings-repick.test.ts > … > 409s spread_unavailable when the replacement has no odds snapshot at all
---
> FAIL |integration| apps/api/test/standings-repick.test.ts > … > 409s spread_unavailable when the replacement has no spread at all
```

That is the whole diff: one test title this commit reworded ("odds snapshot" → "spread"),
failing before and after for the same inherited reason. **Zero failures added, zero removed.**

The 26 failures group into two inherited causes, both owned by later deliverables:

| Count | File | Cause | Cleared by |
|---|---|---|---|
| 18 | `standings-repick.test.ts` | The `/repick` route 500s: `PickemRepickRequestSchema` is `undefined` at runtime after SIMP-5 deleted it, so Hono's validator has no schema and `c.req.valid("json")` yields `undefined` (`picks.ts:508`, "Cannot read properties of undefined (reading 'replacePickId')") | SIMP-8 — deletes the route and the test half |
| 5 | `pickem-picks.test.ts` | `GAME_STATUS.MOVED` is `undefined` after SIMP-5, so `moved`-status fixtures write `undefined` | SIMP-9 |
| 2 | `settlement.test.ts` | Same — the two week-move settlement tests | SIMP-9 |
| 1 | `nfl-sync-schedule.test.ts` | Same — the week-move settlement assertion | SIMP-9 |

The suite **runs**; it is not blocked. Every file this deliverable touches is green:
`nfl-sync-odds.test.ts`, `admin-data.test.ts`, `admin-overrides.test.ts`, `sim-reset.test.ts`,
and the edited ATS test in `settlement.test.ts` (that file's two failures are both week-move
tests, untouched here).

The test count drops by 5 net: 7 removed with the deleted admin odds-history surface (3 in the
`GET /admin/games/{gameId}/odds` suite, 2 in the equal-`captured_at` tie-break suite whose whole
subject was ordering within a history, and 2 access-control cases from the `it.each` path list),
against 2 added to `nfl-sync-odds.test.ts` (the line-moves write and the override-survives-resync
proof) plus 1 replacing the deleted "history is intentional" append test with the idempotency
assertion.

---

## 5. Call sites that previously passed `null`

`resolveGameOverrides` lost its `providerSpread` parameter. Five call sites; three were passing
a literal `null` because they had no snapshot to hand. Each was checked rather than assumed:

| Site | Previously | Now | Behaviour change |
|---|---|---|---|
| `slate.ts:107` (`loadResolvedWeekGames`) | latest snapshot | `game.spread` | None — same number, one fewer query |
| `slate.ts:160` (`resolveLockStates`) | `null` | `game.spread` | **None.** The caller consumes only `.kickoffAt`; the resolved spread was and is discarded |
| `admin-data.ts:132` (`serializeAdminGame`) | latest snapshot | `game.spread` | None — same number |
| `admin-overrides.ts:73-74` (`before`/`after`) | `null` | `game.spread` | **None.** Both values feed only `leavesOutcomeKnowableButUnlocked`, which reads `kickoffAt`, `status`, `homeScore`, `awayScore` — never `spread`. The guard's decision is unchanged for every input |
| `settlement.ts:140` (`loadWeekInputs`) | `null` | `game.spread` | **None, and this one matters most.** `effective.spread` is not read: the `PickemGameResult` built there carries only `gameId`, `status`, `homeScore`, `awayScore`, and grading uses the pick's own `spreadAtPick`. Settlement was never going to see a spread here and still doesn't. Pinned by `settlement.test.ts` "grades an ATS pick against spread_at_pick, not the game's current spread", which now moves `games.spread` to `-9` after a pick taken at `-3.5` and asserts the pick still grades `correct` |

The two admin-data sites were reading the latest snapshot and now read the game row, which is
the ticket. The three `null` sites all resolve a real number now; none of them looks at it.

---

## 6. Notes for the reviewer

- **`games.spread`, not `provider_spread`** — the owner's ruling of 2026-08-04
  (`docs/plans/simp.md` §Decisions 2). Every other provider field on `games` is unprefixed
  against an `override_*` counterpart; `override_* ?? provider_*` names the resolution, not the
  column.
- **The deleted admin surface.** `listGameOdds`, `GET /admin/games/{gameId}/odds`,
  `AdminOddsSnapshotSchema` / `AdminGameOddsResponseSchema` / `ADMIN_ODDS_SNAPSHOT_LIMIT`,
  `useAdminGameOdds`, and the games-browser's "Odds history" disclosure are gone. This was the
  one genuine reader of the snapshot history — the epic's "no reader" claim did not count it —
  so it is deleted deliberately, not by accident. What an operator loses is the ability to watch
  a line move; what they keep is the current number, the override, and the resolved value side
  by side, which is what the browser exists for.
- **The counter rename.** `snapshotsInserted` → `spreadsUpdated`, counting rows actually
  written (matching `sync-scores`' `gamesUpdated`), so a re-run over an unmoved line honestly
  reports `0`. `docs/runbooks/jobs.md` updated. No admin UI surfaces the key by name — the jobs
  panel renders the `details` object generically — so nothing else needed changing.
- **A provider blip does not clear a line.** A game the provider stops pricing keeps its stored
  spread and counts as `gamesWithoutOdds`, rather than being nulled. Nulling it would refuse
  every ATS pick on that game with `spread_unavailable` until the next run put the number back,
  which is the same failure mode the postponed-game predicate exists to prevent.
- **SIMP-16 unaffected.** The week-targeting logic (`resolveTargetWeek`) is untouched; the
  question of whether ESPN's week window closes before Tuesday is still open and still SIMP-16's.
